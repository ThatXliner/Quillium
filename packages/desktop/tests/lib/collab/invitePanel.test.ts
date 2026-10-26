import InvitePanel from "$lib/collab/invitations/InvitePanel.svelte";
import { invitationRepository } from "$lib/collab/invitations/repository";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/svelte";
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
afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

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
        await fireEvent.click(await ui.findByRole("button", { name: "Revoke Invitation link 1" }));
        expect(invitationRepository.revoke).not.toHaveBeenCalled();
        await fireEvent.click(ui.getByRole("button", { name: "Confirm revoke Invitation link 1" }));
        await waitFor(() =>
            expect(invitationRepository.revoke).toHaveBeenCalledWith(grant.document_id, grant.id),
        );
        expect(await ui.findByText(/Revoked · Expires/)).toBeTruthy();
        expect(ui.getByRole("status").textContent).toContain("Invitation revoked");
        await waitFor(() => expect(document.activeElement).toBe(ui.getByText("Invitation link 1")));
    });
    it("explains a downgrade before applying the new role", async () => {
        vi.mocked(invitationRepository.list).mockResolvedValue([grant]);
        vi.mocked(invitationRepository.changeRole).mockResolvedValue({ ...grant, role: "viewer" });
        const ui = render(InvitePanel, {
            documentId: grant.document_id,
            isLive: true,
            ensureRegistered: vi.fn().mockResolvedValue(undefined),
        });
        const select = await ui.findByLabelText("Access for Invitation link 1");
        await fireEvent.change(select, { target: { value: "viewer" } });
        expect(invitationRepository.changeRole).not.toHaveBeenCalled();
        expect(ui.getByText(/disconnects people using this invitation/)).toBeTruthy();
        ui.getByRole("button", { name: "Change access" }).focus();
        await fireEvent.click(ui.getByRole("button", { name: "Change access" }));
        await waitFor(() =>
            expect(invitationRepository.changeRole).toHaveBeenCalledWith(
                grant.document_id,
                grant.id,
                "viewer",
            ),
        );
        await waitFor(() => expect(document.activeElement).toBe(select));
        expect(ui.getByRole("status").textContent).toContain("Invitation access changed");
    });
    it("confirms upgrades because they also disconnect participants", async () => {
        vi.mocked(invitationRepository.list).mockResolvedValue([{ ...grant, role: "viewer" }]);
        vi.mocked(invitationRepository.changeRole).mockResolvedValue(grant);
        const ui = render(InvitePanel, {
            documentId: grant.document_id,
            isLive: true,
            ensureRegistered: vi.fn().mockResolvedValue(undefined),
        });
        await fireEvent.change(await ui.findByLabelText("Access for Invitation link 1"), {
            target: { value: "editor" },
        });
        expect(invitationRepository.changeRole).not.toHaveBeenCalled();
        expect(ui.getByText(/disconnects people using this invitation/)).toBeTruthy();
        await fireEvent.click(ui.getByRole("button", { name: "Change access" }));
        await waitFor(() =>
            expect(invitationRepository.changeRole).toHaveBeenCalledWith(
                grant.document_id,
                grant.id,
                "editor",
            ),
        );
    });
    it("confirms replacement and focuses its new link", async () => {
        const link = `quillium://join/${"c".repeat(43)}`;
        const replacement = { ...grant, id: "123e4567-e89b-12d3-a456-426614174009" };
        vi.mocked(invitationRepository.list).mockResolvedValue([replacement]);
        vi.mocked(invitationRepository.replace).mockResolvedValue({
            grant: replacement,
            joinUrl: link,
            token: "c".repeat(43),
        });
        const ui = render(InvitePanel, {
            documentId: grant.document_id,
            isLive: true,
            ensureRegistered: vi.fn().mockResolvedValue(undefined),
        });
        await fireEvent.click(
            await ui.findByRole("button", { name: "Replace link for Invitation link 1" }),
        );
        expect(invitationRepository.replace).not.toHaveBeenCalled();
        expect(ui.getByText(/disconnects people using it/)).toBeTruthy();
        await fireEvent.click(ui.getByRole("button", { name: "Confirm replace link" }));
        await waitFor(() => expect(document.activeElement).toBe(ui.getByDisplayValue(link)));
        expect(ui.getByRole("status").textContent).toContain("old link no longer works");
    });
    it("retains a new link across closing and reopening the panel without disk storage", async () => {
        const created = { ...grant, id: "123e4567-e89b-12d3-a456-426614174008" };
        const link = `quillium://join/${"d".repeat(43)}`;
        vi.mocked(invitationRepository.list).mockResolvedValue([]);
        vi.mocked(invitationRepository.create).mockResolvedValue({
            grant: created,
            joinUrl: link,
            token: "d".repeat(43),
        });
        const props = {
            documentId: grant.document_id,
            isLive: true,
            ensureRegistered: vi.fn().mockResolvedValue(undefined),
        };
        const ui = render(InvitePanel, props);
        const button = await ui.findByRole("button", { name: "Create link" });
        await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
        await fireEvent.click(button);
        await waitFor(() => expect(document.activeElement).toBe(ui.getByDisplayValue(link)));
        expect(ui.getByRole("group", { name: "Invitation method" })).toBeTruthy();
        ui.unmount();
        vi.mocked(invitationRepository.list).mockResolvedValue([created]);
        const reopened = render(InvitePanel, props);
        expect(await reopened.findByDisplayValue(link)).toBeTruthy();
        expect(reopened.getByRole("button", { name: "Create another link" })).toBeTruthy();
    });
});
