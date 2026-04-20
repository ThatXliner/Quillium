# Phase 2: Auth Foundation - Research

**Researched:** 2026-04-17
**Domain:** Supabase Auth integration with SvelteKit/Tauri desktop app
**Confidence:** HIGH

## Summary

This phase implements user authentication for Quillium Omni using Supabase Auth. The key architectural consideration is that Quillium runs as a Tauri desktop app with client-side rendering only -- no SSR, no server-side hooks. This means using `@supabase/supabase-js` directly with `localStorage` persistence (not the `@supabase/ssr` package which targets cookie-based SSR).

The implementation creates a Supabase client singleton, wires up `signUp`, `signInWithPassword`, and `signOut` methods, persists sessions via localStorage (Supabase JS default), and displays auth state in the top-right corner of the app. The `users` table trigger from Phase 1 automatically populates the user profile on sign-up -- the client only needs to pass `display_name` in the `options.data` metadata during registration.

**Primary recommendation:** Use `@supabase/supabase-js` (not `@supabase/ssr`) with explicit localStorage storage. Create a Svelte store to track auth state via `onAuthStateChange`. Build an AuthModal component following the existing SettingsModal pattern with tabs for Login/Sign Up.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-10:** Auth UI in top-right area of the app (avatar/button), opens modal for login/signup
- **D-11:** Document sharing configuration also accessible from that top-right area (future phases will implement)
- **D-12:** Logged-in indicator visible in top-right (avatar)
- **D-13:** Instant activation -- no email verification required for prototype
- **D-14:** Session storage via localStorage (Supabase JS client default, `persistSession: true`)
- **D-15:** Logged out: faint "Sign In" button (gray/glassy styling, matches existing UI elements like status bar)
- **D-15b:** Logged in: Avatar (generated from display name per D-02) + dropdown menu
- **D-16:** Display name collected during sign-up (form field alongside email/password)
- **D-17:** Simple auth modal -- email/password fields only, tabs to switch between login/signup, minimal UI

### Claude's Discretion
- Exact modal styling (follow existing SettingsModal patterns)
- Dropdown menu contents and interactions
- Error message display and handling
- Password reset flow details (if included in v1)
- Form validation UX (inline vs. on-submit)

### Deferred Ideas (OUT OF SCOPE)
- Document sharing UI -- noted in D-11 as accessible from top-right, but implementation is future phases
- Password reset flow -- may be minimal or deferred based on Claude's discretion
- OAuth providers (Google, GitHub) -- v2 feature (AUTH-10, AUTH-11)
- Email verification -- explicitly skipped for prototype (D-13)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AUTH-01 | User can sign up with email and password via Supabase | `supabase.auth.signUp()` with email, password, and `options.data.display_name` |
| AUTH-02 | User can log in with existing account | `supabase.auth.signInWithPassword()` with email and password |
| AUTH-03 | User session persists across app restarts | `persistSession: true` + localStorage storage (Supabase JS default) |
| AUTH-04 | User can log out | `supabase.auth.signOut()` clears session from localStorage |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Auth UI (modal, button, avatar) | Browser / Client | -- | Svelte components, client-side only |
| Supabase client initialization | Browser / Client | -- | No SSR in Tauri, client singleton |
| Session persistence | Browser / Client | -- | localStorage, no cookies needed |
| User profile creation | Database / Storage | -- | Trigger auto-creates on auth.users insert (Phase 1) |
| Auth state management | Browser / Client | -- | Svelte store synced via onAuthStateChange |
| Form validation | Browser / Client | -- | Zod schemas, client-side validation |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @supabase/supabase-js | 2.103.3 | Auth client SDK | [VERIFIED: npm registry] Official Supabase client, includes auth |
| zod | 4.3.6 | Form validation | [VERIFIED: package.json] Already used in project for schema validation |
| lucide-svelte | 0.475.0 | Icons (User, LogOut, etc.) | [VERIFIED: package.json] Already used in project |

### Not Using
| Package | Version | Why Not |
|---------|---------|---------|
| @supabase/ssr | 0.10.2 | Designed for cookie-based SSR; Tauri is client-only |
| @supabase/auth-helpers-sveltekit | 0.15.0 | Deprecated in favor of @supabase/ssr, also SSR-focused |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| localStorage | Tauri keychain | Keychain adds complexity, localStorage works fine for sessions per D-14 |
| Supabase Auth | Custom JWT | Reinventing auth poorly, Supabase handles tokens/refresh |

