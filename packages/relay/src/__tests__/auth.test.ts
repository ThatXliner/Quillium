/**
 * auth.test.ts -- Tests for native WebSocket JWT authentication.
 *
 * The relay uses the Supabase service_role key, so these tests verify the
 * relay's own authorization checks instead of relying on Postgres RLS.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../auth/supabase.js", () => ({
    supabaseConfigured: true,
    supabase: {
        auth: {
            getUser: vi.fn(),
        },
        from: vi.fn(),
    },
}));

vi.mock("../yjs/rooms.js", () => ({
    getYjsRoom: vi.fn(),
}));

import { authenticateWebSocket } from "../auth/middleware.js";
import { supabase } from "../auth/supabase.js";
import { getYjsRoom } from "../yjs/rooms.js";
import type { YjsRoom } from "../yjs/types.js";

type MockFunction = ReturnType<typeof vi.fn>;

interface MockSupabase {
    auth: {
        getUser: MockFunction;
    };
    from: MockFunction;
}

function mockedSupabase(): MockSupabase {
    if (!supabase) throw new Error("Expected mocked Supabase client");
    return supabase as unknown as MockSupabase;
}

function mockDocumentLookup(data: { owner_id: string } | null, error: unknown = null) {
    const maybeSingle = vi.fn().mockResolvedValue({ data, error });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });

    mockedSupabase().from.mockReturnValue({ select });

    return { select, eq, maybeSingle };
}

describe("authenticateWebSocket", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getYjsRoom).mockReturnValue(undefined);
    });

    it("rejects connection without token", async () => {
        const result = await authenticateWebSocket(null, "123e4567-e89b-12d3-a456-426614174000");

        expect(result).toEqual({ success: false, error: "Missing auth token" });
        expect(mockedSupabase().auth.getUser).not.toHaveBeenCalled();
    });

    it("rejects connection without document ID", async () => {
        const result = await authenticateWebSocket("valid-token", "");

        expect(result).toEqual({ success: false, error: "Missing document ID" });
        expect(mockedSupabase().auth.getUser).not.toHaveBeenCalled();
    });

    it.each(["not-a-uuid", "../document", "123e4567-e89b-12d3-a456-426614174000/extra"])(
        "rejects malformed document ID %s before Supabase",
        async (documentId) => {
            expect(await authenticateWebSocket("token", documentId)).toEqual({
                success: false,
                error: "Invalid handshake",
            });
            expect(mockedSupabase().auth.getUser).not.toHaveBeenCalled();
            expect(mockedSupabase().from).not.toHaveBeenCalled();
        },
    );

    it("rejects invalid Supabase JWTs", async () => {
        mockedSupabase().auth.getUser.mockResolvedValue({
            data: { user: null },
            error: { message: "Invalid token", status: 401 },
        });

        const result = await authenticateWebSocket(
            "invalid-token",
            "123e4567-e89b-12d3-a456-426614174000",
        );

        expect(result).toEqual({ success: false, error: "Invalid token" });
    });

    it("rejects when the document does not exist", async () => {
        mockedSupabase().auth.getUser.mockResolvedValue({
            data: { user: { id: "user-123", is_anonymous: false } },
            error: null,
        });
        mockDocumentLookup(null);

        const result = await authenticateWebSocket(
            "valid-token",
            "123e4567-e89b-12d3-a456-426614174000",
        );

        expect(result).toEqual({ success: false, error: "Permission denied" });
    });

    it("rejects authenticated non-owners when the owner is not live", async () => {
        mockedSupabase().auth.getUser.mockResolvedValue({
            data: { user: { id: "user-456", is_anonymous: false } },
            error: null,
        });
        mockDocumentLookup({ owner_id: "user-123" });

        const result = await authenticateWebSocket(
            "valid-token",
            "123e4567-e89b-12d3-a456-426614174000",
        );

        expect(result).toEqual({ success: false, error: "Permission denied" });
    });

    it("accepts authenticated non-owners while the owner is live", async () => {
        mockedSupabase().auth.getUser.mockResolvedValue({
            data: { user: { id: "user-456", is_anonymous: false } },
            error: null,
        });
        mockDocumentLookup({ owner_id: "user-123" });
        vi.mocked(getYjsRoom).mockReturnValue({
            isOwnerConnected: true,
            ownerId: "user-123",
        } as YjsRoom);

        const result = await authenticateWebSocket(
            "valid-token",
            "123e4567-e89b-12d3-a456-426614174000",
        );

        expect(result).toEqual({
            success: true,
            data: {
                userId: "user-456",
                documentId: "123e4567-e89b-12d3-a456-426614174000",
                isOwner: false,
                isAnonymous: false,
            },
        });
    });

    it("accepts document owners", async () => {
        mockedSupabase().auth.getUser.mockResolvedValue({
            data: { user: { id: "owner-user", is_anonymous: false } },
            error: null,
        });
        mockDocumentLookup({ owner_id: "owner-user" });

        const result = await authenticateWebSocket(
            "valid-token",
            "123e4567-e89b-12d3-a456-426614174000",
        );

        expect(result).toEqual({
            success: true,
            data: {
                userId: "owner-user",
                documentId: "123e4567-e89b-12d3-a456-426614174000",
                isOwner: true,
                isAnonymous: false,
            },
        });
    });

    it("preserves anonymous owner identity", async () => {
        mockedSupabase().auth.getUser.mockResolvedValue({
            data: { user: { id: "anon-owner", is_anonymous: true } },
            error: null,
        });
        mockDocumentLookup({ owner_id: "anon-owner" });

        const result = await authenticateWebSocket(
            "valid-token",
            "123e4567-e89b-12d3-a456-426614174000",
        );

        expect(result.success).toBe(true);
        expect(result.data?.isAnonymous).toBe(true);
    });
});
