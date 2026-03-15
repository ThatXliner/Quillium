import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { EditorView } from "@codemirror/view";
import { EditorSelection, EditorState } from "@codemirror/state";
import { mockIPC } from "@tauri-apps/api/mocks";
import { listeners } from "$lib/editor/listeners";
import {
    addAnnotation,
    annotationField,
    setActiveRevisionVersion,
} from "$lib/editor/plugins/annotations/annotationField";
import { createNewAnnotation, isAnnotationOfType } from "$lib/editor/plugins/annotations/models";
import { annotations as annotationExtensions } from "$lib/editor/plugins/annotations";
import { history } from "@codemirror/commands";
import { currentDocumentId, currentDraftId } from "$lib/stores";

function makeView(options: Parameters<typeof listeners>[0] = {}) {
    const state = EditorState.create({
        doc: "Hello world",
        extensions: [annotationField, listeners(options)],
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
        const revision = {
            ...createNewAnnotation(
                view.state.field(annotationField),
                EditorSelection.single(0, 5),
                "revision",
            ),
            activeVersionIndex: 0,
            versions: [{ doc: "hello" }, { doc: "hi" }],
        };
        view.dispatch(view.state.update({ effects: [addAnnotation.of(revision)] }));
        await flushMicrotasks();
        invoked.length = 0; // clear the addAnnotation event

        // Switch to version 1 — this is a revisionInternalEdit + docChanged transaction
        view.dispatch(setActiveRevisionVersion(view.state, revision.id, 1));
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
    });
});