**Installation:**
```bash
bun add @supabase/supabase-js
```

**Version verification:**
- `@supabase/supabase-js`: 2.103.3 (verified 2026-04-17 via `npm view`)

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Quillium App (Tauri)                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────┐        ┌───────────────────────────────────┐  │
│  │  +page.svelte   │        │         Top-Right Area            │  │
│  │  (main layout)  │───────►│  ┌─────────────────────────────┐  │  │
│  └─────────────────┘        │  │ Logged out: "Sign In" btn   │  │  │
│                             │  │ Logged in: Avatar+Dropdown  │  │  │
│                             │  └─────────────┬───────────────┘  │  │
│                             └────────────────┼──────────────────┘  │
│                                              │                      │
│                                              ▼                      │
│                             ┌───────────────────────────────────┐  │
│                             │          AuthModal.svelte         │  │
│                             │  ┌─────────┐  ┌──────────────┐    │  │
│                             │  │ Login   │  │ Sign Up      │    │  │
│                             │  │ Tab     │  │ Tab          │    │  │
│                             │  └─────────┘  └──────────────┘    │  │
│                             └───────────────┬───────────────────┘  │
│                                             │                       │
│                                             ▼                       │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                    auth.svelte.ts (store)                     │  │
│  │  - supabase: Client singleton                                 │  │
│  │  - user: $state<User | null>                                  │  │
│  │  - loading: $state<boolean>                                   │  │
│  │  - signUp(), signIn(), signOut()                              │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                │                                    │
│                                │ onAuthStateChange                  │
│                                ▼                                    │
└────────────────────────────────┼────────────────────────────────────┘
                                 │ HTTPS
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        Supabase Cloud                                │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────────┐  │
│  │  auth.users  │◄──►│  GoTrue API  │◄──►│  Supabase JS Client  │  │
│  │  (managed)   │    │  (auth)      │    │  (in Quillium)       │  │
│  └──────────────┘    └──────────────┘    └──────────────────────┘  │
│         │                                                           │
│         │ trigger                                                   │
│         ▼                                                           │
│  ┌──────────────┐                                                   │
│  │ public.users │  (display_name populated from raw_user_meta_data) │
│  │  (profiles)  │                                                   │
│  └──────────────┘                                                   │
└─────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
src/lib/
├── auth/
│   ├── auth.svelte.ts      # Supabase client + auth state store
│   ├── AuthModal.svelte    # Login/signup modal (tabs, forms)
│   ├── AuthButton.svelte   # Top-right button (sign in / avatar)
│   ├── AvatarDropdown.svelte  # Logged-in dropdown menu
│   └── index.ts            # Re-exports
└── supabase.ts             # Supabase client singleton (optional, could be in auth/)
```

### Pattern 1: Supabase Client for Desktop App

**What:** Initialize Supabase JS client with localStorage storage for Tauri/desktop apps.

**When to use:** Any Tauri or Electron app without SSR.

**Example:**
```typescript
// Source: https://supabase.com/docs/guides/auth/quickstarts/react-native (adapted)
// Source: https://github.com/supabase/supabase-js/issues/684

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        storage: localStorage,          // Explicit (default behavior anyway)
        autoRefreshToken: true,          // Keep session alive
        persistSession: true,            // Store in localStorage
        detectSessionInUrl: false,       // No OAuth redirects for v1
    },
});
```

### Pattern 2: Auth State Store with Svelte 5 Runes

**What:** Reactive auth state using Svelte 5 `$state` and `onAuthStateChange`.

**When to use:** Tracking authenticated user across the app.

**Example:**
```typescript
// auth.svelte.ts
// Source: https://supabase.com/docs/reference/javascript/auth-onauthstatechange

import { supabase } from "./supabase";
import type { User, Session } from "@supabase/supabase-js";

// Reactive state
let user = $state<User | null>(null);
let session = $state<Session | null>(null);
let loading = $state(true);

// Initialize: check existing session and subscribe to changes
export async function initAuth() {
    const { data: { session: existingSession } } = await supabase.auth.getSession();
    session = existingSession;
    user = existingSession?.user ?? null;
    loading = false;

    supabase.auth.onAuthStateChange((_event, newSession) => {
        session = newSession;
        user = newSession?.user ?? null;
    });
}

