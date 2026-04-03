# Supabase Auth + Account System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Supabase auth (email, OAuth, anonymous) to the Quillium Tauri app with an account section in Settings, storing the session token securely via the OS keychain.

**Architecture:** Supabase JS client initialized with env-injected project URL and anon key. Auth session persisted via a custom storage adapter backed by the existing Tauri keychain commands (`set_api_key`, `get_api_key`, `delete_api_key`). A reactive Svelte `$state` store exposes the current user/session to the rest of the app. An "Account" section is added to SettingsModal for login/logout/status.

**Tech Stack:** `@supabase/supabase-js`, Supabase Auth, Tauri keychain (existing), SvelteKit `$env/static/public` for env vars

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/lib/sync/supabase.ts` | Create | Supabase client singleton, custom keychain storage adapter |
| `src/lib/sync/auth.svelte.ts` | Create | Reactive auth state (`$state`), login/signup/logout functions, session restore on startup |
| `src/lib/settings/AccountSection.svelte` | Create | Account UI section for SettingsModal — login form, status display, logout |
| `src/lib/settings/SettingsModal.svelte` | Modify | Import and render `<AccountSection>` |
| `tests/sync/supabase.test.ts` | Create | Tests for keychain storage adapter |
| `tests/sync/auth.test.ts` | Create | Tests for auth state management |

---

### Task 1: Install `@supabase/supabase-js` and add env vars

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the dependency**

```bash
bun add @supabase/supabase-js
```

- [ ] **Step 2: Add public env vars for SvelteKit**

Create `src/lib/sync/env.ts` with placeholder references. SvelteKit exposes `$env/static/public` for `PUBLIC_` prefixed env vars, but since the Supabase project doesn't exist yet, we'll use a config module that can be swapped later:

```ts
// src/lib/sync/env.ts
// Supabase project config. Replace with real values when the project is created.
// These are public (anon) keys — safe to ship in the client bundle.
export const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = import.meta.env.PUBLIC_SUPABASE_ANON_KEY ?? "";
```

- [ ] **Step 3: Commit**

```bash
git add package.json bun.lockb src/lib/sync/env.ts
git commit -m "feat(sync): add @supabase/supabase-js and env config"
```

---

### Task 2: Create the keychain storage adapter

The Supabase client needs a `storage` adapter for persisting the auth session. We'll use the existing Tauri keychain (`set_api_key`/`get_api_key`/`delete_api_key`) so the session token is stored in the OS credential store, not localStorage.

**Files:**
- Create: `src/lib/sync/supabase.ts`
- Create: `tests/sync/supabase.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/sync/supabase.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";

// Mock the env module
vi.mock("$lib/sync/env", () => ({
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_ANON_KEY: "test-anon-key",
}));

// Mock @supabase/supabase-js so we can inspect what storage adapter is passed
const mockCreateClient = vi.hoisted(() => vi.fn(() => ({ auth: {} })));
vi.mock("@supabase/supabase-js", () => ({
    createClient: mockCreateClient,
}));

describe("keychainStorage", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("getItem calls get_api_key with prefixed key", async () => {
        let calledWith: Record<string, unknown> = {};
        mockIPC((cmd, args) => {
            if (cmd === "get_api_key") {
                calledWith = args as Record<string, unknown>;
                return "stored-value";
            }
        });

        const { keychainStorage } = await import("$lib/sync/supabase");
        const result = await keychainStorage.getItem("sb-auth-token");
        expect(calledWith.provider).toBe("supabase:sb-auth-token");
        expect(result).toBe("stored-value");
    });

    it("setItem calls set_api_key with prefixed key", async () => {
        let calledWith: Record<string, unknown> = {};
        mockIPC((cmd, args) => {
            if (cmd === "set_api_key") {
                calledWith = args as Record<string, unknown>;
            }
        });

        const { keychainStorage } = await import("$lib/sync/supabase");
        await keychainStorage.setItem("sb-auth-token", "new-value");
        expect(calledWith.provider).toBe("supabase:sb-auth-token");
        expect(calledWith.key).toBe("new-value");
    });

    it("removeItem calls delete_api_key with prefixed key", async () => {
        let calledWith: Record<string, unknown> = {};
        mockIPC((cmd, args) => {
            if (cmd === "delete_api_key") {
                calledWith = args as Record<string, unknown>;
            }
        });

        const { keychainStorage } = await import("$lib/sync/supabase");
        await keychainStorage.removeItem("sb-auth-token");
        expect(calledWith.provider).toBe("supabase:sb-auth-token");
    });

    it("getItem returns null when no entry exists", async () => {
        mockIPC((cmd) => {
            if (cmd === "get_api_key") return null;
        });

        const { keychainStorage } = await import("$lib/sync/supabase");
        const result = await keychainStorage.getItem("nonexistent");
        expect(result).toBeNull();
    });
});

