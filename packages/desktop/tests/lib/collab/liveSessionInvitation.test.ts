import { invitationRepository } from "$lib/collab/invitations/repository";
import { LiveSessionController } from "$lib/collab/liveSession.svelte";
import { isCollabJoiner, joinerPriorView } from "$lib/collab/store";
import { flushPersistQueue } from "$lib/editor/listeners";
import { currentDraftId, editorView } from "$lib/stores";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("$lib/collab", () => ({
    disableCollab: vi.fn(),
    enableCollab: vi.fn(),
    registerDocumentForCollab: vi.fn(),
    restoreJoinerPriorView: vi.fn(),
}));
vi.mock("$lib/collab/invitations/repository", async () => {
    const actual = await vi.importActual<typeof import("$lib/collab/invitations/repository")>(
        "$lib/collab/invitations/repository",
    );
    return { ...actual, invitationRepository: { resolve: vi.fn() } };
});
vi.mock("$lib/editor/listeners", () => ({
    flushPersistQueue: vi.fn(),
    persistNamedVersion: vi.fn(),
}));
vi.mock("$lib/editor/extensions", () => ({ savedFields: {} }));
vi.mock("$lib/auth/auth.svelte", () => ({
    getSession: () => ({ access_token: "fixture-session" }),
    getUser: () => ({ id: "fixture-user" }),
}));
vi.mock("$lib/posthog", () => ({ default: { capture: vi.fn() }, captureException: vi.fn() }));

const token = "a".repeat(43);
let view: EditorView;
beforeEach(() => {
    view = new EditorView({
        state: EditorState.create({ doc: "My local writing" }),
        parent: document.body,
    });
    editorView.set(view);
    currentDraftId.set("local-draft");
    isCollabJoiner.set(false);
    joinerPriorView.set(null);
    vi.mocked(invitationRepository.resolve).mockResolvedValue({
        documentId: "123e4567-e89b-12d3-a456-426614174000",
        grantId: "123e4567-e89b-12d3-a456-426614174001",
        role: "commenter",
        expiresAt: "2099-01-01T00:00:00Z",
    });
    vi.mocked(flushPersistQueue).mockResolvedValue(undefined);
});
afterEach(() => {
    view.destroy();
    vi.clearAllMocks();
});

describe("invitation join persistence boundary", () => {
    it("does not swap the local draft when its pending save failed", async () => {
        vi.mocked(flushPersistQueue).mockRejectedValue(new Error("Local SQLite write failed"));
        const controller = new LiveSessionController();
        expect(await controller.join(token)).toBe(false);
        expect(controller.lastJoinError?.code).toBe("save_failed");
        expect(get(currentDraftId)).toBe("local-draft");
        expect(get(isCollabJoiner)).toBe(false);
        expect(get(joinerPriorView)).toBeNull();
        expect(view.state.doc.toString()).toBe("My local writing");
    });
    it("keeps the local draft when the invitation fails before joining", async () => {
        vi.mocked(invitationRepository.resolve).mockRejectedValue(new Error("Disconnected"));
        const controller = new LiveSessionController();
        expect(await controller.join(token)).toBe(false);
        expect(flushPersistQueue).not.toHaveBeenCalled();
        expect(get(currentDraftId)).toBe("local-draft");
        expect(view.state.doc.toString()).toBe("My local writing");
    });
});