// Export reactive getters
export function getUser() { return user; }
export function getSession() { return session; }
export function isLoading() { return loading; }
export function isAuthenticated() { return !!user; }
```

### Pattern 3: Sign Up with Display Name Metadata

**What:** Pass display_name in signUp options so the database trigger can extract it.

**When to use:** User registration with profile data.

**Example:**
```typescript
// Source: https://supabase.com/docs/guides/auth/managing-user-data

export async function signUp(email: string, password: string, displayName: string) {
    const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
            data: {
                display_name: displayName,  // Stored in raw_user_meta_data
            },
        },
    });
    if (error) throw error;
    return data;
}
```

### Pattern 4: Avatar from Display Name (Initials)

**What:** Generate avatar initials from display name, matching existing ThreadMessage pattern.

**When to use:** Displaying logged-in user avatar.

**Example:**
```typescript
// Source: Existing pattern in src/lib/editor/plugins/annotations/ThreadMessage.svelte

export function initials(displayName: string): string {
    return displayName
        .split(" ")
        .map((w) => w[0])
        .join("")
        .toUpperCase()
        .slice(0, 2);
}

// Generate a consistent color from display name
export function avatarColor(displayName: string): string {
    // Simple hash to pick from a palette
    const colors = ["#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899"];
    let hash = 0;
    for (let i = 0; i < displayName.length; i++) {
        hash = displayName.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
}
```

### Pattern 5: Modal Dialog (Following SettingsModal)

**What:** Use `<dialog>` element with backdrop, following existing SettingsModal patterns.

**When to use:** Auth modal UI.

**Example:**
```svelte
<!-- Source: Adapted from src/lib/settings/SettingsModal.svelte -->

<dialog bind:this={dialogEl} class="auth-modal" onclick={handleBackdropClick}>
    <div class="auth-modal-inner">
        <!-- Tab switcher -->
        <div class="tab-track">
            <button onclick={() => activeTab = "login"}>Log in</button>
            <button onclick={() => activeTab = "signup"}>Sign up</button>
        </div>
        
        {#if activeTab === "login"}
            <!-- Login form -->
        {:else}
            <!-- Sign up form with display name -->
        {/if}
    </div>
</dialog>
```

### Anti-Patterns to Avoid

- **Using @supabase/ssr in Tauri:** The SSR package is designed for cookie-based auth with server middleware. Tauri has no server layer; use supabase-js directly. [CITED: supabase.com/docs/guides/auth/server-side/creating-a-client]
- **Storing session in Tauri keychain:** Per D-14, localStorage is the decided approach. Keychain adds complexity without benefit for prototype.
- **Creating user profile manually after signUp:** The Phase 1 trigger handles this automatically via `on_auth_user_created`. Don't duplicate the insert.
- **Checking session on every component mount:** Use `onAuthStateChange` subscription once at app init, not per-component getSession calls.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JWT refresh logic | Token refresh timer | `autoRefreshToken: true` | Supabase client handles proactive refresh |
| Session persistence | Custom localStorage code | `persistSession: true` | Built into client, handles edge cases |
| Auth state sync | Custom event bus | `onAuthStateChange` | Official subscription pattern, handles all auth events |
| Password hashing | bcrypt/argon2 | Supabase Auth | Server handles all password security |
| Email validation | Regex patterns | Zod `z.string().email()` | Already in project, battle-tested |

**Key insight:** Supabase Auth handles the security-critical parts (JWT issuance, refresh, password storage). Client code only needs to wire up UI to the SDK methods.

## Common Pitfalls

### Pitfall 1: Calling getSession on Every Mount
**What goes wrong:** Multiple redundant API calls, race conditions on initial load.
**Why it happens:** Copying web patterns without understanding subscription model.
**How to avoid:** Call `getSession` once at app init, then rely on `onAuthStateChange` for updates.
**Warning signs:** Network tab shows repeated `/auth/v1/user` requests.

### Pitfall 2: Missing display_name in Sign-Up Options
**What goes wrong:** User profile created with `display_name = 'Anonymous'` (trigger fallback).
**Why it happens:** Forgetting to pass `options.data.display_name` in signUp call.
**How to avoid:** Always include display name in signUp options. The trigger extracts `raw_user_meta_data ->> 'display_name'`.
**Warning signs:** All users show "Anonymous" in UI despite entering names.

### Pitfall 3: Not Handling Loading State
**What goes wrong:** UI flickers between logged-out and logged-in state on app start.
**Why it happens:** Rendering before initial session check completes.
**How to avoid:** Add `loading` state, show skeleton or nothing until `getSession` resolves.
**Warning signs:** Brief flash of "Sign In" button even when logged in.

### Pitfall 4: Blocking Signups with Sync Profile Insert
**What goes wrong:** If client tries to insert profile after signup and fails, user sees error.
**Why it happens:** Race condition or network issue on profile insert.
**How to avoid:** Let the database trigger handle profile creation. Client never writes to `public.users`.
**Warning signs:** "User created but profile creation failed" type errors.

### Pitfall 5: Hardcoding Supabase URL/Key in Source
**What goes wrong:** Keys exposed in git, can't switch between dev/prod environments.
**Why it happens:** Copy-pasting from quickstart docs.
**How to avoid:** Use `import.meta.env.PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_ANON_KEY` env vars.
**Warning signs:** Credentials visible in bundled JS.

## Code Examples

### Complete: Supabase Client Initialization

```typescript
// supabase.ts
// Source: https://supabase.com/docs/reference/javascript/initializing

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error("Missing Supabase environment variables");
}

export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        storage: localStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,  // No OAuth callback handling for v1
    },
});
```

### Complete: Auth Store with Svelte 5

```typescript
// auth.svelte.ts
// Source: Adapted from https://supabase.com/docs/reference/javascript/auth-onauthstatechange

