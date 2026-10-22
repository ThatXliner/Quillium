import { LiveSessionController } from "$lib/collab/liveSession.svelte";
import { isCollabJoiner } from "$lib/collab/store";
import {
    flushPersistQueue,
    flushPersistence,
    listeners,
    seedPersistenceBookkeeping,
} from "$lib/editor/listeners";
import { annotationField } from "$lib/editor/plugins/annotations/annotationField";
import { versionGroupField } from "$lib/editor/plugins/annotations/versionGroupField";
import { readBackup, saveEmergencyBackup, saveEmergencySnapshot } from "$lib/errorGuard";
import {
    currentDocumentId,
    currentDocumentTitle,
    currentDraftId,
    documentContent,
    editorView,
} from "$lib/stores";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const collab = vi.hoisted(() => ({
    enableCollab: vi.fn().mockResolvedValue(undefined),
    disableCollab: vi.fn(),
    registerDocumentForCollab: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("$lib/collab", async (importOriginal) => ({
    ...(await importOriginal<typeof import("$lib/collab")>()),
    ...collab,
}));
vi.mock("$lib/auth/auth.svelte", async (importOriginal) => ({
    ...(await importOriginal<typeof import("$lib/auth/auth.svelte")>()),
    getUser: () => ({ id: "owner-1" }),
    getSession: () => ({ access_token: "test-session" }),
}));

let view: EditorView;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    vi.clearAllMocks();
    collab.registerDocumentForCollab.mockResolvedValue(undefined);
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    currentDocumentId.set("doc-1");
    currentDraftId.set("draft-1");
    currentDocumentTitle.set("Draft title");
    isCollabJoiner.set(false);
    seedPersistenceBookkeeping(6);
    localStorage.removeItem("quillium_backup_crash");
    view = new EditorView({
        state: EditorState.create({
            doc: "Hello world",
            extensions: [annotationField, versionGroupField, listeners()],
        }),
        parent: document.body,
    });
    editorView.set(view);
});

it("refuses to start collaboration if an edit fails during room registration", async () => {
    let releaseRegistration!: () => void;
    collab.registerDocumentForCollab.mockImplementationOnce(
        () =>
            new Promise<void>((resolve) => {
                releaseRegistration = resolve;
            }),
    );
    mockIPC((cmd) => {
        if (cmd === "cmd_create_named_snapshot") return 12;
        if (cmd === "cmd_append_event") throw new Error("disk full");
        return null;
    });
    const controller = new LiveSessionController();
    const starting = controller.toggle();
    await vi.waitFor(() => expect(releaseRegistration).toBeDefined());
    view.dispatch({ changes: { from: 11, insert: " missing" } });
    releaseRegistration();
    await starting;

    expect(collab.enableCollab).not.toHaveBeenCalled();
    expect(controller.isLive).toBe(false);
});

afterEach(async () => {
    await flushPersistence().catch(() => {});
    view.destroy();
    currentDocumentId.set(null);
    currentDraftId.set(null);
    documentContent.set("");
    consoleErrorSpy.mockRestore();
});

const actions = {
    crash: async () => {
        documentContent.set(view.state.doc.toString());
        saveEmergencyBackup("Unrelated rendering error");
        saveEmergencySnapshot("Crash recovery");
    },
    "go live": () => new LiveSessionController().toggle(),
};

describe.each(["crash", "go live"] as const)("%s snapshots", (action) => {
    it("does not snapshot uncertain history after a later append succeeds", async () => {
        const named = vi.fn();
        let appends = 0;
        mockIPC((cmd) => {
            if (cmd === "cmd_append_event") {
                if (++appends === 1) throw new Error("disk full");
                return { eventId: 8, needsSnapshot: false };
            }
            if (cmd === "cmd_create_named_snapshot") named();
            return null;
        });
        view.dispatch({ changes: { from: 11, insert: " missing" } });
        view.dispatch({ changes: { from: view.state.doc.length, insert: " later" } });
        await expect(flushPersistQueue()).rejects.toThrow("could not be saved");

        await actions[action]();
        await expect(flushPersistQueue()).rejects.toThrow("could not be saved");

        expect(named).not.toHaveBeenCalled();
        expect(collab.registerDocumentForCollab).not.toHaveBeenCalled();
        expect(collab.enableCollab).not.toHaveBeenCalled();
        if (action === "crash") {
            expect(readBackup("crash")?.documentText).toBe("Hello world missing later");
        }
    });

    it("queues the captured state after its pending append and before later edits", async () => {
        let releaseAppend!: (result: { eventId: number; needsSnapshot: boolean }) => void;
        const snapshots: unknown[] = [];
        let appends = 0;
        mockIPC((cmd, args) => {
            if (cmd === "cmd_append_event") {
                if (++appends === 1) {
                    return new Promise((resolve) => {
                        releaseAppend = resolve;
                    });
                }
                return { eventId: 8, needsSnapshot: false };
            }
            if (cmd === "cmd_create_named_snapshot") {
                snapshots.push(args);
                return 12;
            }
            return null;
        });
        view.dispatch({ changes: { from: 11, insert: " captured" } });
        await vi.waitFor(() => expect(releaseAppend).toBeDefined());

        const saving = actions[action]();
        view.dispatch({ changes: { from: view.state.doc.length, insert: " later" } });
        const earlySnapshots = [...snapshots];
        releaseAppend({ eventId: 7, needsSnapshot: false });
        await saving;
        await flushPersistQueue();

        expect(earlySnapshots).toEqual([]);
        expect(snapshots).toEqual([
            expect.objectContaining({
                draftId: "draft-1",
                stateJson: expect.stringContaining('"doc":"Hello world captured"'),
                upToEventId: 7,
            }),
        ]);
        if (action === "go live") expect(collab.enableCollab).toHaveBeenCalledOnce();
    });
});
