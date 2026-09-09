import { isCollabJoiner } from "$lib/collab/store";
import {
    flushPersistQueue,
    flushPersistence,
    listeners,
    persistNamedVersion,
    seedPersistenceBookkeeping,
} from "$lib/editor/listeners";
import { annotations as annotationExtensions } from "$lib/editor/plugins/annotations";
import {
    _updateRevisionVersionState,
    addAnnotation,
    annotationField,
    applySuggestion,
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
import {
    currentDocumentId,
    currentDocumentTitle,
    currentDraftId,
    lastPersistedEventId,
    lastSavedAt,
    saveStatus,
} from "$lib/stores";
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
    currentDocumentTitle.set("Untitled");
    seedPersistenceBookkeeping();
    isCollabJoiner.set(false);
});

afterEach(async () => {
    await flushPersistence();
    vi.useRealTimers();
    view?.destroy();
    view = undefined;
    consoleErrorSpy.mockRestore();
    currentDocumentId.set(null);
    currentDraftId.set(null);
    lastPersistedEventId.set(-1);
    lastSavedAt.set(null);
});

describe("listeners integration", () => {
    it("checkpoints the latest edit before leaving below the automatic snapshot threshold", async () => {
        const snapshots: Array<{ draftId: string; stateJson: string; upToEventId: number }> = [];
        mockIPC((cmd, args) => {
            if (cmd === "cmd_append_event") return { eventId: 7, needsSnapshot: false };
            if (cmd === "cmd_create_snapshot") snapshots.push(args as (typeof snapshots)[number]);
            return null;
        });
        view = makeView();
        view.dispatch({ changes: { from: 11, insert: "!" } });
        await flushPersistQueue();
        expect(snapshots).toHaveLength(0);
        await flushPersistence();
        expect(snapshots).toHaveLength(1);
        expect(snapshots[0]).toMatchObject({ draftId: "draft-1", upToEventId: 7 });
        expect(JSON.parse(snapshots[0].stateJson).doc).toBe("Hello world!");
    });

    it("deduplicates repeated flushes and awaits the delayed checkpoint", async () => {
        const snapshots: unknown[] = [];
        let releaseSnapshot!: () => void;
        mockIPC((cmd, args) => {
            if (cmd === "cmd_append_event") return { eventId: 8, needsSnapshot: false };
            if (cmd === "cmd_create_snapshot") {
                snapshots.push(args);
                return new Promise<void>((resolve) => {
                    releaseSnapshot = resolve;
                });
            }
            return null;
        });

        view = makeView();
        view.dispatch({ changes: { from: 11, insert: "!" } });
        const firstFlush = flushPersistence();
        const secondFlush = flushPersistence();

        await vi.waitFor(() => expect(releaseSnapshot).toBeDefined());
        expect(snapshots).toHaveLength(1);
        let finished = false;
        void Promise.all([firstFlush, secondFlush]).then(() => {
            finished = true;
        });
        await flushMicrotasks();
        expect(finished).toBe(false);
        releaseSnapshot();
        await Promise.all([firstFlush, secondFlush]);
        expect(snapshots).toHaveLength(1);
    });

    it("keeps later edits after the captured flush barrier", async () => {
        const snapshots: Array<{ stateJson: string; upToEventId: number }> = [];
        let releaseSnapshot!: () => void;
        let appendCount = 0;
        mockIPC((cmd, args) => {
            if (cmd === "cmd_append_event") return { eventId: ++appendCount, needsSnapshot: false };
            if (cmd === "cmd_create_snapshot") {
                snapshots.push(args as (typeof snapshots)[number]);
                if (snapshots.length === 1) {
                    return new Promise<void>((resolve) => {
                        releaseSnapshot = resolve;
                    });
                }
            }
            return null;
        });

        view = makeView();
        view.dispatch({ changes: { from: 11, insert: " first" } });
        const firstFlush = flushPersistence();
        view.dispatch({ changes: { from: view.state.doc.length, insert: " later" } });
        const secondFlush = flushPersistence();

        await vi.waitFor(() => expect(releaseSnapshot).toBeDefined());
        expect(snapshots).toHaveLength(1);
        expect(JSON.parse(snapshots[0].stateJson).doc).toBe("Hello world first");
        releaseSnapshot();
        await Promise.all([firstFlush, secondFlush]);

        expect(snapshots).toHaveLength(2);
        expect(JSON.parse(snapshots[1].stateJson).doc).toBe("Hello world first later");
    });

    it("reuses a named version at the latest event when leaving", async () => {
        const snapshots: string[] = [];
        mockIPC((cmd) => {
            if (cmd === "cmd_append_event") return { eventId: 13, needsSnapshot: false };
            if (cmd === "cmd_create_snapshot" || cmd === "cmd_create_named_snapshot") {
                snapshots.push(cmd);
            }
            return 1;
        });
        view = makeView();
        view.dispatch({ changes: { from: 11, insert: "!" } });
        await persistNamedVersion(
            "draft-1",
            JSON.stringify(view.state.toJSON()),
            "Latest",
            () => true,
        );
        await flushPersistence();
        expect(snapshots).toEqual(["cmd_create_named_snapshot"]);
    });

    it("checkpoints effect-only edits on flush", async () => {
        const snapshots: Array<{ stateJson: string; upToEventId: number }> = [];
        mockIPC((cmd, args) => {
            if (cmd === "cmd_append_event") return { eventId: 14, needsSnapshot: false };
            if (cmd === "cmd_create_snapshot") snapshots.push(args as (typeof snapshots)[number]);
            return null;
        });

        view = makeView();
        const { spec } = createVersionGroup("Linked", [
            { revisionId: 1, versionId: "one" },
            { revisionId: 2, versionId: "two" },
        ]);
        view.dispatch(spec);
        await flushPersistence();

        expect(snapshots).toHaveLength(1);
        expect(JSON.parse(snapshots[0].stateJson).versionGroupField).toBeDefined();
        expect(snapshots[0].upToEventId).toBe(14);
    });

    it("retries a failed flush checkpoint while keeping the queue usable", async () => {
        let snapshotAttempts = 0;
        const snapshotError = new Error("disk full");
        mockIPC((cmd) => {
            if (cmd === "cmd_append_event") return { eventId: 15, needsSnapshot: false };
            if (cmd === "cmd_create_snapshot") {
                snapshotAttempts += 1;
                if (snapshotAttempts === 1) return Promise.reject(snapshotError);
            }
            return null;
        });

        view = makeView();
        view.dispatch({ changes: { from: 11, insert: "!" } });
        await expect(flushPersistence()).rejects.toBe(snapshotError);
        expect(consoleErrorSpy).toHaveBeenCalledWith(
            "[listeners] flush snapshot failed:",
            snapshotError,
        );
        await expect(flushPersistence()).resolves.toBeUndefined();
        expect(snapshotAttempts).toBe(2);
    });

    it("isolates a pending checkpoint when the draft is seeded", async () => {
        const snapshots: Array<{ draftId: string; stateJson: string }> = [];
        mockIPC((cmd, args) => {
            if (cmd === "cmd_append_event") return { eventId: 16, needsSnapshot: false };
            if (cmd === "cmd_create_snapshot") snapshots.push(args as (typeof snapshots)[number]);
            return null;
        });

        view = makeView();
        view.dispatch({ changes: { from: 11, insert: "!" } });
        await flushPersistQueue();
        currentDraftId.set("draft-2");
        seedPersistenceBookkeeping(90);
        await flushPersistence();
        expect(snapshots).toHaveLength(0);

        view.dispatch({ changes: { from: view.state.doc.length, insert: " new" } });
        await flushPersistence();
        expect(snapshots).toHaveLength(1);
        expect(snapshots[0].draftId).toBe("draft-2");
    });

    it("does not checkpoint after an append failure even if a later append succeeds", async () => {
        let appendCount = 0;
        const snapshots: unknown[] = [];
        mockIPC((cmd, args) => {
            if (cmd === "cmd_append_event") {
                appendCount += 1;
                if (appendCount === 1) return Promise.reject(new Error("disk full"));
                return { eventId: 17, needsSnapshot: false };
            }
            if (cmd === "cmd_create_snapshot") snapshots.push(args);
            return null;
        });

        view = makeView();
        view.dispatch({ changes: { from: 11, insert: " first" } });
        view.dispatch({ changes: { from: view.state.doc.length, insert: " later" } });
        await flushPersistence();

        expect(appendCount).toBe(2);
        expect(snapshots).toHaveLength(0);
    });

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
        await flushPersistence();
        expect(invoked.filter((call) => call.cmd === "cmd_create_snapshot")).toHaveLength(0);
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

    it("does not persist or snapshot an ephemeral collaboration joiner", async () => {
        isCollabJoiner.set(true);
        const invoked: string[] = [];
        mockIPC((cmd) => {
            invoked.push(cmd);
            return null;
        });
        view = makeView();
        view.dispatch({ changes: { from: 0, to: 11, insert: "Changed" } });
        await flushPersistence();
        expect(invoked).toEqual([]);
        isCollabJoiner.set(false);
    });

    it("falls back to the threshold snapshot when the comment autosave fails", async () => {
        const invoked: string[] = [];
        mockIPC((cmd) => {
            invoked.push(cmd);
            if (cmd === "cmd_append_event") return { eventId: 4, needsSnapshot: true };
            if (cmd === "cmd_create_named_snapshot")
                return Promise.reject(new Error("named snapshot failed"));
            return null;
        });
        view = makeView();
        const comment = createNewAnnotation(
            view.state.field(annotationField),
            EditorSelection.single(0, 5),
            "comment",
        );
        view.dispatch({ effects: addAnnotation.of(comment) });
        await flushPersistQueue();
        expect(invoked).toEqual([
            "cmd_append_event",
            "cmd_create_named_snapshot",
            "cmd_create_snapshot",
        ]);
        expect(get(saveStatus)).toBe("saved");
    });

    it("continues the ordered queue after a failed append", async () => {
        let count = 0;
        mockIPC((cmd) => {
            if (cmd !== "cmd_append_event") return null;
            if (++count === 1) return Promise.reject(new Error("disk full"));
            return { eventId: 8, needsSnapshot: false };
        });
        view = makeView();
        view.dispatch({ changes: { from: 0, insert: "One " } });
        view.dispatch({ changes: { from: 0, insert: "Two " } });
        await flushPersistence();
        expect(count).toBe(2);
        expect(get(lastPersistedEventId)).toBe(8);
        expect(get(saveStatus)).toBe("saved");
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
        await flushPersistence();
        expect(invoked.filter((call) => call.cmd === "cmd_create_snapshot")).toHaveLength(1);
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
        const aiGeneration = {
            requestId: "request-1",
            task: "local-rewrite" as const,
            provider: "openai",
            model: "gpt-5.6-sol",
            createdAt: 1234,
        };
        const versions = [
            makeVersion({ doc: "hello" }),
            makeVersion({ doc: "hi" }),
            makeVersion({ doc: "hey", provenance: "ai", aiProvenance: aiGeneration }),
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
        ) as { provenance: { origin: string; aiGenerations?: unknown[] } };
        expect(aiPayload.provenance.origin).toBe("ai-revision");
        expect(aiPayload.provenance.aiGenerations).toEqual([aiGeneration]);

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

    it("carries AI request provenance when a suggestion is applied", async () => {
        const invoked: Array<{ cmd: string; args: unknown }> = [];
        mockIPC((cmd, args) => {
            invoked.push({ cmd, args });
            if (cmd === "cmd_append_event") return { eventId: 0, needsSnapshot: false };
            return null;
        });

        view = makeView({}, "Hello world");
        const aiGeneration = {
            requestId: "request-suggestion",
            task: "local-rewrite" as const,
            provider: "openai",
            model: "gpt-5.6-sol",
            createdAt: 2345,
        };
        const suggestion = {
            ...createNewAnnotation(
                view.state.field(annotationField),
                EditorSelection.single(0, 5),
                "suggestion",
            ),
            replacements: [{ text: "Hi" }],
            author: "AI",
            aiProvenance: aiGeneration,
        };
        view.dispatch({ effects: [addAnnotation.of(suggestion)] });
        await flushMicrotasks();
        invoked.length = 0;

        view.dispatch(applySuggestion(view.state, suggestion.id, 0));
        await flushMicrotasks();

        const appendCall = invoked.find((call) => call.cmd === "cmd_append_event");
        const args = appendCall?.args as { payloadJson?: string };
        const payload = JSON.parse(args.payloadJson ?? "{}") as {
            provenance?: { origin: string; aiGenerations?: unknown[] };
        };
        expect(view.state.doc.toString()).toBe("Hi world");
        expect(payload.provenance?.origin).toBe("ai-revision");
        expect(payload.provenance?.aiGenerations).toEqual([aiGeneration]);
    });
});

describe("persistence timing and identity", () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    });

    it("waits for ordered appends, then the latest metadata write", async () => {
        const writes: string[] = [];
        let finishAppend!: (value: unknown) => void;
        let finishMeta!: () => void;
        mockIPC((cmd, args) => {
            if (cmd === "cmd_append_event") {
                writes.push("append");
                if (writes.length === 1)
                    return new Promise((resolve) => {
                        finishAppend = resolve;
                    });
                return { eventId: 2, needsSnapshot: false };
            }
            if (cmd === "cmd_update_document_meta") {
                writes.push((args as { bodyText: string }).bodyText);
                return new Promise<void>((resolve) => {
                    finishMeta = resolve;
                });
            }
            return null;
        });
        view = makeView();
        view.dispatch({ changes: { from: 0, insert: "One " } });
        view.dispatch({ changes: { from: 0, insert: "Two " } });
        let flushed = false;
        const flush = flushPersistence().then(() => {
            flushed = true;
        });
        await vi.advanceTimersByTimeAsync(0);
        expect(writes).toEqual(["append"]);
        expect(flushed).toBe(false);
        finishAppend({ eventId: 1, needsSnapshot: false });
        await vi.advanceTimersByTimeAsync(0);
        expect(writes).toEqual(["append", "append", "Two One Hello world"]);
        expect(flushed).toBe(false);
        finishMeta();
        await flush;
        expect(flushed).toBe(true);
        expect(get(lastPersistedEventId)).toBe(2);
    });

    it("also awaits a metadata write whose debounce already fired", async () => {
        let finishMeta!: () => void;
        mockIPC((cmd) => {
            if (cmd === "cmd_append_event") return { eventId: 1, needsSnapshot: false };
            if (cmd === "cmd_update_document_meta") {
                return new Promise<void>((resolve) => {
                    finishMeta = resolve;
                });
            }
            return null;
        });
        view = makeView();
        view.dispatch({ changes: { from: 0, insert: "Hi " } });
        await flushPersistQueue();
        await vi.advanceTimersByTimeAsync(500);
        let flushed = false;
        const flush = flushPersistence().then(() => {
            flushed = true;
        });
        await vi.advanceTimersByTimeAsync(0);
        expect(flushed).toBe(false);
        finishMeta();
        await flush;
        expect(flushed).toBe(true);
    });

    it.each([false, true])(
        "keeps old-draft completion out of new-draft stores, failure=%s",
        async (fails) => {
            let finishAppend!: (value: unknown) => void;
            let failAppend!: (reason: unknown) => void;
            const draftIds: string[] = [];
            mockIPC((cmd, args) => {
                if (cmd === "cmd_append_event") {
                    draftIds.push((args as { draftId: string }).draftId);
                    return new Promise((resolve, reject) => {
                        finishAppend = resolve;
                        failAppend = reject;
                    });
                }
                return null;
            });
            view = makeView();
            view.dispatch({ changes: { from: 0, insert: "Hi " } });
            await vi.advanceTimersByTimeAsync(149);
            expect(get(saveStatus)).toBe("saved");
            await vi.advanceTimersByTimeAsync(1);
            expect(get(saveStatus)).toBe("saving");
            currentDraftId.set("draft-2");
            seedPersistenceBookkeeping(90);
            if (fails) failAppend(new Error("disk full"));
            else finishAppend({ eventId: 1, needsSnapshot: false });
            await flushPersistence();
            expect(draftIds).toEqual(["draft-1"]);
            expect(get(saveStatus)).toBe("saved");
            expect(get(lastPersistedEventId)).toBe(90);
            expect(get(lastSavedAt)).toBe(null);
        },
    );

    it("does not show the delayed indicator after switching drafts", async () => {
        let finishAppend!: (value: unknown) => void;
        mockIPC((cmd) =>
            cmd === "cmd_append_event"
                ? new Promise((resolve) => {
                      finishAppend = resolve;
                  })
                : null,
        );
        view = makeView();
        view.dispatch({ changes: { from: 0, insert: "Hi " } });
        await vi.advanceTimersByTimeAsync(0);
        currentDraftId.set("draft-2");
        await vi.advanceTimersByTimeAsync(150);
        expect(get(saveStatus)).toBe("saved");
        finishAppend({ eventId: 1, needsSnapshot: false });
        await flushPersistence();
    });

    it("flushes old-document metadata without borrowing the new document's title", async () => {
        const metadata: unknown[] = [];
        let finishAppend!: (value: unknown) => void;
        currentDocumentTitle.set("Original title");
        mockIPC((cmd, args) => {
            if (cmd === "cmd_append_event")
                return new Promise((resolve) => {
                    finishAppend = resolve;
                });
            if (cmd === "cmd_update_document_meta") metadata.push(args);
            return null;
        });
        view = makeView();
        view.dispatch({ changes: { from: 0, insert: "Hi " } });
        await vi.advanceTimersByTimeAsync(0);
        currentDocumentId.set("doc-2");
        currentDocumentTitle.set("New title");
        finishAppend({ eventId: 1, needsSnapshot: false });
        await flushPersistence();
        expect(metadata).toEqual([
            expect.objectContaining({
                id: "doc-1",
                title: "Original title",
                bodyText: "Hi Hello world",
            }),
        ]);
        expect(get(currentDocumentTitle)).toBe("New title");
    });
});