import { supabase } from "./supabase";
import type { User, Session, AuthChangeEvent } from "@supabase/supabase-js";

// Reactive state using Svelte 5 runes
let user = $state<User | null>(null);
let session = $state<Session | null>(null);
let loading = $state(true);
let initialized = false;

export async function initAuth(): Promise<void> {
    if (initialized) return;
    initialized = true;

    // Check for existing session
    const { data: { session: existingSession }, error } = await supabase.auth.getSession();
    if (error) {
        console.error("[auth] Failed to get session:", error);
    }
    session = existingSession;
    user = existingSession?.user ?? null;
    loading = false;

    // Subscribe to auth changes
    supabase.auth.onAuthStateChange((event: AuthChangeEvent, newSession: Session | null) => {
        session = newSession;
        user = newSession?.user ?? null;
    });
}

// Auth actions
export async function signUp(email: string, password: string, displayName: string) {
    const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
            data: { display_name: displayName },
        },
    });
    if (error) throw error;
    return data;
}

export async function signIn(email: string, password: string) {
    const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
    });
    if (error) throw error;
    return data;
}

export async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
}

// Reactive getters
export function getUser() { return user; }
export function getSession() { return session; }
export function isLoading() { return loading; }
export function isAuthenticated() { return !!user; }

// Helper: get display name from user metadata
export function getDisplayName(): string | null {
    return user?.user_metadata?.display_name ?? null;
}
```

### Complete: Form Validation Schemas

```typescript
// schemas.ts
import { z } from "zod";

export const loginSchema = z.object({
    email: z.string().email("Invalid email address"),
    password: z.string().min(1, "Password is required"),
});

