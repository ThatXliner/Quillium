import { listeners } from "$lib/editor/listeners";
import { annotations as annotationExtensions } from "$lib/editor/plugins/annotations";
import {
    _updateRevisionVersionState,
    addAnnotation,
    annotationField,
    nestedEditorEdit,
    revisionProvenance,
    setActiveRevisionVersion,
} from "$lib/editor/plugins/annotations/annotationField";
import {
    createNewAnnotation,
    isAnnotationOfType,
    makeVersion,
} from "$lib/editor/plugins/annotations/models";
import {
    createVersionGroup,
    versionGroupField,
} from "$lib/editor/plugins/annotations/versionGroupField";
import { currentDocumentId, currentDraftId, lastPersistedEventId, lastSavedAt } from "$lib/stores";
import { history } from "@codemirror/commands";
import { EditorSelection, EditorState, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { mockIPC } from "@tauri-apps/api/mocks";
import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function makeView(options: Parameters<typeof listeners>[0] = {}, doc = "Hello world") {
    const state = EditorState.create({
        doc,
        extensions: [annotationField, versionGroupField, listeners(options)],
    });
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    return new EditorView({ state, parent });
}

async function flushMicrotasks() {
    await new Promise((resolve) => setTimeout(resolve, 0));
}

let view: EditorView | undefined;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // Set up a document + draft so the persist path is active
    currentDocumentId.set("doc-1");
    currentDraftId.set("draft-1");
});

afterEach(() => {
    view?.destroy();
    view = undefined;
    consoleErrorSpy.mockRestore();
    currentDocumentId.set(null);
    currentDraftId.set(null);
    lastPersistedEventId.set(-1);
    lastSavedAt.set(null);
});

