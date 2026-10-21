import { invokeDatabase } from "$lib/db/invoke";
import { dispatchUnlessRestarting, restartMutationFilter } from "$lib/updater/editorFreeze";
import {
    beginRestart,
    cancelRestart,
    drainDatabaseWrites,
    flushNestedForRestart,
    restartIsPending,
    restartPending,
    trackDatabaseWrite,
} from "$lib/updater/restartState";
import { EditorState, StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { mockIPC } from "@tauri-apps/api/mocks";
import { get } from "svelte/store";
import { afterEach, describe, expect, it } from "vitest";

let view: EditorView | undefined;
afterEach(() => {
    cancelRestart("attempt-1");
    cancelRestart("attempt-2");
    view?.destroy();
    view = undefined;
});

describe("update restart freeze", () => {
    it("ignores a stale cancel and duplicate prepare", () => {
        expect(beginRestart("attempt-1")).toBe(true);
        expect(beginRestart("attempt-2")).toBe(false);
        cancelRestart("attempt-2");
        expect(get(restartPending)).toBe(true);
        cancelRestart("attempt-1");
        expect(restartIsPending()).toBe(false);
        expect(beginRestart("attempt-2")).toBe(true);
        cancelRestart("attempt-1");
        expect(get(restartPending)).toBe(true);
    });

    it("blocks text and effects from UI and programmatic writers, including filter bypass", () => {
        const effect = StateEffect.define<boolean>();
        view = new EditorView({
            state: EditorState.create({ doc: "draft", extensions: restartMutationFilter }),
            dispatchTransactions: dispatchUnlessRestarting,
        });
        beginRestart("attempt-1");
        view.dispatch({ changes: { from: 0, insert: "AI " } });
        view.dispatch({ changes: { from: 0, insert: "MCP " }, filter: false });
        const state = view.state;
        view.dispatch({ effects: effect.of(true), filter: false });
        expect(view.state).toBe(state);
        expect(view.state.doc.toString()).toBe("draft");
        flushNestedForRestart(() => view?.dispatch({ changes: { from: 5, insert: " saved" } }));
        expect(view.state.doc.toString()).toBe("draft saved");
        cancelRestart("attempt-1");
        view.dispatch({ changes: { from: 11, insert: "!" } });
        expect(view.state.doc.toString()).toBe("draft saved!");
    });

    it("waits for database writes already in flight and reports their failure", async () => {
        let rejectWrite: (error: Error) => void = () => {};
        const write = new Promise<void>((_resolve, reject) => {
            rejectWrite = reject;
        });
        trackDatabaseWrite(write);
        beginRestart("attempt-1");
        let drained = false;
        const drain = drainDatabaseWrites().finally(() => {
            drained = true;
        });
        await Promise.resolve();
        expect(drained).toBe(false);
        rejectWrite(new Error("disk full"));
        await expect(drain).rejects.toThrow("could not be saved");
    });

    it("blocks structural database mutations while allowing the persistence drain", async () => {
        const calls: string[] = [];
        mockIPC((command) => {
            calls.push(command);
            return null;
        });
        beginRestart("attempt-1");
        expect(() => invokeDatabase("cmd_branch_draft")).toThrow("saving before restarting");
        await invokeDatabase("cmd_append_event");
        await invokeDatabase("cmd_update_document_meta");
        await drainDatabaseWrites();
        expect(calls).toEqual(["cmd_append_event", "cmd_update_document_meta"]);
    });
});

it("latches a failed write for one attempt and permits a clean retry after cancellation", async () => {
    beginRestart("attempt-1");
    const write = trackDatabaseWrite(Promise.reject(new Error("disk full")));
    await expect(write).rejects.toThrow("disk full");
    await expect(drainDatabaseWrites()).rejects.toThrow("could not be saved");
    await trackDatabaseWrite(Promise.resolve());
    await expect(drainDatabaseWrites()).rejects.toThrow("could not be saved");
    cancelRestart("attempt-1");
    beginRestart("attempt-2");
    await trackDatabaseWrite(Promise.resolve());
    await expect(drainDatabaseWrites()).resolves.toBeUndefined();
});
