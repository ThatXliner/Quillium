# Phase 3: Anonymous Auth - Context

**Gathered:** 2026-04-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Collaborators can join shared documents without creating accounts. Supabase anonymous auth provides JWT tokens that work with the relay WebSocket connection. This phase enables the "anyone with the link" sharing model decided in Phase 1.

</domain>

<decisions>
## Implementation Decisions

### Anonymous Identity
- **D-20:** Self-selected display name — anonymous users are prompted to enter a display name before joining the document
- **D-21:** Avatar generated from display name (per D-02 from Phase 1)
- **D-22:** No account required — just name entry and they're in

### Session Lifecycle
- **D-23:** Anonymous auth triggers only when joining a shared document (not on app startup)
- **D-24:** Anonymous session persists in localStorage across app restarts (same as authenticated sessions per D-14)
- **D-25:** If user has existing authenticated session, no anonymous auth needed — they join as themselves

### Account Upgrade
- **D-26:** Anonymous user can sign in while viewing a shared doc — session switches to authenticated
- **D-27:** Edits/comments made while anonymous stay attributed to the anonymous identity (not re-attributed to new account)

### Claude's Discretion
- Name entry UI design (modal, inline prompt, etc.)
- Name validation rules (min/max length, allowed characters)
- Anonymous session expiry (if any)
- How anonymous user metadata is stored in Supabase

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` — AUTH-05 defines anonymous auth requirement

### Prior Decisions
- `.planning/phases/01-data-model/01-CONTEXT.md` — D-02 (avatars from display name), D-04 (anyone with link can join)
- `.planning/phases/02-auth-foundation/02-CONTEXT.md` — D-14 (localStorage sessions)

### Supabase Docs
- Supabase Anonymous Auth: https://supabase.com/docs/guides/auth/auth-anonymous

### Existing Code
- `src/lib/auth/supabase.ts` — Supabase client singleton
- `src/lib/auth/auth.svelte.ts` — Auth state store (needs `signInAnonymously` function)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `supabase` client already configured with localStorage persistence
- `auth.svelte.ts` store pattern — add `signInAnonymously()` alongside existing `signIn()`
- Avatar generation logic (client-side from display name) — will be shared with authenticated users

### Established Patterns
- Auth functions throw on error, caller handles
- `onAuthStateChange` subscription updates reactive state
- Display name stored in `user_metadata`

### Integration Points
- Share link handling (future phase) will trigger anonymous auth flow
- Relay WebSocket connection will use JWT from anonymous session
- `getDisplayName()` already reads from `user_metadata` — works for anonymous too

</code_context>

<specifics>
## Specific Ideas

- Name entry should feel lightweight — not a full sign-up form, just "Enter your name to join"
- Similar to how Google Docs prompts for a name when you're not logged in

</specifics>

<deferred>
## Deferred Ideas

- Share link deep-linking (`quillium://join/{token}`) — Phase 4+ when relay is ready
- Anonymous session expiry/cleanup — not needed for prototype
- Re-attribution of anonymous edits to account — explicitly rejected (D-27)

</deferred>

---

*Phase: 03-anonymous-auth*
*Context gathered: 2026-04-17*
