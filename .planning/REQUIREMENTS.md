# Requirements: Quillium Omni

**Defined:** 2025-04-16
**Core Value:** Two Quillium instances can connect and see each other's edits in real-time
**Source:** GitHub #164

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Authentication

- [ ] **AUTH-01**: User can sign up with email and password via Supabase
- [ ] **AUTH-02**: User can log in with existing account
- [ ] **AUTH-03**: User session persists across app restarts
- [ ] **AUTH-04**: User can log out
- [ ] **AUTH-05**: Anonymous users get automatic Supabase anonymous auth token (no account needed to join)

### Real-Time Sync

- [ ] **SYNC-01**: Document text syncs in real-time (~100ms latency)
- [ ] **SYNC-02**: Concurrent edits auto-merge via OT (no manual conflict UI)
- [ ] **SYNC-03**: Connection status indicator shows connected/syncing/offline
- [ ] **SYNC-04**: Reconnection recovers pending changes (queue + rebase)
- [ ] **SYNC-05**: Annotations (comments, revisions, suggestions) sync as part of document state


### Offline (Owner)

- [ ] **OFFL-01**: Owner can edit offline (local SQLite continues working)
- [ ] **OFFL-02**: Owner's offline edits queue and rebase on reconnect
- [ ] **OFFL-03**: Pre-merge snapshot taken as safety net before rebase

### Relay Server

- [ ] **RELY-01**: WebSocket server accepts connections with JWT auth
- [ ] **RELY-02**: Relay validates permissions via Supabase
- [ ] **RELY-03**: Relay assigns version numbers and orders changes
- [ ] **RELY-04**: Relay broadcasts updates to all connected clients
- [ ] **RELY-05**: Relay persists updates to Supabase Postgres
- [ ] **RELY-06**: Relay can reload state from DB on restart (stateless-ish)

### Data Model

- [ ] **DATA-01**: `users` table for profiles and subscription status
- [ ] **DATA-02**: `sync_documents` table for document registry
- [ ] **DATA-03**: `collab_updates` table for ordered change history
- [ ] **DATA-04**: `shares` table for access grants with tokens and permissions

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### OAuth

- **AUTH-10**: User can sign up/in with Google OAuth
- **AUTH-11**: User can sign up/in with GitHub OAuth

### Presence (Deferred from v1)

- **PRES-01**: Online/offline status shows for each collaborator
- **PRES-02**: Collaborator cursor positions visible in document
- **PRES-03**: Follow mode: opt-in to mirror another user's viewport and view state
- **PRES-04**: Collaborator avatars/names shown in UI

### Sharing UI (Deferred from v1)

- **SHAR-01**: Owner can create share link with permission level (view/comment/edit)
- **SHAR-02**: Share link opens app via deep link (`quillium://join/{token}`)
- **SHAR-03**: Owner can revoke share access
- **SHAR-04**: Collaborators can join without creating an account (anonymous)

### Yjs Migration

- **SYNC-10**: Replace @codemirror/collab with Yjs for better offline/P2P
- **SYNC-11**: Yjs awareness protocol for presence

### Web Client

- **WEB-01**: Lightweight browser client for collaborators (view + comment)
- **WEB-02**: Full editing for subscribers in browser

### Mobile

- **MOBI-01**: Cross-device sync via mobile app

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Version history sync | Collaborators don't get snapshots — owner is the safety net |
| AI sidebar state sync | Per-user, not shared |
| AutoAI config sync | Per-user preferences |
| UI state sync (modals) | Only syncs during follow mode |
| Manual merge/conflict UI | Auto-merge via OT handles everything |
| Collaborator offline editing | Server-dependent by design |
| Web client (v1) | Desktop-only for v1 |
| Mobile (v1) | Desktop-only for v1 |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| DATA-01 | Phase 1 | Pending |
| DATA-02 | Phase 1 | Pending |
| DATA-03 | Phase 1 | Pending |
| DATA-04 | Phase 1 | Pending |
| AUTH-01 | Phase 2 | Pending |
| AUTH-02 | Phase 2 | Pending |
| AUTH-03 | Phase 2 | Pending |
| AUTH-04 | Phase 2 | Pending |
| AUTH-05 | Phase 3 | Pending |
| RELY-01 | Phase 4 | Pending |
| RELY-02 | Phase 4 | Pending |
| RELY-03 | Phase 4 | Pending |
| RELY-04 | Phase 4 | Pending |
| RELY-05 | Phase 5 | Pending |
| RELY-06 | Phase 5 | Pending |
| SYNC-01 | Phase 6 | Pending |
| SYNC-02 | Phase 6 | Pending |
| SYNC-03 | Phase 7 | Pending |
| SYNC-04 | Phase 7 | Pending |
| SYNC-05 | Phase 8 | Pending |
| OFFL-01 | Phase 9 | Pending |
| OFFL-02 | Phase 9 | Pending |
| OFFL-03 | Phase 9 | Pending |

**Coverage:**
- v1 requirements: 23 total
- Mapped to phases: 23
- Unmapped: 0

---
*Requirements defined: 2025-04-16*
*Source: GitHub #164*
*Traceability updated: 2025-04-16*