describe("named version persistence", () => {
    it("waits for pending edits and keeps later edits after the captured snapshot", async () => {
        let release!: (result: unknown) => void;
        const calls: Array<{ cmd: string; args: Record<string, unknown> }> = [];
        let eventId = 40;
        mockIPC((cmd, args) => {
            calls.push({ cmd, args: args as Record<string, unknown> });
            if (cmd === "cmd_append_event") {
                eventId++;
                if (eventId === 41)
                    return new Promise((resolve) => {
                        release = resolve;
                    });
                return { eventId, needsSnapshot: false };
            }
            if (cmd === "cmd_create_named_snapshot") return 9;
            return null;
        });
        view = makeView();
        view.dispatch({ changes: { from: 11, insert: " latest" } });
        await vi.waitFor(() => expect(release).toBeDefined());
        const checkpoint = persistNamedVersion(
            "draft-1",
            JSON.stringify(view.state.toJSON()),
            "Opening",
            () => true,
        );
        view.dispatch({ changes: { from: view.state.doc.length, insert: " later" } });
        expect(calls.some((call) => call.cmd === "cmd_create_named_snapshot")).toBe(false);
        release({ eventId: 41, needsSnapshot: false });
        expect(await checkpoint).toBe(9);
        await flushPersistence();
        const snapshot = calls.find((call) => call.cmd === "cmd_create_named_snapshot")!;
        expect(snapshot.args).toMatchObject({
            draftId: "draft-1",
            upToEventId: 41,
            label: "Opening",
        });
        expect(JSON.parse(snapshot.args.stateJson as string).doc).toBe("Hello world latest");
        expect(
            calls
                .filter((call) =>
                    ["cmd_append_event", "cmd_create_named_snapshot"].includes(call.cmd),
                )
                .map((call) => call.cmd),
        ).toEqual(["cmd_append_event", "cmd_create_named_snapshot", "cmd_append_event"]);
    });

    it("does not create a checkpoint after an event failure, even if a later event succeeds", async () => {
        const named = vi.fn();
        let appends = 0;
        mockIPC((cmd) => {
            if (cmd === "cmd_append_event") {
                if (++appends === 1) throw new Error("disk full");
                return { eventId: 2, needsSnapshot: false };
            }
            if (cmd === "cmd_create_named_snapshot") named();
            return null;
        });
        view = makeView();
        view.dispatch({ changes: { from: 0, insert: "a" } });
        view.dispatch({ changes: { from: 0, insert: "b" } });
        await expect(persistNamedVersion("draft-1", "{}", "Opening", () => true)).rejects.toThrow(
            "could not be saved",
        );
        expect(named).not.toHaveBeenCalled();
    });

    it("discards a request invalidated while persistence was pending", async () => {
        const named = vi.fn();
        mockIPC((cmd) => {
            if (cmd === "cmd_create_named_snapshot") named();
            return null;
        });
        expect(await persistNamedVersion("draft-1", "{}", "Opening", () => false)).toBeNull();
        expect(named).not.toHaveBeenCalled();
    });
});

it("keeps navigation behind a named snapshot write and permits retry after snapshot failure", async () => {
    let reject!: (error: Error) => void;
    let attempts = 0;
    mockIPC((cmd) => {
        if (cmd === "cmd_create_named_snapshot") {
            if (++attempts === 1)
                return new Promise((_resolve, no) => {
                    reject = no;
                });
            return 12;
        }
        return null;
    });
    const saving = persistNamedVersion("draft-1", "{}", "Opening", () => true);
    const failure = expect(saving).rejects.toThrow("disk full");
    let flushed = false;
    const navigation = flushPersistence().then(() => {
        flushed = true;
    });
    await vi.waitFor(() => expect(reject).toBeDefined());
    expect(flushed).toBe(false);
    reject(new Error("disk full"));
    await failure;
    await navigation;
    expect(await persistNamedVersion("draft-1", "{}", "Opening", () => true)).toBe(12);
});
