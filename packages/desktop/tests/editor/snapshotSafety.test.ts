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
    errorBanner,
    saveStatus,
} from "$lib/stores";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { mockIPC } from "@tauri-apps/api/mocks";
import { get } from "svelte/store";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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
vi.mock("$lib/appLog", () => ({ logAppEvent: vi.fn().mockResolvedValue(undefined) }));

let view: EditorView;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeAll(async () => {
    await import("../../src/hooks.client");
});

beforeEach(() => {
    vi.clearAllMocks();
    collab.registerDocumentForCollab.mockResolvedValue(undefined);
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    currentDocumentId.set("doc-1");
    currentDraftId.set("draft-1");
    currentDocumentTitle.set("Draft title");
    isCollabJoiner.set(false);
    seedPersistenceBookkeeping(6);
    errorBanner.set(null);
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

it.each(["before crash", "after crash"])(
    "keeps the crash backup accessible when the pending append fails %s",
    async (failureTiming) => {
        let rejectAppend!: (error: Error) => void;
        let appends = 0;
        const named = vi.fn();
        mockIPC((cmd) => {
            if (cmd === "cmd_append_event") {
                if (++appends === 1) {
                    return new Promise((_resolve, reject) => {
                        rejectAppend = reject;
                    });
                }
                return { eventId: 8, needsSnapshot: false };
            }
            if (cmd === "cmd_create_named_snapshot") named();
            return null;
        });
        view.dispatch({ changes: { from: 11, insert: " missing" } });
        await vi.waitFor(() => expect(rejectAppend).toBeDefined());
        if (failureTiming === "before crash") {
            rejectAppend(new Error("disk full"));
            await expect(flushPersistQueue()).rejects.toThrow("could not be saved");
            expect(get(errorBanner)).toMatchObject({ hasBackup: false, backupType: "auto" });
        }

        documentContent.set(view.state.doc.toString());
        const crash = new Event("unhandledrejection", { cancelable: true });
        Object.defineProperty(crash, "reason", { value: new Error("Unrelated rendering error") });
        window.dispatchEvent(crash);
        const crashBanner = get(errorBanner);
        expect(crashBanner).toMatchObject({ hasBackup: true, backupType: "crash" });

        if (failureTiming === "after crash") rejectAppend(new Error("disk full"));
        view.dispatch({ changes: { from: view.state.doc.length, insert: " later" } });
        await expect(flushPersistence()).rejects.toThrow("could not be saved");

        expect(get(errorBanner)).toEqual(crashBanner);
        expect(get(saveStatus)).toBe("error");
        expect(readBackup("crash")?.documentText).toBe("Hello world missing");
        expect(named).not.toHaveBeenCalled();
    },
);

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

it("uses the document room while snapshots and owner edits stay on the active draft", async () => {
    const snapshots: unknown[] = [];
    const events: unknown[] = [];
    mockIPC((cmd, args) => {
        if (cmd === "cmd_create_named_snapshot") {
            snapshots.push(args);
            return 12;
        }
        if (cmd === "cmd_append_event") {
            events.push(args);
            return { eventId: 7, needsSnapshot: false };
        }
        return null;
    });
    const controller = new LiveSessionController();
    await controller.toggle();

    expect(controller.isLive).toBe(true);
    expect(collab.registerDocumentForCollab).toHaveBeenCalledWith("doc-1", "owner-1", "Untitled");
    expect(collab.enableCollab).toHaveBeenCalledWith(view, "doc-1", "owner-1");
    expect(snapshots).toEqual([
        expect.objectContaining({ draftId: "draft-1", label: "Before going live (auto)" }),
    ]);
    expect(get(currentDraftId)).toBe("draft-1");
    view.dispatch({ changes: { from: view.state.doc.length, insert: " while live" } });
    await flushPersistQueue();
    expect(events).toEqual([expect.objectContaining({ draftId: "draft-1" })]);
});

it.each(["document", "draft"])(
    "does not start if the active %s changes during registration",
    async (target) => {
        collab.registerDocumentForCollab.mockImplementationOnce(async () => {
            if (target === "document") currentDocumentId.set("doc-2");
            else currentDraftId.set("draft-2");
        });
        mockIPC((cmd) => (cmd === "cmd_create_named_snapshot" ? 12 : null));
        const controller = new LiveSessionController();
        await controller.toggle();
        expect(collab.enableCollab).not.toHaveBeenCalled();
        expect(controller.isLive).toBe(false);
    },
);

it("does not start without a document identity even when a draft is open", async () => {
    currentDocumentId.set(null);
    const controller = new LiveSessionController();
    await controller.toggle();
    expect(collab.registerDocumentForCollab).not.toHaveBeenCalled();
    expect(collab.enableCollab).not.toHaveBeenCalled();
    expect(controller.isLive).toBe(false);
});
