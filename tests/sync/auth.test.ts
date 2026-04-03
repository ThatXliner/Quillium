import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetSession = vi.fn();
const mockSignInWithPassword = vi.fn();
const mockSignUp = vi.fn();
const mockSignInAnonymously = vi.fn();
const mockSignOut = vi.fn();
const mockOnAuthStateChange = vi.fn(() => ({
    data: { subscription: { unsubscribe: vi.fn() } },
}));

vi.mock("$lib/sync/supabase", () => ({
    getSupabase: () => ({
        auth: {
            getSession: mockGetSession,
            signInWithPassword: mockSignInWithPassword,
            signUp: mockSignUp,
            signInAnonymously: mockSignInAnonymously,
            signOut: mockSignOut,
            onAuthStateChange: mockOnAuthStateChange,
        },
    }),
}));

describe("authState", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("starts with loading=true and no user", async () => {
        const { authState } = await import("$lib/sync/auth.svelte");
        expect(authState.loading).toBe(true);
        expect(authState.user).toBeNull();
    });
});

describe("login", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("calls signInWithPassword and returns null on success", async () => {
        const mockUser = { id: "u1", email: "a@b.com" };
        mockSignInWithPassword.mockResolvedValue({
            data: { user: mockUser, session: { access_token: "tok" } },
            error: null,
        });

        const { login } = await import("$lib/sync/auth.svelte");
        const result = await login("a@b.com", "password123");

        expect(mockSignInWithPassword).toHaveBeenCalledWith({
            email: "a@b.com",
            password: "password123",
        });
        expect(result).toBeNull();
    });

    it("returns error message on failure", async () => {
        mockSignInWithPassword.mockResolvedValue({
            data: { user: null, session: null },
            error: { message: "Invalid credentials" },
        });

        const { login } = await import("$lib/sync/auth.svelte");
        const result = await login("a@b.com", "wrong");
        expect(result).toBe("Invalid credentials");
    });
});

describe("signup", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("calls signUp and returns null on success", async () => {
        mockSignUp.mockResolvedValue({
            data: { user: { id: "u2" }, session: {} },
            error: null,
        });

        const { signup } = await import("$lib/sync/auth.svelte");
        const result = await signup("new@user.com", "pass1234");
        expect(result).toBeNull();
    });

    it("returns error message on failure", async () => {
        mockSignUp.mockResolvedValue({
            data: { user: null, session: null },
            error: { message: "Email taken" },
        });

        const { signup } = await import("$lib/sync/auth.svelte");
        const result = await signup("taken@user.com", "pass1234");
        expect(result).toBe("Email taken");
    });
});

describe("logout", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("calls signOut", async () => {
        mockSignOut.mockResolvedValue({ error: null });

        const { logout } = await import("$lib/sync/auth.svelte");
        await logout();
        expect(mockSignOut).toHaveBeenCalled();
    });
});

describe("loginAnonymously", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("calls signInAnonymously and returns null on success", async () => {
        mockSignInAnonymously.mockResolvedValue({
            data: { user: { id: "anon1" }, session: {} },
            error: null,
        });

        const { loginAnonymously } = await import("$lib/sync/auth.svelte");
        const result = await loginAnonymously();
        expect(mockSignInAnonymously).toHaveBeenCalled();
        expect(result).toBeNull();
    });

    it("returns error message on failure", async () => {
        mockSignInAnonymously.mockResolvedValue({
            data: { user: null, session: null },
            error: { message: "Anonymous auth disabled" },
        });

        const { loginAnonymously } = await import("$lib/sync/auth.svelte");
        const result = await loginAnonymously();
        expect(result).toBe("Anonymous auth disabled");
    });
});
