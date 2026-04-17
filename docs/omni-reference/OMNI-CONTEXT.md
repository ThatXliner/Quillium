# Quillium Omni — Context for GSD

This document consolidates all context needed to bootstrap Quillium Omni development via GSD.

## What We're Building

**Quillium Omni** is the paid ($20/month) sync and real-time collaboration service for Quillium, a Tauri + SvelteKit desktop writing app.

**Goal for this project:** A testable prototype that validates the architecture — two Quillium instances can connect to a relay server and see each other's edits in real-time. Not production-ready; presence, sharing UI, and polish are out of scope.

## Blocking Decision: Auth Model

Before any implementation, we must decide between two mutually exclusive auth approaches:

### Option A: License Key Auth (GitHub #194)

Mullvad-style opaque license keys. No email/password in the app — just paste a key.

**How it works:**
- Website (quillium-landing) handles key generation, payment, email linking
- App stores a single opaque string, sends it to validate requests
- Stronger privacy story — app literally can't identify you

**Tradeoffs:**
- Must build custom auth infrastructure (no Supabase Auth)
- Key validation middleware for relay server
- Custom session/token system for WebSocket auth
- Recovery flow if user loses key

### Option B: Supabase Auth (GitHub #165)

Standard email/password + OAuth via Supabase.

**How it works:**
- Supabase handles login, signup, anonymous auth, token refresh
- JWT-based session management
- Row-level security via auth.uid()

**Tradeoffs:**
- Faster to ship (Supabase provides auth out of the box)
- Less privacy differentiation
- More complex app-side code (login/signup/forgot password UI)

**Decision needed before starting Phase 1.**

## Architecture Overview (from #164)

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Supabase                                     │
│  ┌──────────┐  ┌──────────────┐  ┌────────────────────────────┐    │
│  │   Auth   │  │   Postgres   │  │     Realtime Broadcast     │    │
│  │  (or N/A │  │              │  │                            │    │
│  │  if #194)│  │ • users      │  │ • Cursor positions         │    │
│  │          │  │ • documents  │  │ • Who's online (presence)  │    │
│  │          │  │ • shares     │  │ • Follow mode signals      │    │
│  │          │  │ • collab     │  │                            │    │
│  │          │  │   updates    │  │                            │    │
│  └──────────┘  └──────┬───────┘  └────────────────────────────┘    │
│                       │                                             │
└───────────────────────┼─────────────────────────────────────────────┘
                        │
              ┌─────────┴─────────┐
              │   Collab Relay    │
              │   (Node.js)       │
              │                   │
              │ • WebSocket server│
              │ • Version counter │
              │ • Change ordering │
              │ • Broadcast       │
              │                   │
              │   Fly.io ~$7/mo   │
              └────┬─────────┬────┘
                   │         │
          ┌────────┘         └────────┐
          │                           │
┌─────────┴──────────┐   ┌───────────┴─────────┐
│   Owner (Paying)   │   │   Collaborator      │
│                    │   │                     │
│ • Full Tauri app   │   │ • Full Tauri app    │
│ • Local SQLite     │   │ • No local persist  │
│ • Version history  │   │ • No version history│
│ • Offline editing  │   │ • Anonymous OK      │
└────────────────────┘   └─────────────────────┘
```

## Sub-Issues (from #164)

| Issue | Title | Status | Blocked By |
|-------|-------|--------|------------|
| #165 | Supabase Auth + Account System | Open | Auth decision (#194) |
| #166 | Collab Relay Server | Open | Auth decision |
| #167 | Client Collab Integration | Open | #166 |
| #168 | Presence System (cursors, follow mode) | Open | #167 |
| #169 | Sharing UI + Permissions | Open | #167 |

**For the prototype, we need:** Auth decision resolved → #165 or #194 equivalent → #166 → #167 (partial).

#168 and #169 are out of scope for the prototype.

## Data Model (Supabase Postgres)

| Table | Purpose |
|-------|---------|
| `users` | User profiles, subscription status |
| `sync_documents` | Server-side document registry — id, owner_id, title, created_at |
| `collab_updates` | Ordered change history — document_id, version, changes (JSON), client_id, created_at |
| `shares` | Access grants — document_id, token, email, permission, created_at |

If using license keys (#194), add:
| `license_keys` | key, status (active/expired), created_at, expires_at |

## Client-Side Changes Needed

### New Modules (src/lib/sync/)

| Module | Purpose |
|--------|---------|
| `auth.ts` | Auth handling (license key storage OR Supabase client) |
| `relay.ts` | WebSocket connection to collab relay |
| `collab.ts` | Wire `@codemirror/collab` into the editor |
| `presence.ts` | Supabase Realtime for cursors/online users (out of scope for prototype) |
| `sharing.ts` | Share links, permissions (out of scope for prototype) |

### Changes to Existing Modules

| File | Change |
|------|--------|
| `src/lib/editor/extensions.ts` | Add collab extension (conditionally, only when syncing) |
| `src/lib/editor/listeners.ts` | When syncing, also send changes to relay |
| `src/routes/+page.svelte` | Minimal UI to enable/test sync |

## Repos Involved

1. **Quillium** (`/Users/bryanhu/Developer/current/Quillium`) — Desktop app, client-side collab integration
2. **quillium-landing** (`/Users/bryanhu/Developer/current/quillium-landing`) — Website; if #194, handles key generation + payment

## Existing Test Infrastructure

- Vitest with jsdom
- Test files in `src/lib/**/*.test.ts`
- E2E via Playwright (`bun run test:e2e`)
- Run tests: `bun run test:run`
- Type check: `bun run check`

## Success Criteria for Prototype

1. Auth mechanism works (key validation or Supabase login)
2. Relay server accepts WebSocket connections, validates auth
3. Two Quillium instances can connect to the same document
4. Edits from one instance appear in the other in real-time
5. Basic offline queue works for owner (edits sync when reconnected)

## What's NOT in Scope

- Presence (cursors, online indicators)
- Follow mode
- Sharing UI
- Permission levels
- Version history sync
- Production hardening
- Mobile/web clients

## Key Technical Decisions Already Made

- Use `@codemirror/collab` for v1 (Yjs migration later)
- Supabase Postgres as single source of truth
- Relay is stateless-ish (reloads from DB on restart)
- Owner has full offline editing; collaborators are server-dependent
- Annotations (comments, revisions) sync as part of CodeMirror state

## Links

- Design spec: https://github.com/ThatXliner/Quillium/issues/164
- Auth decision: https://github.com/ThatXliner/Quillium/issues/194
- Existing open PRs: #171 (Supabase auth branch), #172 (relay server) — both paused pending decision