export const signUpSchema = z.object({
    email: z.string().email("Invalid email address"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    displayName: z.string().min(1, "Display name is required").max(50, "Display name too long"),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type SignUpInput = z.infer<typeof signUpSchema>;
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| @supabase/auth-helpers-* | @supabase/ssr or direct supabase-js | 2024 | Auth helpers deprecated, ssr for SSR apps, direct for client-only |
| Separate profile insert | Database trigger | Always | Trigger is more reliable, no client-side race conditions |
| Custom JWT parsing | `user.user_metadata` | Always | Supabase decodes JWT for you, metadata directly accessible |

**Deprecated/outdated:**
- `@supabase/auth-helpers-sveltekit`: Deprecated, use `@supabase/ssr` for SSR apps or direct supabase-js for client-only [CITED: supabase.com/docs/guides/auth/auth-helpers/sveltekit]
- GoTrue v1 API: Replaced by v2 in supabase-js 2.x

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `detectSessionInUrl: false` is safe since no OAuth for v1 | Pattern 1 | Would need to enable if adding OAuth later, minimal risk |
| A2 | localStorage persists in Tauri WebView across restarts | Pattern 1 | Session wouldn't persist; verified by prior Tauri apps |
| A3 | `raw_user_meta_data` is accessible in trigger function | Pattern 3 | Profile creation would fail; verified in Phase 1 migration |

## Open Questions (RESOLVED)

1. **Password Reset Flow Scope** — RESOLVED: Defer to future. Simple modal per D-17, password reset is Claude's discretion and not required for prototype.

2. **Error Display Strategy** — RESOLVED: Use svelte-sonner toasts (already in project) for auth errors. Inline Zod validation for form fields.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Supabase CLI | Database migrations | Yes | 2.84.2 | -- |
| Supabase Project | Auth backend | User must configure | -- | Local via Docker |
| bun | Package manager | Yes | -- | npm (per CLAUDE.md: prefer bun) |
| @supabase/supabase-js | Auth client | Needs install | 2.103.3 | -- |

**Missing dependencies with no fallback:**
- Supabase project must be configured with URL and anon key in environment variables

**Missing dependencies with fallback:**
- None

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.4 |
| Config file | vitest.config.ts |
| Quick run command | `bun run test:run src/lib/auth/` |
| Full suite command | `bun run test:run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AUTH-01 | signUp creates user with display_name | unit (mocked) | `bun run test:run src/lib/auth/auth.test.ts -t signup` | Wave 0 |
| AUTH-02 | signIn authenticates existing user | unit (mocked) | `bun run test:run src/lib/auth/auth.test.ts -t signin` | Wave 0 |
| AUTH-03 | Session persists (localStorage mock) | unit | `bun run test:run src/lib/auth/auth.test.ts -t persist` | Wave 0 |
| AUTH-04 | signOut clears session | unit (mocked) | `bun run test:run src/lib/auth/auth.test.ts -t signout` | Wave 0 |

### Sampling Rate
- **Per task commit:** `bun run test:run` (full unit suite)
- **Per wave merge:** Full suite + manual E2E verification with real Supabase
- **Phase gate:** Unit tests green + manual login/logout flow works against Supabase project

### Wave 0 Gaps
- [ ] `src/lib/auth/auth.test.ts` -- unit tests for auth store functions (mock Supabase client)
- [ ] `src/lib/auth/__mocks__/supabase.ts` -- mock Supabase client for testing
- [ ] Environment variables in `.env.example`: `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | Yes | Supabase Auth (email/password, JWT) |
| V3 Session Management | Yes | Supabase handles JWT issuance, refresh, expiry |
| V4 Access Control | Deferred | RLS policies (D-09 defers to future) |
| V5 Input Validation | Yes | Zod schemas for form validation |
| V6 Cryptography | No | Supabase handles password hashing server-side |

### Known Threat Patterns for Auth

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Credential stuffing | Spoofing | Supabase rate limiting, CAPTCHA (future) |
| Session hijacking | Spoofing | HTTPS only, short JWT expiry (1h default) |
| Weak password | Spoofing | Client-side min 8 chars, Supabase can enforce server-side |
| XSS stealing localStorage | Information Disclosure | DOMPurify already in project, CSP headers in Tauri |
| CSRF on auth endpoints | Tampering | Supabase API uses JWT auth, not cookies (no CSRF risk) |

**Note:** Supabase anon key is safe to expose in client code -- it only allows authenticated operations per RLS policies (which are deferred for prototype per D-09).

## Sources

### Primary (HIGH confidence)
- [Supabase JS Initializing](https://supabase.com/docs/reference/javascript/initializing) - Client configuration options
- [Supabase Auth API Reference](https://supabase.com/docs/reference/javascript/auth-api) - signUp, signIn, signOut methods
- [Supabase onAuthStateChange](https://supabase.com/docs/reference/javascript/auth-onauthstatechange) - Subscription pattern
- [Supabase Managing User Data](https://supabase.com/docs/guides/auth/managing-user-data) - Profile trigger pattern

### Secondary (MEDIUM confidence)
- [Supabase React Native Guide](https://supabase.com/docs/guides/auth/quickstarts/react-native) - localStorage storage pattern for non-web apps
- [Medium: Supabase + Tauri OAuth](https://medium.com/@nathancovey23/supabase-google-oauth-in-a-tauri-2-0-macos-app-with-deep-links-f8876375cb0a) - Confirms localStorage works in Tauri

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Official Supabase docs, npm registry verified
- Architecture: HIGH - Follows established Supabase patterns for client-only apps
- Pitfalls: HIGH - Based on official docs and common issues in GitHub discussions

**Research date:** 2026-04-17
**Valid until:** 2026-05-17 (30 days - Supabase stable, auth API well-established)