describe("getSupabase", () => {
    it("creates client with keychain storage and correct URL", async () => {
        const { getSupabase } = await import("$lib/sync/supabase");
        getSupabase();
        expect(mockCreateClient).toHaveBeenCalledWith(
            "https://test.supabase.co",
            "test-anon-key",
            expect.objectContaining({
                auth: expect.objectContaining({
                    storage: expect.any(Object),
                    autoRefreshToken: true,
                    persistSession: true,
                }),
            }),
        );
    });

    it("returns the same instance on subsequent calls", async () => {
        const { getSupabase } = await import("$lib/sync/supabase");
        const a = getSupabase();
        const b = getSupabase();
        expect(a).toBe(b);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun run test:run tests/sync/supabase.test.ts
```

Expected: FAIL — module `$lib/sync/supabase` does not exist.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/sync/supabase.ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { invoke } from "@tauri-apps/api/core";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./env";

const KEYCHAIN_PREFIX = "supabase:";

/**
 * Custom storage adapter that persists Supabase auth sessions
 * in the OS keychain via Tauri's keyring commands.
 */
export const keychainStorage = {
    async getItem(key: string): Promise<string | null> {
        return invoke<string | null>("get_api_key", {
            provider: KEYCHAIN_PREFIX + key,
        });
    },
    async setItem(key: string, value: string): Promise<void> {
        await invoke<void>("set_api_key", {
            provider: KEYCHAIN_PREFIX + key,
            key: value,
        });
    },
    async removeItem(key: string): Promise<void> {
        await invoke<void>("delete_api_key", {
            provider: KEYCHAIN_PREFIX + key,
        });
    },
};

let client: SupabaseClient | null = null;

/**
 * Returns the singleton Supabase client.
 * Uses the OS keychain for session persistence.
 */
export function getSupabase(): SupabaseClient {
    if (client) return client;
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
            storage: keychainStorage,
            autoRefreshToken: true,
            persistSession: true,
            detectSessionInUrl: false,
        },
    });
    return client;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun run test:run tests/sync/supabase.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sync/supabase.ts tests/sync/supabase.test.ts
git commit -m "feat(sync): supabase client with keychain storage adapter"
```

---

### Task 3: Create the reactive auth store

**Files:**
- Create: `src/lib/sync/auth.svelte.ts`
- Create: `tests/sync/auth.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/sync/auth.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the supabase module
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

    it("calls signInWithPassword and updates state on success", async () => {
        const mockUser = { id: "u1", email: "a@b.com" };
        mockSignInWithPassword.mockResolvedValue({
            data: { user: mockUser, session: { access_token: "tok" } },
            error: null,
        });

        const { login, authState } = await import("$lib/sync/auth.svelte");
        await login("a@b.com", "password123");

        expect(mockSignInWithPassword).toHaveBeenCalledWith({
            email: "a@b.com",
            password: "password123",
        });
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

    it("calls signInAnonymously", async () => {
        mockSignInAnonymously.mockResolvedValue({
            data: { user: { id: "anon1" }, session: {} },
            error: null,
        });

        const { loginAnonymously } = await import("$lib/sync/auth.svelte");
        await loginAnonymously();
        expect(mockSignInAnonymously).toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun run test:run tests/sync/auth.test.ts
```

Expected: FAIL — module `$lib/sync/auth.svelte` does not exist.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/sync/auth.svelte.ts
/**
 * auth.svelte.ts — Reactive auth state for Quillium Sync.
 *
 * Wraps Supabase Auth in a Svelte $state store.
 * Exposes: authState (reactive), login, signup, logout, loginAnonymously, restoreSession.
 */
import { getSupabase } from "./supabase";
import type { User, Session } from "@supabase/supabase-js";

type AuthState = {
    user: User | null;
    session: Session | null;
    loading: boolean;
};

export const authState: AuthState = $state({
    user: null,
    session: null,
    loading: true,
});

/**
 * Restore a previously persisted session from the keychain.
 * Call once on app startup.
 */
export async function restoreSession(): Promise<void> {
    const supabase = getSupabase();
    const { data, error } = await supabase.auth.getSession();
    if (data.session) {
        authState.user = data.session.user;
        authState.session = data.session;
    }
    authState.loading = false;

    // Listen for future auth state changes (token refresh, logout from another tab, etc.)
    supabase.auth.onAuthStateChange((_event, session) => {
        authState.user = session?.user ?? null;
        authState.session = session;
    });
}

/**
 * Sign in with email + password.
 * Returns null on success, error message string on failure.
 */
export async function login(email: string, password: string): Promise<string | null> {
    const supabase = getSupabase();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return error.message;
    authState.user = data.user;
    authState.session = data.session;
    return null;
}

/**
 * Create a new account with email + password.
 * Returns null on success, error message string on failure.
 */
export async function signup(email: string, password: string): Promise<string | null> {
    const supabase = getSupabase();
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return error.message;
    authState.user = data.user;
    authState.session = data.session;
    return null;
}

/**
 * Sign out the current user.
 */
export async function logout(): Promise<void> {
    const supabase = getSupabase();
    await supabase.auth.signOut();
    authState.user = null;
    authState.session = null;
}

/**
 * Sign in anonymously (for collaborators joining via share link).
 * Returns null on success, error message string on failure.
 */
export async function loginAnonymously(): Promise<string | null> {
    const supabase = getSupabase();
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error) return error.message;
    authState.user = data.user;
    authState.session = data.session;
    return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun run test:run tests/sync/auth.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sync/auth.svelte.ts tests/sync/auth.test.ts
git commit -m "feat(sync): reactive auth state with login/signup/logout"
```

---

### Task 4: Call `restoreSession` on app startup

**Files:**
- Modify: `src/routes/+layout.svelte`

- [ ] **Step 1: Read the current layout file**

Read `src/routes/+layout.svelte` to understand the current structure.

- [ ] **Step 2: Add session restore on mount**

Add an `onMount` call that restores the auth session. This is fire-and-forget — the app works fully without auth, so if restore fails the app continues normally.

In the `<script>` block of `+layout.svelte`, add:

```ts
import { onMount } from "svelte";
import { restoreSession } from "$lib/sync/auth.svelte";

onMount(() => {
    restoreSession();
});
```

If `+layout.svelte` already has an `onMount`, add the `restoreSession()` call inside the existing one.

- [ ] **Step 3: Verify the app still starts**

```bash
bun run check
```

Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/routes/+layout.svelte
git commit -m "feat(sync): restore auth session on app startup"
```

---

### Task 5: Build the Account section in Settings

**Files:**
- Create: `src/lib/settings/AccountSection.svelte`
- Modify: `src/lib/settings/SettingsModal.svelte`

- [ ] **Step 1: Create the AccountSection component**

This component handles two states: logged out (shows login/signup form) and logged in (shows user info + logout button).

```svelte
<!--
    AccountSection.svelte — Account management for SettingsModal.

    Shows login/signup form when logged out, user info + logout when logged in.
    Does NOT participate in the settings draft/save flow — auth actions
    take effect immediately.
-->
<script lang="ts">
import { LogIn, LogOut, User, Loader2 } from "lucide-svelte";
import { authState, login, signup, logout } from "$lib/sync/auth.svelte";

let mode = $state<"login" | "signup">("login");
let email = $state("");
let password = $state("");
let error = $state<string | null>(null);
let submitting = $state(false);

async function handleSubmit() {
    error = null;
    submitting = true;
    const result = mode === "login"
        ? await login(email, password)
        : await signup(email, password);
    submitting = false;
    if (result) {
        error = result;
    } else {
        email = "";
        password = "";
    }
}

async function handleLogout() {
    await logout();
}
</script>

{#if authState.loading}
    <div class="setting-row">
        <Loader2 size={14} class="animate-spin text-black/30" />
        <span class="text-[12px] text-black/40">Loading account...</span>
    </div>
{:else if authState.user}
    <div class="setting-row">
        <div class="flex items-center gap-2 flex-1 min-w-0">
            <User size={14} class="text-black/40 shrink-0" />
            <span class="text-[12px] text-black/70 truncate">
                {authState.user.email ?? "Anonymous user"}
            </span>
        </div>
        <button
            onclick={handleLogout}
            class="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-black/50 hover:text-black/70 hover:bg-black/5 transition-colors"
        >
            <LogOut size={12} />
            Sign out
        </button>
    </div>
{:else}
    <form
        onsubmit={(e) => { e.preventDefault(); handleSubmit(); }}
        class="flex flex-col gap-2 px-1"
    >
        <div class="flex items-center gap-2">
            <input
                type="email"
                bind:value={email}
                placeholder="Email"
                required
                class="flex-1 px-2 py-1.5 rounded border border-black/10 text-[12px] bg-white/50 focus:outline-none focus:border-black/20"
            />
        </div>
        <div class="flex items-center gap-2">
            <input
                type="password"
                bind:value={password}
                placeholder="Password"
                required
                minlength={8}
                class="flex-1 px-2 py-1.5 rounded border border-black/10 text-[12px] bg-white/50 focus:outline-none focus:border-black/20"
            />
        </div>
        {#if error}
            <p class="text-[11px] text-red-500 px-0.5">{error}</p>
        {/if}
        <div class="flex items-center gap-2">
            <button
                type="submit"
                disabled={submitting}
                class="flex items-center gap-1 px-3 py-1.5 rounded text-[12px] font-medium bg-black/5 hover:bg-black/10 transition-colors disabled:opacity-50"
            >
                {#if submitting}
                    <Loader2 size={12} class="animate-spin" />
                {:else}
                    <LogIn size={12} />
                {/if}
                {mode === "login" ? "Sign in" : "Create account"}
            </button>
            <button
                type="button"
                onclick={() => { mode = mode === "login" ? "signup" : "login"; error = null; }}
                class="text-[11px] text-black/40 hover:text-black/60 transition-colors"
            >
                {mode === "login" ? "Create account" : "Sign in instead"}
            </button>
        </div>
    </form>
{/if}
```

- [ ] **Step 2: Add AccountSection to SettingsModal**

In `src/lib/settings/SettingsModal.svelte`:

1. Add the import at the top of the `<script>` block:

```ts
import AccountSection from "./AccountSection.svelte";
```

2. Add the Account section at the very top of the settings sections (before the "Document" section). Find the line `<!-- DOCUMENT section -->` and insert before it:

```svelte
            <!-- ACCOUNT section -->
            <div class="section-label">Account</div>
            <AccountSection />

            <div class="section-divider"></div>

```

- [ ] **Step 3: Verify no type errors**

```bash
bun run check
```

Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/settings/AccountSection.svelte src/lib/settings/SettingsModal.svelte
git commit -m "feat(sync): add Account section to Settings with login/signup UI"
```

---

### Task 6: Add `.env` to `.gitignore` and create `.env.example`

**Files:**
- Modify: `.gitignore`
- Create: `.env.example`

- [ ] **Step 1: Add .env to gitignore**

Check if `.env` is already in `.gitignore`. If not, append:

```
# Supabase
.env
.env.local
```

- [ ] **Step 2: Create .env.example**

```
# Supabase project config (get from https://app.supabase.com)
PUBLIC_SUPABASE_URL=
PUBLIC_SUPABASE_ANON_KEY=
```

- [ ] **Step 3: Commit**

```bash
git add .gitignore .env.example
git commit -m "chore: add .env to gitignore and create .env.example"
```

---

### Task 7: Type-check and full test run

- [ ] **Step 1: Run type checking**

```bash
bun run check
```

Expected: no errors.

- [ ] **Step 2: Run full test suite**

```bash
bun run test:run
```

Expected: all existing tests still pass, new sync tests pass.

- [ ] **Step 3: Fix any issues found**

If tests fail, fix them before proceeding.

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix(sync): address test/type issues from auth integration"
```
