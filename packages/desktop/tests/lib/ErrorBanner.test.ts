import ErrorBanner from "$lib/ErrorBanner.svelte";
import { isCollabJoiner } from "$lib/collab/store";
import {
    flushPersistQueue,
    flushPersistence,
    listeners,
    seedPersistenceBookkeeping,
} from "$lib/editor/listeners";
import { annotationField } from "$lib/editor/plugins/annotations/annotationField";
import { versionGroupField } from "$lib/editor/plugins/annotations/versionGroupField";
import { currentDocumentId, currentDocumentTitle, currentDraftId, errorBanner } from "$lib/stores";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { mockIPC } from "@tauri-apps/api/mocks";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { tick } from "svelte";
import { get } from "svelte/store";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { goto } = vi.hoisted(() => ({ goto: vi.fn() }));

vi.mock("$app/navigation", () => ({ goto }));
vi.mock("$app/stores", async () => ({
    page: (await import("svelte/store")).readable({ url: new URL("http://localhost/") }),
}));
vi.mock("$lib/posthog", () => ({
    default: { capture: vi.fn() },
    captureException: vi.fn(),
}));

let view: EditorView;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    goto.mockReset().mockResolvedValue(undefined);
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    currentDocumentId.set("doc-1");
    currentDraftId.set("draft-1");
    currentDocumentTitle.set("Draft title");
    isCollabJoiner.set(false);
    seedPersistenceBookkeeping(6);
    errorBanner.set({
        message: "A large deletion was detected.",
        hasBackup: false,
        backupType: "auto",
    });
    view = new EditorView({
        state: EditorState.create({
            doc: "Hello world",
            extensions: [annotationField, versionGroupField, listeners()],
        }),
        parent: document.body,
    });
});

afterEach(async () => {
    vi.unstubAllGlobals();
    await flushPersistence().catch(() => {});
    cleanup();
    view.destroy();
    currentDocumentId.set(null);
    currentDraftId.set(null);
    errorBanner.set(null);
    consoleErrorSpy.mockRestore();
});

it("keeps unsaved text and its warning when history is opened after an append failure", async () => {
    mockIPC((cmd) => {
        if (cmd === "cmd_append_event") throw new Error("disk full");
        return null;
    });
    view.dispatch({ changes: { from: 11, insert: " unsaved" } });
    await expect(flushPersistQueue()).rejects.toThrow("could not be saved");
    const ui = render(ErrorBanner);

    await fireEvent.click(ui.getByRole("button", { name: "View version history" }));

    await vi.waitFor(() =>
        expect(consoleErrorSpy).toHaveBeenCalledWith(
            "[ErrorBanner] navigation to history failed",
            expect.any(Error),
        ),
    );
    expect(goto).not.toHaveBeenCalled();
    expect(ui.getByRole("alert").textContent).toContain("could not be saved");
    expect(get(errorBanner)?.backupType).toBe("auto");
    expect(view.state.doc.toString()).toBe("Hello world unsaved");
});

it("keeps a checkpoint failure in the existing banner without promoting it to a crash", async () => {
    const failure = new Error("snapshot unavailable");
    mockIPC((cmd) => {
        if (cmd === "cmd_append_event") return { eventId: 7, needsSnapshot: false };
        if (cmd === "cmd_create_snapshot") throw failure;
        return null;
    });
    view.dispatch({ changes: { from: 11, insert: " preserved" } });
    await flushPersistQueue();
    const banner = get(errorBanner);
    const ui = render(ErrorBanner);

    await fireEvent.click(ui.getByRole("button", { name: "View version history" }));

    await vi.waitFor(() =>
        expect(consoleErrorSpy).toHaveBeenCalledWith(
            "[ErrorBanner] navigation to history failed",
            failure,
        ),
    );
    expect(goto).not.toHaveBeenCalled();
    expect(get(errorBanner)).toEqual(banner);
    expect(ui.queryByRole("button", { name: "Reload app" })).toBeNull();
    expect(view.state.doc.toString()).toBe("Hello world preserved");
});

it("waits for queued edits and navigation before clearing the warning", async () => {
    let releaseAppend!: (result: { eventId: number; needsSnapshot: boolean }) => void;
    let finishNavigation!: () => void;
    const snapshots: unknown[] = [];
    mockIPC((cmd, args) => {
        if (cmd === "cmd_append_event") {
            return new Promise((resolve) => {
                releaseAppend = resolve;
            });
        }
        if (cmd === "cmd_create_snapshot") snapshots.push(args);
        return null;
    });
    goto.mockImplementation(
        () =>
            new Promise<void>((resolve) => {
                finishNavigation = resolve;
            }),
    );
    view.dispatch({ changes: { from: 11, insert: " saved" } });
    await vi.waitFor(() => expect(releaseAppend).toBeDefined());
    const ui = render(ErrorBanner);

    await fireEvent.click(ui.getByRole("button", { name: "View version history" }));

    const navigatedBeforeAppend = goto.mock.calls.length > 0;
    const bannerBeforeAppend = ui.queryByRole("alert");
    releaseAppend({ eventId: 7, needsSnapshot: false });
    await vi.waitFor(() => expect(goto).toHaveBeenCalledWith("/history"));
    expect(navigatedBeforeAppend).toBe(false);
    expect(bannerBeforeAppend).not.toBeNull();
    expect(snapshots).toEqual([
        expect.objectContaining({
            draftId: "draft-1",
            stateJson: expect.stringContaining('"doc":"Hello world saved"'),
            upToEventId: 7,
        }),
    ]);
    expect(ui.queryByRole("alert")).not.toBeNull();
    finishNavigation();
    await vi.waitFor(() => expect(ui.queryByRole("alert")).toBeNull());
});

it("retains a newer crash banner when history navigation completes", async () => {
    mockIPC(() => null);
    let finishNavigation!: () => void;
    const navigation = new Promise<void>((resolve) => {
        finishNavigation = resolve;
    });
    goto.mockReturnValue(navigation);
    const ui = render(ErrorBanner);
    await fireEvent.click(ui.getByRole("button", { name: "View version history" }));
    await vi.waitFor(() => expect(goto).toHaveBeenCalledWith("/history"));

    errorBanner.set({ message: "Something went wrong.", hasBackup: true, backupType: "crash" });
    const crashBanner = get(errorBanner);
    finishNavigation();
    await navigation;
    await tick();

    expect(get(errorBanner)).toBe(crashBanner);
    expect(ui.getByRole("button", { name: "Restore previous" })).toBeDefined();
    expect(ui.getByRole("button", { name: "Save as .txt" })).toBeDefined();
    expect(ui.getByRole("button", { name: "Save as .json" })).toBeDefined();
});

it("still replaces the crashed page with history", async () => {
    mockIPC(() => null);
    errorBanner.set({ message: "Something went wrong.", hasBackup: true, backupType: "crash" });
    const ui = render(ErrorBanner);
    const replace = vi.fn();
    const browserWindow = window;
    vi.stubGlobal(
        "window",
        new Proxy(browserWindow, {
            get(target, key) {
                if (key === "location") return { replace };
                return Reflect.get(target, key, target);
            },
        }),
    );

    await fireEvent.click(ui.getByRole("button", { name: "Version history" }));

    expect(replace).toHaveBeenCalledWith("/history");
    expect(goto).not.toHaveBeenCalled();
    expect(ui.queryByRole("alert")).toBeNull();
});
