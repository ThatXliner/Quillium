import JoinRoomDialog from "$lib/collab/invitations/JoinRoomDialog.svelte";
import { invitationRepository } from "$lib/collab/invitations/repository";
import { LiveSessionController } from "$lib/collab/liveSession.svelte";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(
    (): { user: { id: string } | null; room: { docId: string; isOwner: boolean } | null } => ({
        user: { id: "owner" },
        room: null,
    }),
);
vi.mock("$lib/auth/auth.svelte", () => ({
    getUser: () => fixture.user,
    signInAnonymously: vi.fn(),
}));
vi.mock("$lib/collab/store", () => ({
    collabSession: {
        subscribe(run: (value: typeof fixture.room) => void) {
            run(fixture.room);
            return () => {};
        },
    },
}));
vi.mock("$lib/collab/liveSession.svelte", () => ({
    LiveSessionController: class {
        isLive = false;
        connecting = false;
        lastJoinError = null;
        join = vi.fn().mockResolvedValue(true);
    },
}));
vi.mock("$lib/collab/invitations/repository", async () => {
    const actual = await vi.importActual<typeof import("$lib/collab/invitations/repository")>(
        "$lib/collab/invitations/repository",
    );
    return { ...actual, invitationRepository: { resolve: vi.fn() } };
});
const invitation = "a".repeat(43);
const resolved = {
    documentId: "123e4567-e89b-12d3-a456-426614174000",
    grantId: "123e4567-e89b-12d3-a456-426614174001",
    role: "viewer" as const,
    expiresAt: "2099-12-01T00:00:00Z",
};
beforeEach(() => {
    fixture.user = { id: "owner" };
    fixture.room = null;
    vi.mocked(invitationRepository.resolve).mockResolvedValue(resolved);
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
        configurable: true,
        value: function (this: HTMLDialogElement) {
            this.open = true;
        },
    });
});
afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.clearAllMocks();
});

describe("explicit invitation joins", () => {
    it("waits for a signed-in user to choose Join", async () => {
        const session = new LiveSessionController();
        const ui = render(JoinRoomDialog, {
            invitation,
            session,
            onclose: vi.fn(),
            onopenauth: vi.fn(),
        });
        const button = await ui.findByRole("button", { name: /^Join$/ });
        expect(session.join).not.toHaveBeenCalled();
        await fireEvent.click(button);
        expect(session.join).toHaveBeenCalledWith(invitation);
    });
    it("preserves the owner's hosted room when opening its invitation", async () => {
        const session = new LiveSessionController();
        session.isLive = true;
        fixture.room = { docId: resolved.documentId, isOwner: true };
        const ui = render(JoinRoomDialog, {
            invitation,
            session,
            onclose: vi.fn(),
            onopenauth: vi.fn(),
        });
        expect(await ui.findByRole("heading", { name: "This is your Live Room" })).toBeTruthy();
        await fireEvent.click(ui.getByRole("button", { name: "Keep room open" }));
        expect(session.join).not.toHaveBeenCalled();
        expect(session.isLive).toBe(true);
    });
    it("warns before replacing a different hosted room", async () => {
        const session = new LiveSessionController();
        session.isLive = true;
        fixture.room = { docId: "another-room", isOwner: true };
        const ui = render(JoinRoomDialog, {
            invitation,
            session,
            onclose: vi.fn(),
            onopenauth: vi.fn(),
        });
        expect(await ui.findByText(/everyone in it will leave/)).toBeTruthy();
        expect(session.join).not.toHaveBeenCalled();
        await fireEvent.click(ui.getByRole("button", { name: "End room and join" }));
        expect(session.join).toHaveBeenCalledWith(invitation);
    });
    it("unmounts the sign-in handoff so a later invitation can open", async () => {
        fixture.user = null;
        const close = vi.fn();
        const auth = vi.fn();
        const ui = render(JoinRoomDialog, {
            invitation,
            session: new LiveSessionController(),
            onclose: close,
            onopenauth: auth,
        });
        await fireEvent.click(await ui.findByRole("button", { name: "Sign in instead" }));
        expect(close).toHaveBeenCalledOnce();
        expect(auth).toHaveBeenCalledOnce();
        ui.unmount();
        const later = render(JoinRoomDialog, {
            invitation: "b".repeat(43),
            session: new LiveSessionController(),
            onclose: vi.fn(),
            onopenauth: vi.fn(),
        });
        await waitFor(() => expect(later.getByLabelText("Display name")).toBeTruthy());
        expect(later.getByRole("dialog").hasAttribute("open")).toBe(true);
    });
});
