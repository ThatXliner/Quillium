import { listenForInvitations, parseInvitationToken } from "$lib/collab/invitations/deepLink";
import { InvitationError, invitationRepository } from "$lib/collab/invitations/repository";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("$env/static/public", () => ({ PUBLIC_RELAY_URL: "ws://127.0.0.1:12469" }));
vi.mock("$lib/auth/auth.svelte", () => ({ getSession: () => ({ access_token: "local-session" }) }));
const links = vi.hoisted(() => ({ receive: (_urls: string[]): void => {} }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/plugin-deep-link", () => ({
    getCurrent: async () => null,
    onOpenUrl: async (receive: (urls: string[]) => void) => {
        links.receive = receive;
        return () => {};
    },
}));
const token = "a".repeat(43);
afterEach(() => vi.unstubAllGlobals());

describe("invitation credential parsing", () => {
    it("accepts a complete app link and bare invitation token", () => {
        expect(parseInvitationToken(`quillium://join/${token}`)).toBe(token);
        expect(parseInvitationToken(` ${token} `)).toBe(token);
        expect(parseInvitationToken(`https://quillium.bryanhu.com/join#${token}`)).toBe(token);
    });
    it.each([
        "",
        "123e4567-e89b-12d3-a456-426614174000",
        `quillium://join/${token}?role=editor`,
        `quillium://join/${token}/`,
        `https://evil.example/join/${token}`,
        `quillium://evil/${token}`,
        "a".repeat(42),
    ])("rejects malformed invitation %s", (input) => {
        expect(parseInvitationToken(input)).toBeNull();
    });
});

describe("invitation HTTP boundary", () => {
    it("keeps the invitation token in the authenticated request body", async () => {
        const response = {
            documentId: "123e4567-e89b-12d3-a456-426614174000",
            grantId: "123e4567-e89b-12d3-a456-426614174001",
            role: "viewer",
            expiresAt: "2026-12-01T00:00:00Z",
        };
        const request = vi.fn().mockResolvedValue(new Response(JSON.stringify(response)));
        vi.stubGlobal("fetch", request);
        expect(await invitationRepository.resolve(token)).toEqual(response);
        const [url, options] = request.mock.calls[0];
        expect(String(url)).toBe("http://127.0.0.1:12469/access/invitations/resolve");
        expect(options.headers.Authorization).toBe("Bearer local-session");
        expect(JSON.parse(options.body)).toEqual({ token });
    });
    it.each([
        "expired_invitation",
        "revoked_invitation",
        "insufficient_permission",
        "owner_offline",
    ])("preserves actionable %s failures", async (code) => {
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue(
                new Response(JSON.stringify({ code, message: "Ask the owner for access." }), {
                    status: 403,
                }),
            ),
        );
        await expect(invitationRepository.resolve(token)).rejects.toMatchObject({
            name: "InvitationError",
            code,
            message: "Ask the owner for access.",
        });
    });
    it("rejects an unrecognized privilege in a relay response", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue(
                new Response(
                    JSON.stringify({
                        documentId: "123e4567-e89b-12d3-a456-426614174000",
                        grantId: "123e4567-e89b-12d3-a456-426614174001",
                        role: "owner",
                        expiresAt: "2026-12-01T00:00:00Z",
                    }),
                ),
            ),
        );
        await expect(invitationRepository.resolve(token)).rejects.toBeInstanceOf(InvitationError);
    });
});

describe("native invitation events", () => {
    it("allows the same invitation to open again after startup event deduplication", async () => {
        let now = 10000;
        const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
        try {
            const received = vi.fn();
            const stop = await listenForInvitations(received);
            links.receive([`quillium://join/${token}`]);
            links.receive([`quillium://join/${token}`]);
            expect(received).toHaveBeenCalledTimes(1);
            now += 1001;
            links.receive([`quillium://join/${token}`]);
            expect(received).toHaveBeenCalledTimes(2);
            stop();
        } finally {
            clock.mockRestore();
        }
    });
});
