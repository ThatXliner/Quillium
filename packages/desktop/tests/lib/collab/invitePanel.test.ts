import InvitePanel from "$lib/collab/invitations/InvitePanel.svelte";
import { invitationRepository } from "$lib/collab/invitations/repository";
import { fireEvent, render, waitFor } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("$lib/collab/invitations/repository", async () => {
    const original = await vi.importActual<typeof import("$lib/collab/invitations/repository")>(
        "$lib/collab/invitations/repository",
    );
    return {
        ...original,
        invitationRepository: {
            list: vi.fn(),
            create: vi.fn(),
            changeRole: vi.fn(),
            revoke: vi.fn(),
            replace: vi.fn(),
        },
    };
});
const grant = {
    id: "123e4567-e89b-12d3-a456-426614174001",
    document_id: "123e4567-e89b-12d3-a456-426614174000",
    created_by: "123e4567-e89b-12d3-a456-426614174002",
    invited_email: null,
    role: "editor" as const,
    delivery_status: "link" as const,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    expires_at: "2099-12-01T00:00:00Z",
    revoked_at: null,
};
afterEach(() => vi.clearAllMocks());

describe("Live Room grant management", () => {
    it("requires confirmation before revoking an active invitation", async () => {
        vi.mocked(invitationRepository.list).mockResolvedValue([grant]);
        vi.mocked(invitationRepository.revoke).mockResolvedValue({
            ...grant,
            revoked_at: "2026-10-25T00:00:00Z",
        });
        const ui = render(InvitePanel, {
            documentId: grant.document_id,
            isLive: true,
            ensureRegistered: vi.fn().mockResolvedValue(undefined),
        });
        await fireEvent.click(await ui.findByRole("button", { name: "Revoke" }));
        expect(invitationRepository.revoke).not.toHaveBeenCalled();
        await fireEvent.click(ui.getByRole("button", { name: "Confirm revoke" }));
        await waitFor(() =>
            expect(invitationRepository.revoke).toHaveBeenCalledWith(grant.document_id, grant.id),
        );
        expect(await ui.findByText(/Revoked/)).toBeTruthy();
    });
    it("explains a downgrade before applying the new role", async () => {
        vi.mocked(invitationRepository.list).mockResolvedValue([grant]);
        vi.mocked(invitationRepository.changeRole).mockResolvedValue({ ...grant, role: "viewer" });
        const ui = render(InvitePanel, {
            documentId: grant.document_id,
            isLive: true,
            ensureRegistered: vi.fn().mockResolvedValue(undefined),
        });
        const select = await ui.findByLabelText("Access for invitation link");
        await fireEvent.change(select, { target: { value: "viewer" } });
        expect(invitationRepository.changeRole).not.toHaveBeenCalled();
        expect(ui.getByText(/disconnects people using this invitation/)).toBeTruthy();
        await fireEvent.click(ui.getByRole("button", { name: "Change access" }));
        await waitFor(() =>
            expect(invitationRepository.changeRole).toHaveBeenCalledWith(
                grant.document_id,
                grant.id,
                "viewer",
            ),
        );
    });
});