describe("listeners integration", () => {
    it("invokes cmd_append_event when the document changes", async () => {
        const invoked: Array<{ cmd: string; args: unknown }> = [];
        mockIPC((cmd, args) => {
            invoked.push({ cmd, args });
            // Return a valid AppendEventResult so the listener doesn't error
            if (cmd === "cmd_append_event") return { eventId: 0, needsSnapshot: false };
            return null;
        });

        view = makeView();
        view.dispatch({ changes: { from: 0, insert: "Hi " } });
        await flushMicrotasks();

        expect(invoked.some((call) => call.cmd === "cmd_append_event")).toBe(true);
    });

    it("invokes cmd_append_event when annotations change even without doc changes", async () => {
        const invoked: Array<{ cmd: string; args: unknown }> = [];
        mockIPC((cmd, args) => {
            invoked.push({ cmd, args });
            if (cmd === "cmd_append_event") return { eventId: 0, needsSnapshot: false };
            return null;
        });

        view = makeView();
        const annotation = createNewAnnotation(
            view.state.field(annotationField),
            EditorSelection.single(0, 5),
            "comment",
        );

        view.dispatch(
            view.state.update({
                effects: [addAnnotation.of(annotation)],
            }),
        );
        await flushMicrotasks();

        expect(invoked.some((call) => call.cmd === "cmd_append_event")).toBe(true);
    });

    it("persists version-group-only changes through the production save listener", async () => {
        const invoked: Array<{ cmd: string; args: unknown }> = [];
        mockIPC((cmd, args) => {
            invoked.push({ cmd, args });
            if (cmd === "cmd_append_event") return { eventId: 0, needsSnapshot: false };
            return null;
        });

        view = makeView();
        const { spec } = createVersionGroup("Linked", [
            { revisionId: 1, versionId: "one" },
            { revisionId: 2, versionId: "two" },
        ]);
        view.dispatch(spec);
        await flushMicrotasks();

        const appendCall = invoked.find((call) => call.cmd === "cmd_append_event");
        expect(appendCall).toBeDefined();
        const args = appendCall?.args as { payloadJson?: string };
        const payload = JSON.parse(args.payloadJson ?? "{}") as Record<string, unknown>;
        expect(payload.type).toBe("state_transaction");
        expect(payload.transactionReplay).toBeDefined();
    });

    it("sends a doc_change payload containing the inserted text", async () => {
        const invoked: Array<{ cmd: string; args: unknown }> = [];
        mockIPC((cmd, args) => {
            invoked.push({ cmd, args });
            if (cmd === "cmd_append_event") return { eventId: 0, needsSnapshot: false };
            return null;
        });

        view = makeView();
        view.dispatch({ changes: { from: 0, insert: "Draft: " } });
        await flushMicrotasks();

        const appendCall = invoked.find((call) => call.cmd === "cmd_append_event");
        expect(appendCall).toBeDefined();
        const args = appendCall?.args as { payloadJson?: string };
        expect(args.payloadJson).toBeTypeOf("string");
        const payload = JSON.parse(args.payloadJson ?? "{}") as Record<string, unknown>;
        expect(payload.type).toBe("doc_change");
        // The change inserts "Draft: " at position 0
        const changes = payload.changes as Array<{ from: number; insert: string }>;
        expect(changes.some((c) => c.insert === "Draft: ")).toBe(true);
    });

    it("persists an atomic nested edit as a compound annotation update", async () => {
        const invoked: Array<{ cmd: string; args: unknown }> = [];
        mockIPC((cmd, args) => {
            invoked.push({ cmd, args });
            if (cmd === "cmd_append_event") return { eventId: 0, needsSnapshot: false };
            return null;
        });

        view = makeView();
        const versions = [makeVersion({ doc: "Hello" })];
        const revision = {
            ...createNewAnnotation(
                view.state.field(annotationField),
                EditorSelection.single(0, 5),
                "revision",
            ),
            activeVersionId: versions[0].id,
            versions,
        };
        view.dispatch({ effects: [addAnnotation.of(revision)] });
        await flushMicrotasks();
        invoked.length = 0;

        const nestedVersionInput = {
            ...versions[0],
            doc: "Hi",
            annotationField: {
                0: {
                    _type: "comment",
                    status: "active" as const,
                    id: 0,
                    selection: { ranges: [{ anchor: 0, head: 2 }], main: 0 },
                    thread: [],
                },
            },
        };
        const nestedVersion = makeVersion(nestedVersionInput);
        view.dispatch({
            changes: { from: 0, to: 5, insert: "Hi" },
            effects: [
                _updateRevisionVersionState.of({
                    annotationId: revision.id,
                    versionId: versions[0].id,
                    versionState: nestedVersion,
                }),
            ],
            annotations: [
                nestedEditorEdit.of(revision.id),
                revisionProvenance.of("human"),
                Transaction.addToHistory.of(true),
            ],
        });
        await flushMicrotasks();

        const appendCall = invoked.find((call) => call.cmd === "cmd_append_event");
        const args = appendCall?.args as { payloadJson?: string };
        const payload = JSON.parse(args.payloadJson ?? "{}") as {
            type?: string;
            annotationEvents?: Array<{ type: string; annotation?: unknown }>;
            provenance?: { origin: string };
        };
        expect(payload.type).toBe("compound");
        expect(payload.annotationEvents?.some((event) => event.type === "annotation_update")).toBe(
            true,
        );
        expect(payload.provenance?.origin).toBe("human-revision");
    });

    it("sends an annotation_add payload when an annotation is added", async () => {
        const invoked: Array<{ cmd: string; args: unknown }> = [];
        mockIPC((cmd, args) => {
            invoked.push({ cmd, args });
            if (cmd === "cmd_append_event") return { eventId: 0, needsSnapshot: false };
            return null;
        });

        view = makeView();
        const annotation = createNewAnnotation(
            view.state.field(annotationField),
            EditorSelection.single(0, 5),
            "comment",
        );
        view.dispatch(view.state.update({ effects: [addAnnotation.of(annotation)] }));
        await flushMicrotasks();

        const appendCall = invoked.find((call) => call.cmd === "cmd_append_event");
        expect(appendCall).toBeDefined();
        const args = appendCall?.args as { payloadJson?: string };
        const payload = JSON.parse(args.payloadJson ?? "{}") as Record<string, unknown>;
        expect(payload.type).toBe("annotation_add");
        expect(payload.annotation).toBeDefined();
    });

    it("creates a named snapshot before a revision annotation is persisted", async () => {
        const invoked: Array<{ cmd: string; args: unknown }> = [];
        lastPersistedEventId.set(12);
        mockIPC((cmd, args) => {
            invoked.push({ cmd, args });
            if (cmd === "cmd_create_named_snapshot") return 99;
            if (cmd === "cmd_append_event") return { eventId: 13, needsSnapshot: false };
            return null;
        });

        view = makeView();
        const versions = [makeVersion({ doc: "Hello" })];
        const revision = {
            ...createNewAnnotation(
                view.state.field(annotationField),
                EditorSelection.single(0, 5),
                "revision",
            ),
            activeVersionId: versions[0].id,
            versions,
        };
        view.dispatch(view.state.update({ effects: [addAnnotation.of(revision)] }));
        await flushMicrotasks();

        const snapshotIndex = invoked.findIndex((call) => call.cmd === "cmd_create_named_snapshot");
        const appendIndex = invoked.findIndex((call) => call.cmd === "cmd_append_event");
        expect(snapshotIndex).toBeGreaterThanOrEqual(0);
        expect(appendIndex).toBeGreaterThanOrEqual(0);
        expect(snapshotIndex).toBeLessThan(appendIndex);

        const args = invoked[snapshotIndex]?.args as {
            draftId: string;
            upToEventId: number;
            label: string;
            stateJson: string;
        };
        expect(args.draftId).toBe("draft-1");
        expect(args.upToEventId).toBe(12);
        expect(args.label).toBe("Before revision creation (auto)");
        const snapshotState = JSON.parse(args.stateJson) as {
            annotationField?: Record<string, unknown>;
        };
        expect(Object.keys(snapshotState.annotationField ?? {})).toHaveLength(0);
    });

    it("creates a named snapshot after a comment annotation is persisted", async () => {
        const invoked: Array<{ cmd: string; args: unknown }> = [];
        mockIPC((cmd, args) => {
            invoked.push({ cmd, args });
            if (cmd === "cmd_append_event") return { eventId: 21, needsSnapshot: false };
            if (cmd === "cmd_create_named_snapshot") return 100;
            return null;
        });

        view = makeView();
        const comment = createNewAnnotation(
            view.state.field(annotationField),
            EditorSelection.single(0, 5),
            "comment",
        );
        view.dispatch(view.state.update({ effects: [addAnnotation.of(comment)] }));
        await flushMicrotasks();

        const appendIndex = invoked.findIndex((call) => call.cmd === "cmd_append_event");
        const snapshotIndex = invoked.findIndex((call) => call.cmd === "cmd_create_named_snapshot");
        expect(appendIndex).toBeGreaterThanOrEqual(0);
        expect(snapshotIndex).toBeGreaterThanOrEqual(0);
        expect(appendIndex).toBeLessThan(snapshotIndex);

        const args = invoked[snapshotIndex]?.args as {
            draftId: string;
            upToEventId: number;
            label: string;
            stateJson: string;
        };
        expect(args.draftId).toBe("draft-1");
        expect(args.upToEventId).toBe(21);
        expect(args.label).toBe("After comment annotation (auto)");
        const snapshotState = JSON.parse(args.stateJson) as {
            annotationField?: Record<string, unknown>;
        };
        expect(snapshotState.annotationField?.[comment.id]).toBeDefined();
    });

    it("creates an autosave from the pre-change state before a sentence-sized deletion", async () => {
        const invoked: Array<{ cmd: string; args: unknown }> = [];
        lastPersistedEventId.set(31);
        mockIPC((cmd, args) => {
            invoked.push({ cmd, args });
            if (cmd === "cmd_append_event") return { eventId: 32, needsSnapshot: false };
            return null;
        });

        const original = "A sentence worth keeping lives here. The rest remains.";
        view = makeView({}, original);
        view.dispatch({
            changes: { from: 0, to: 36 },
            annotations: Transaction.userEvent.of("delete.selection"),
        });
        await flushMicrotasks();

        const snapshotIndex = invoked.findIndex((call) => call.cmd === "cmd_create_snapshot");
        const appendIndex = invoked.findIndex((call) => call.cmd === "cmd_append_event");
        expect(snapshotIndex).toBeGreaterThanOrEqual(0);
        expect(snapshotIndex).toBeLessThan(appendIndex);

        const args = invoked[snapshotIndex]?.args as {
            draftId: string;
            stateJson: string;
            upToEventId: number;
        };
        expect(args.draftId).toBe("draft-1");
        expect(args.upToEventId).toBe(31);
        expect((JSON.parse(args.stateJson) as { doc: string }).doc).toBe(original);
    });

    it("does not create a history snapshot for a single-character backspace", async () => {
        const invoked: Array<{ cmd: string; args: unknown }> = [];
        mockIPC((cmd, args) => {
            invoked.push({ cmd, args });
            if (cmd === "cmd_append_event") return { eventId: 1, needsSnapshot: false };
            return null;
        });

        view = makeView();
        view.dispatch({
            changes: { from: 10, to: 11 },
            annotations: Transaction.userEvent.of("delete.backward"),
        });
        await flushMicrotasks();

        expect(invoked.some((call) => call.cmd === "cmd_create_snapshot")).toBe(false);
    });

    it("also checkpoints sentence-sized deletions without a user-event annotation", async () => {
        const invoked: Array<{ cmd: string; args: unknown }> = [];
        mockIPC((cmd, args) => {
            invoked.push({ cmd, args });
            if (cmd === "cmd_append_event") return { eventId: 1, needsSnapshot: false };
            return null;
        });

        view = makeView({}, "Programmatic changes can remove meaningful passages too.");
        view.dispatch({ changes: { from: 0, to: 37 } });
        await flushMicrotasks();

        expect(invoked.some((call) => call.cmd === "cmd_create_snapshot")).toBe(true);
    });

    it("does not invoke cmd_append_event on selection-only updates", async () => {
        const invoked: Array<{ cmd: string; args: unknown }> = [];
        mockIPC((cmd, args) => {
            invoked.push({ cmd, args });
            return null;
        });

        view = makeView();
        view.dispatch({ selection: { anchor: 3 } });
        await flushMicrotasks();

        expect(invoked.some((call) => call.cmd === "cmd_append_event")).toBe(false);
    });

    it("respects persist=false and skips saving", async () => {
        const invoked: Array<{ cmd: string; args: unknown }> = [];
        mockIPC((cmd, args) => {
            invoked.push({ cmd, args });
            return null;
        });

        view = makeView({ persist: false });
        view.dispatch({ changes: { from: 0, insert: "Hi " } });
        await flushMicrotasks();

        expect(invoked.some((call) => call.cmd === "cmd_append_event")).toBe(false);
    });

    it("invokes the optional updateListener callback", () => {
        const onUpdate = vi.fn();
        view = makeView({ persist: false, updateListener: onUpdate });

        view.dispatch({ changes: { from: 0, insert: "Hi " } });

        expect(onUpdate).toHaveBeenCalledTimes(1);
        expect(onUpdate.mock.calls[0]?.[0].docChanged).toBe(true);
    });

    it("logs errors and does not throw when persistence fails", async () => {
        mockIPC((cmd) => {
            if (cmd === "cmd_append_event") {
                return Promise.reject(new Error("disk full"));
            }
            return null;
        });

        view = makeView();
        expect(() => {
            view?.dispatch({ changes: { from: 0, insert: "Hi " } });
        }).not.toThrow();
        await flushMicrotasks();

        expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it("updates lastPersistedEventId store after a successful append", async () => {
        mockIPC((cmd) => {
            if (cmd === "cmd_append_event") return { eventId: 42, needsSnapshot: false };
            return null;
        });

        view = makeView();
        view.dispatch({ changes: { from: 0, insert: "Hi " } });
        await flushMicrotasks();

        expect(get(lastPersistedEventId)).toBe(42);
    });

    it("triggers cmd_create_snapshot when needsSnapshot is true", async () => {
        const invoked: Array<{ cmd: string; args: unknown }> = [];
        mockIPC((cmd, args) => {
            invoked.push({ cmd, args });
            if (cmd === "cmd_append_event") return { eventId: 50, needsSnapshot: true };
            return null;
        });

        view = makeView();
        view.dispatch({ changes: { from: 0, insert: "Hi " } });
        await flushMicrotasks();

        expect(invoked.some((call) => call.cmd === "cmd_create_snapshot")).toBe(true);
        const snapshotCall = invoked.find((call) => call.cmd === "cmd_create_snapshot");
        const args = snapshotCall?.args as { draftId: string; upToEventId: number };
        expect(args.draftId).toBe("draft-1");
        expect(args.upToEventId).toBe(50);
    });

    it("skips persisting when no document or draft is set", async () => {
        currentDocumentId.set(null);
        currentDraftId.set(null);

        const invoked: Array<{ cmd: string; args: unknown }> = [];
        mockIPC((cmd, args) => {
            invoked.push({ cmd, args });
            return null;
        });

        view = makeView();
        view.dispatch({ changes: { from: 0, insert: "Hi " } });
        await flushMicrotasks();

        expect(invoked.some((call) => call.cmd === "cmd_append_event")).toBe(false);
    });

    it("persists revision version switch (revisionInternalEdit + docChanged)", async () => {
        const invoked: Array<{ cmd: string; args: unknown }> = [];
        mockIPC((cmd, args) => {
            invoked.push({ cmd, args });
            if (cmd === "cmd_append_event") return { eventId: 0, needsSnapshot: false };
            return null;
        });

        // Need full annotation extensions for version switching
        const state = EditorState.create({
            doc: "hello",
            extensions: [history({ newGroupDelay: 0 }), annotationExtensions(), listeners()],
        });
        const parent = document.createElement("div");
        document.body.appendChild(parent);
        view = new EditorView({ state, parent });

        // Add a revision with two versions
        const versions = [
            makeVersion({ doc: "hello" }),
            makeVersion({ doc: "hi" }),
            makeVersion({ doc: "hey", provenance: "ai" }),
            makeVersion({ doc: "greetings", provenance: "mixed" }),
        ];
        const revision = {
            ...createNewAnnotation(
                view.state.field(annotationField),
                EditorSelection.single(0, 5),
                "revision",
            ),
            activeVersionId: versions[0].id,
            versions,
        };
        view.dispatch(view.state.update({ effects: [addAnnotation.of(revision)] }));
        await flushMicrotasks();
        invoked.length = 0; // clear the addAnnotation event

        // Switch to version 1 — this is a revisionInternalEdit + docChanged transaction
        view.dispatch(setActiveRevisionVersion(view.state, revision.id, versions[1].id));
        await flushMicrotasks();

        // Should have persisted the event
        const appendCall = invoked.find((call) => call.cmd === "cmd_append_event");
        expect(appendCall).toBeDefined();
        const args = appendCall?.args as { payloadJson?: string };
        const payload = JSON.parse(args.payloadJson ?? "{}") as Record<string, unknown>;
        // Should be a compound payload (doc change + annotation update)
        expect(payload.type).toBe("compound");
        const annotationEvents = payload.annotationEvents as Array<{ type: string }>;
        // The annotation_update for the version switch should be present
        expect(annotationEvents.some((e) => e.type === "annotation_update")).toBe(true);
        expect((payload.provenance as { origin: string }).origin).toBe("human-revision");

        invoked.length = 0;
        view.dispatch(setActiveRevisionVersion(view.state, revision.id, versions[2].id));
        await flushMicrotasks();
        const aiPayload = JSON.parse(
            (
                invoked.find((call) => call.cmd === "cmd_append_event")?.args as {
                    payloadJson: string;
                }
            ).payloadJson,
        ) as { provenance: { origin: string } };
        expect(aiPayload.provenance.origin).toBe("ai-revision");

        invoked.length = 0;
        view.dispatch(setActiveRevisionVersion(view.state, revision.id, versions[3].id));
        await flushMicrotasks();
        const mixedPayload = JSON.parse(
            (
                invoked.find((call) => call.cmd === "cmd_append_event")?.args as {
                    payloadJson: string;
                }
            ).payloadJson,
        ) as { provenance: { origin: string } };
        expect(mixedPayload.provenance.origin).toBe("mixed-revision");
    });
});
