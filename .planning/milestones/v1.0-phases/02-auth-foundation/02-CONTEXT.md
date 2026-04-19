# Phase 2: Auth Foundation - Context

**Gathered:** 2026-04-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Users can create accounts and log in with email/password via Supabase Auth. Sessions persist across app restarts. Login/logout UI accessible from the app. This phase establishes identity for collaboration — the relay server and sharing features depend on authenticated users.

</domain>

<decisions>
## Implementation Decisions

### UI Location
- **D-10:** Auth UI in top-right area of the app (avatar/button), opens modal for login/signup
- **D-11:** Document sharing configuration also accessible from that top-right area (future phases will implement)
- **D-12:** Logged-in indicator visible in top-right (avatar)

### Session Handling
- **D-13:** Instant activation — no email verification required for prototype
- **D-14:** Session storage via localStorage (Supabase JS client default, `persistSession: true`)

### Visual Design
- **D-15:** Logged out: faint "Sign In" button (gray/glassy styling, matches existing UI elements like status bar)
- **D-15b:** Logged in: Avatar (generated from display name per D-02) + dropdown menu

### Sign-Up Flow
- **D-16:** Display name collected during sign-up (form field alongside email/password)
- **D-17:** Simple auth modal — email/password fields only, tabs to switch between login/signup, minimal UI

### Claude's Discretion
- Exact modal styling (follow existing SettingsModal patterns)
- Dropdown menu contents and interactions
- Error message display and handling
- Password reset flow details (if included in v1)
- Form validation UX (inline vs. on-submit)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` — AUTH-01 through AUTH-04 define authentication requirements

### Architecture Context
- `.planning/PROJECT.md` — Supabase Auth decision, constraints
- `.planning/phases/01-data-model/01-CONTEXT.md` — D-01 (display names only), D-02 (avatars from display name), D-09 (zero RLS)

### UI Patterns
- `src/lib/settings/SettingsModal.svelte` — Modal dialog pattern, tab switching, form controls, save/cancel flow
- `src/lib/settings.svelte.ts` — Settings store pattern (for reference on state management)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `SettingsModal.svelte` — Modal dialog pattern with backdrop, shake animation, tabs
- `src/lib/ui/` — Shared UI components (Kbd, modals, banners)
- Tailwind CSS with existing gray/glassy button patterns in status bar and settings
- Lucide icons (`lucide-svelte`) for UI elements

### Established Patterns
- Svelte 5 runes for reactive state (`.svelte.ts` stores)
- localStorage for client-side persistence (settings pattern)
- Tauri keychain for sensitive data (API keys) — available but not needed for session per D-14
- PostHog analytics integration for user actions

### Integration Points
- Top-right area of main layout (`src/routes/+page.svelte`) — new auth UI goes here
- Supabase JS client needs to be initialized (new dependency)
- `users` table in Supabase (created in Phase 1) — will be populated on sign-up

</code_context>

<specifics>
## Specific Ideas

- "Sign In" button should be faint/glassy like other status bar elements — not prominent
- Avatar + dropdown pattern similar to how other apps handle logged-in state
- Modal should be simple and fast — just email, password, and a tab to switch modes
- Display name field appears only on sign-up tab

</specifics>

<deferred>
## Deferred Ideas

- Document sharing UI — noted in D-11 as accessible from top-right, but implementation is future phases
- Password reset flow — may be minimal or deferred based on Claude's discretion
- OAuth providers (Google, GitHub) — v2 feature (AUTH-10, AUTH-11)
- Email verification — explicitly skipped for prototype (D-13)

</deferred>

---

*Phase: 02-auth-foundation*
*Context gathered: 2026-04-17*
