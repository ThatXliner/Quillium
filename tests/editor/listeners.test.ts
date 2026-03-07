import { describe, it, expect, vi, afterEach } from "vitest";
import { EditorView } from "@codemirror/view";
import { EditorSelection, EditorState } from "@codemirror/state";
import { mockIPC } from "@tauri-apps/api/mocks";
import { listeners } from "$lib/editor/listeners";
import {
    addAnnotation,
    annotationField,
} from "$lib/editor/plugins/annotations/annotationField";
import { createNewAnnotation } from "$lib/editor/plugins/annotations/models";

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

afterEach(() => {
    view?.destroy();
    view = undefined;
});

describe("listeners integration", () => {
    it("invokes save when the document changes", async () => {
        const invoked: Array<{ cmd: string; args: unknown }> = [];
        mockIPC((cmd, args) => {
            invoked.push({ cmd, args });
            return null;
        });

        view = makeView();
        view.dispatch({ changes: { from: 0, insert: "Hi " } });
        await flushMicrotasks();

        expect(invoked.some((call) => call.cmd === "save")).toBe(true);
    });

    it("invokes save when annotations change even without doc changes", async () => {
        const invoked: Array<{ cmd: string; args: unknown }> = [];
        mockIPC((cmd, args) => {
            invoked.push({ cmd, args });
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

        expect(invoked.some((call) => call.cmd === "save")).toBe(true);
    });

    it("sends serialized editor state containing updated document text", async () => {
        const invoked: Array<{ cmd: string; args: unknown }> = [];
        mockIPC((cmd, args) => {
            invoked.push({ cmd, args });
            return null;
        });

        view = makeView();
        view.dispatch({ changes: { from: 0, insert: "Draft: " } });
        await flushMicrotasks();

        const saveCall = invoked.find((call) => call.cmd === "save");
        expect(saveCall).toBeDefined();
        const payload = (saveCall?.args ?? {}) as { state?: string };
        expect(payload.state).toBeTypeOf("string");
        expect(payload.state ?? "").toContain("Draft: Hello world");
    });

    it("serializes annotation state in save payload after annotation updates", async () => {
        const invoked: Array<{ cmd: string; args: unknown }> = [];
        mockIPC((cmd, args) => {
            invoked.push({ cmd, args });
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

        const saveCall = invoked.find((call) => call.cmd === "save");
        expect(saveCall).toBeDefined();
        const payload = (saveCall?.args ?? {}) as { state?: string };
        const decoded = JSON.parse(payload.state ?? "{}") as Record<string, unknown>;
        expect(decoded.annotationField).toBeDefined();
    });

    it("does not invoke save on selection-only updates", async () => {
        const invoked: Array<{ cmd: string; args: unknown }> = [];
        mockIPC((cmd, args) => {
            invoked.push({ cmd, args });
            return null;
        });

        view = makeView();
        view.dispatch({ selection: { anchor: 3 } });
        await flushMicrotasks();

        expect(invoked.some((call) => call.cmd === "save")).toBe(false);
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

        expect(invoked.some((call) => call.cmd === "save")).toBe(false);
    });

    it("invokes the optional updateListener callback", () => {
        const onUpdate = vi.fn();
        view = makeView({ persist: false, updateListener: onUpdate });

        view.dispatch({ changes: { from: 0, insert: "Hi " } });

        expect(onUpdate).toHaveBeenCalledTimes(1);
        expect(onUpdate.mock.calls[0]?.[0].docChanged).toBe(true);
    });
});
