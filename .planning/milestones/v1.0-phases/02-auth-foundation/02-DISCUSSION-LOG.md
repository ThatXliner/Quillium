# Phase 2: Auth Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-17
**Phase:** 02-auth-foundation
**Areas discussed:** Login/Logout UI Location, Session Storage Strategy, Auth State Indication, Sign-Up Flow, Auth Modal Design

---

## Login/Logout UI Location

| Option | Description | Selected |
|--------|-------------|----------|
| Settings modal section | Add auth section to existing SettingsModal | |
| Dedicated Account modal | Separate modal for account management | |
| Status bar dropdown | Auth controls in status bar area | |
| Top-right area | Avatar/button in top-right, opens modal | ✓ |

**User's choice:** Top-right area with modal, document sharing config also accessible from there
**Notes:** User specified this area should also house document sharing configuration for future phases

---

## Session Storage Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| localStorage (Supabase default) | Simple, uses Supabase's built-in persistSession | ✓ |
| Tauri keychain | More secure, matches API key pattern | |
| Hybrid | localStorage + keychain backup | |

**User's choice:** localStorage only (Supabase default)
**Notes:** User asked for clarification on Supabase's built-in persistence before deciding

---

## Auth State Indication

| Option | Description | Selected |
|--------|-------------|----------|
| Status bar avatar/name | Show logged-in state in status bar | |
| Settings section indicator | Show in settings only | |
| Top-right indicator | Avatar/indicator in top-right area | ✓ |
| None until collab used | Defer visibility | |

**User's choice:** Top-right indicator (aligned with UI location decision)

---

## Sign-Up Flow

| Option | Description | Selected |
|--------|-------------|----------|
| Email verification required | Must verify email before using app | |
| Instant activation | No verification, immediate access | ✓ |
| Display name during sign-up | Collect name as part of registration | ✓ |
| Display name after login | Prompt for name on first use | |
| Display name on first share | Lazy collection | |

**User's choice:** Instant activation + display name during sign-up
**Notes:** User confirmed this is Supabase's default behavior anyway

---

## Visual Design

| Option | Description | Selected |
|--------|-------------|----------|
| "Sign In" button → Avatar + dropdown | Explicit login button when logged out | ✓ |
| Generic user icon → Avatar + dropdown | Icon always visible | |
| Avatar placeholder always | Same element, different states | |

**User's choice:** Faint gray/glassy "Sign In" button → Avatar + dropdown menu
**Notes:** User specified styling should match existing UI elements

---

## Auth Modal Design

| Option | Description | Selected |
|--------|-------------|----------|
| Simple email/password only | Minimal fields, login/signup tabs | ✓ |
| Email/password + extras | Forgot password link, display name on signup | |
| Full form | Terms checkbox, password strength, etc. | |

**User's choice:** Simple email/password only with tabs

---

## Claude's Discretion

- Exact modal styling (following existing SettingsModal patterns)
- Dropdown menu contents
- Error message handling
- Password reset flow details (if any for v1)
- Form validation UX

## Deferred Ideas

- Document sharing UI implementation — future phases
- OAuth providers (Google, GitHub) — v2
- Email verification — explicitly skipped
