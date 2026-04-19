# Roadmap: Quillium Omni

## Overview

Quillium Omni adds real-time collaborative editing to an existing single-user desktop writing app. The build follows a strict dependency chain: Supabase tables first (data model), then authentication (identity for JWT), then the relay server (central authority for OT), then client integration (collab extension), and finally annotation sync. The relay server lives in the `quillium-landing` repo.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Data Model** - Supabase tables for users, documents, updates, and shares
- [x] **Phase 2: Auth Foundation** - Email/password authentication with session persistence
- [x] **Phase 3: Anonymous Auth** - Anonymous tokens for collaborators without accounts
- [x] **Phase 4: Relay Core** - WebSocket server with JWT auth and OT ordering
- [x] **Phase 5: Relay Persistence** - Durable update storage and server restart recovery
- [x] **Phase 6: Client Collab** - CodeMirror collab integration with real-time sync
- [x] **Phase 6.5: Collab Polish** - Live cursors, owner disconnect handling, dev setup docs
- [x] **Phase 7: Connection UX** - Status indicator and reconnection handling
- [x] **Phase 7.5: Yjs Migration** - Replace OT with Yjs CRDT (INSERTED)
- [x] **Phase 8: Annotation Sync** - Sync comments and revisions via Yjs shared types
- [x] **Phase 8.5a: CRDT Data Shape** - Recursive Y.Map annotation shape + converters (INSERTED)
- [x] **Phase 8.5b: CRDT Sync Plumbing** - Scoped observeDeep plugin + undo-scope helper (INSERTED)
- [x] **Phase 8.5c: CRDT Nested Editor Wiring** - Subtree bindings + undo auto-nav (INSERTED)

## Phase Details

### Phase 1: Data Model
**Goal**: Supabase Postgres has all tables needed for collaboration
**Depends on**: Nothing (first phase)
**Requirements**: DATA-01, DATA-02, DATA-03, DATA-04
**Success Criteria** (what must be TRUE):
  1. `users` table exists with profile and subscription fields
  2. `sync_documents` table exists for document registry
  3. `collab_updates` table exists for ordered change history
  4. `shares` table exists for access grants with tokens
  5. ~~Row-level security policies protect all tables~~ (deferred to pre-production hardening per D-09)
**Plans**: 3 plans

Plans:
- [x] 01-01-PLAN.md - Supabase CLI setup + extensions + users table (DATA-01)
- [x] 01-02-PLAN.md - sync_documents + collab_updates tables (DATA-02, DATA-03)
- [x] 01-03-PLAN.md - shares table + seed data (DATA-04)

### Phase 2: Auth Foundation
**Goal**: Users can create accounts and log in with persistent sessions
**Depends on**: Phase 1
**Requirements**: AUTH-01, AUTH-02, AUTH-03, AUTH-04
**Success Criteria** (what must be TRUE):
  1. User can sign up with email/password from Quillium app
  2. User can log in and session persists across app restarts
  3. User can log out from the app
  4. Login/logout UI exists in appropriate location
**Plans**: 2 plans
**UI hint**: yes

Plans:
- [x] 02-01-PLAN.md - Supabase client + auth store (AUTH-01, AUTH-02, AUTH-03, AUTH-04)
- [x] 02-02-PLAN.md - Auth UI components (AUTH-01, AUTH-02, AUTH-03, AUTH-04)

### Phase 3: Anonymous Auth
**Goal**: Collaborators can join documents without creating accounts
**Depends on**: Phase 2
**Requirements**: AUTH-05
**Success Criteria** (what must be TRUE):
  1. Anonymous users get automatic Supabase anon token
  2. Anonymous token works for relay WebSocket connection
  3. No account creation required to join as collaborator
**Plans**: 1 plan

Plans:
- [x] 03-01-PLAN.md - Anonymous auth function + name entry modal (AUTH-05)

### Phase 4: Relay Core
**Goal**: WebSocket relay server accepts connections and orders changes (in quillium-landing repo)
**Depends on**: Phase 3
**Requirements**: RELY-01, RELY-02, RELY-03, RELY-04
**Success Criteria** (what must be TRUE):
  1. Relay accepts WebSocket connections with JWT auth
  2. Relay validates permissions via Supabase
  3. Relay assigns version numbers using rebaseUpdates (not rejection)
  4. Relay broadcasts updates to all connected clients
**Plans**: 3 plans

Plans:
- [x] 04-01-PLAN.md - Project scaffold and test infrastructure (Wave 0)
- [x] 04-02-PLAN.md - Socket.io server with JWT auth and permissions (RELY-01, RELY-02)
- [x] 04-03-PLAN.md - Room management, OT ordering, and broadcasting (RELY-03, RELY-04)

### Phase 5: Relay Persistence
**Goal**: Relay survives restarts without losing document state (in quillium-landing repo)
**Depends on**: Phase 4
**Requirements**: RELY-05, RELY-06
**Success Criteria** (what must be TRUE):
  1. Relay persists all updates to Supabase Postgres
  2. Relay can reload full document state from DB on restart
  3. Clients reconnecting after server restart get correct state
**Plans**: 3 plans

Plans:
- [x] 05-01-PLAN.md - DB migration + persistence module foundation (Wave 0)
- [x] 05-02-PLAN.md - Write-through persistence + snapshots (RELY-05)
- [x] 05-03-PLAN.md - Room state loading from DB (RELY-06)

### Phase 6: Client Collab
**Goal**: Two Quillium instances can see each other's text edits in real-time
**Depends on**: Phase 5
**Requirements**: SYNC-01, SYNC-02
**Success Criteria** (what must be TRUE):
  1. Text edits sync between clients with ~100ms latency
  2. Concurrent edits auto-merge via OT (no conflict UI)
  3. Per-user undo works correctly (don't undo remote changes)
  4. Document content converges identically on all clients
**Plans**: 3 plans
**UI hint**: yes

Plans:
- [x] 06-01-PLAN.md - Collab module foundation: types, protocol, socket client (SYNC-01)
- [x] 06-02-PLAN.md - Collab ViewPlugin and extension integration (SYNC-01, SYNC-02)
- [x] 06-03-PLAN.md - Go Live button UI (SYNC-01, SYNC-02)

### Phase 6.5: Collab Polish (INSERTED)
**Goal**: Essential UX polish for usable collab sessions
**Depends on**: Phase 6
**Requirements**: (new)
**Success Criteria** (what must be TRUE):
  1. Live cursors show other users' cursor positions in real-time
  2. When owner disconnects, all clients are kicked with clear message
  3. Developer documentation explains how to run the full collab setup
**Plans**: 4 plans

Plans:
- [x] 06.5-01-PLAN.md — Relay: isOwner middleware, ownerLeft + clientLeft + cursorUpdate broadcast
- [x] 06.5-02-PLAN.md — Developer collab setup guide (docs/collab-setup.md)
- [x] 06.5-03-PLAN.md — Client cursor module: StateField + ViewPlugin + WidgetType + tests
- [x] 06.5-04-PLAN.md — Client: ownerLeft/clientLeft wiring, cursor extension composition
**UI hint**: yes

### Phase 7: Connection UX
**Goal**: Users always know connection status and recover gracefully from disconnects
**Depends on**: Phase 6.5
**Requirements**: SYNC-03, SYNC-04
**Success Criteria** (what must be TRUE):
  1. Connection indicator shows connected/syncing/offline status
  2. Reconnection automatically recovers pending changes
  3. No data loss or duplication on reconnect
  4. User sees clear feedback during reconnection
**Plans**: 1 plan
**UI hint**: yes
**Note**: StatusBar and GoLiveButton already handle reconnection display and toasts. Only yjsProvider.ts needs modification to track attempts and transition to error state.

Plans:
- [x] 07-01-PLAN.md — Reconnection tracking and backoff in yjsProvider.ts (SYNC-03, SYNC-04)

### Phase 7.5: Yjs Migration (INSERTED)
**Goal**: Replace OT (@codemirror/collab) with Yjs CRDT for more robust sync
**Depends on**: Phase 7
**Requirements**: SYNC-10 (replaces SYNC-01, SYNC-02 implementation)
**Success Criteria** (what must be TRUE):
  1. Client uses custom Yjs-CodeMirror binding (per D-72, y-codemirror.next unmaintained)
  2. Relay uses y-websocket provider pattern with native WebSocket
  3. Documents sync correctly between multiple clients
  4. Concurrent edits converge without version mismatch errors
  5. Per-user undo works via Yjs UndoManager
  6. Existing features (cursors, owner disconnect) preserved
  7. Awareness protocol replaces custom cursor sync
**Plans**: 7 plans in 4 waves
**UI hint**: no (backend refactor)

Plans:
- [x] 07.5-01-PLAN.md — Install Yjs deps, create Y.Text <-> CodeMirror binding (SYNC-10)
- [x] 07.5-02-PLAN.md — UndoManager integration, awareness-based cursors (SYNC-10)
- [x] 07.5-03-PLAN.md — WebsocketProvider wrapper with auth (SYNC-10)
- [x] 07.5-04-PLAN.md — Relay: Yjs sync handler, persistence module (SYNC-10)
- [x] 07.5-05-PLAN.md — Relay: Server rewrite with native WebSocket + Yjs (SYNC-10)
- [x] 07.5-06-PLAN.md — Client: Wire up Yjs in index.ts, update GoLiveButton (SYNC-10)
- [x] 07.5-07-PLAN.md — Remove OT code, manual integration verification (SYNC-10)

### Phase 8: Annotation Sync
**Goal**: Comments and revisions sync between collaborators
**Depends on**: Phase 7.5
**Requirements**: SYNC-05
**Success Criteria** (what must be TRUE):
  1. Comment annotations sync via Yjs Y.Map shared type
  2. Revision annotations sync via Yjs Y.Map shared type
  3. Position tracking uses Yjs RelativePosition (no drift)
  4. Annotation operations integrate with per-user undo
**Plans**: 6 plans in 5 waves
**UI hint**: no (backend sync layer)

Plans:
- [x] 08-01-PLAN.md — Types, schemas, RelativePosition utilities (SYNC-05)
- [x] 08-02-PLAN.md — UndoManager extension for unified undo (SYNC-05)
- [x] 08-03-PLAN.md — Annotation sync ViewPlugin with bidirectional sync (SYNC-05)
- [x] 08-04-PLAN.md — Revision-specific sync (version switches, additions) (SYNC-05)
- [x] 08-05-PLAN.md — Wire annotation sync into collab module (SYNC-05)
- [x] 08-06-PLAN.md — Convergence tests and manual verification (SYNC-05)

### Phase 8.5a: CRDT Data Shape (INSERTED)
**Goal**: Rewrite the YjsAnnotation data model from a flat JSON blob into a recursive Y.Map node with Y.Text/Y.Array/Y.Map children, so every revision version owns a dedicated Y.Text subtree
**Depends on**: Phase 8
**Requirements**: SYNC-05 (extended)
**Success Criteria** (what must be TRUE):
  1. `YjsAnnotationNode = Y.Map<unknown>` replaces the legacy flat `YjsAnnotation` interface
  2. `codeMirrorToYjsAnnotation` builds child Y types (Y.Text for version bodies, Y.Array for threads, Y.Map for nested annotations) inside a single `ydoc.transact`
  3. `yjsAnnotationToCodeMirror` reads Y.Map children directly with no JSON parsing
  4. `annotation-tree.test.ts` passes the shape-integrity, version-propagation, thread-ordering, bounds-clamp, and null-selection tests
**Plans**: 2 plans in 2 waves

Plans:
- [x] 08.5a-01-PLAN.md — Wave 0 test scaffolds: twoPeerHarness + 8 failing-test files (SYNC-05)
- [x] 08.5a-02-PLAN.md — Shape refactor: types.ts + annotationSchema.ts recursive Y.Map converters (SYNC-05)

### Phase 8.5b: CRDT Sync Plumbing (INSERTED)
**Goal**: Make the annotation sync plugin scope-agnostic via `observeDeep` so it can operate at any recursion depth, and extend the UndoManager with a subtree-scope helper for nested editors
**Depends on**: Phase 8.5a
**Requirements**: SYNC-05 (extended)
**Success Criteria** (what must be TRUE):
  1. `createAnnotationSyncPlugin(scopeYtext, scopeAnnotations, clientId)` works at any recursion depth via a single `observeDeep` subscription
  2. `syncRevisionChanges` JSON-blob path is deleted wholesale
  3. Concurrent Y.Array thread appends from two peers both survive (D-93)
  4. `addSubtreeToUndoScope(undoManager, subtreeYtext)` exists and is callable from NestedEditorController
  5. `AnnotationEvent` union includes the `undo-target` variant for Phase 8.5c's auto-nav
**Plans**: 2 plans in 1 wave (parallel)

Plans:
- [x] 08.5b-01-PLAN.md — yjsAnnotations.ts rewrite: scoped observeDeep plugin, syncRevisionChanges removal (SYNC-05)
- [x] 08.5b-02-PLAN.md — yjsUndo.ts: addSubtreeToUndoScope + breakUndoCapture; eventBus undo-target variant (SYNC-05)

### Phase 8.5c: CRDT Nested Editor Wiring (INSERTED)
**Goal**: Wire subtree bindings into NestedEditorController so peer edits inside a nested revision editor merge character-by-character, and surface cross-editor undo via auto-navigation
**Depends on**: Phase 8.5b
**Requirements**: SYNC-05 (extended)
**Success Criteria** (what must be TRUE):
  1. NestedEditorController installs a subtree Y.Text binding + scoped annotation sync plugin on mount when collab is active
  2. Concurrent keystrokes by two peers inside the same nested editor merge without data loss
  3. `annotationField` Phase 3 (pushDocToVersionState) is bypassed when a subtree Y.Text owns the text
  4. Recursive mount: nested-in-nested subtree bindings fire correctly (D-92)
  5. Undo popping a stack item whose subtree points to a non-focused editor emits an `undo-target` event; E2E test proves the user-visible behavior
  6. Version switches remain local-only and do not interrupt peer editing of other versions
  7. Comment threads append via Y.Array sorted by timestamp on read (Y.Array already delivered in 8.5b)
**Plans**: 2 plans in 2 waves

Plans:
- [x] 08.5c-01-PLAN.md — NestedEditorController subtree binding + annotationField Phase 3 gating (SYNC-05)
- [x] 08.5c-02-PLAN.md — collab/index.ts undo auto-nav wiring + Playwright E2E test (SYNC-05)

### Phase 9: Fix Live Collab Revision Editing Bugs
**Goal**: Fix cascading bugs discovered while dogfooding live-collab revision editing so the feature is actually dogfoodable — editing a revision version syncs cleanly, switching active version never destroys the annotation, and cmd-z never reverts the joiner to pre-connect state
**Depends on**: Phase 8.5c
**Requirements**: SYNC-05 (stability), dogfoodable quality bar
**Success Criteria** (what must be TRUE):
  1. Integration test harness exercises the full nested-editor + subtree Y.Text + parent-doc flow across two peers (no manual click-testing required)
  2. Nested-editor typing on the active version keeps parent doc slice, `versions[i].doc`, and subtree Y.Text all in sync
  3. Switching active version (including the first switch after initial join) preserves the annotation — decoration stays visible, selection is valid, version content is correct
  4. Cmd-z on joiner right after connect does NOT revert to pre-connect local doc or mangle the seeded content
  5. Remote peer edits to inactive version Y.Text propagate to local `versions[i].doc` for UI rendering
  6. No duplicate annotations after joiner initial sync (Yjs-seeded vs SQLite-seeded)
**Plans**: 3 plans in 3 waves

Plans:
- [x] 09-01-PLAN.md — Integration tests for all bug invariants (SYNC-05)
- [x] 09-02-PLAN.md — D-100 Room-as-View architecture + D-103 prior-view restore (SYNC-05)
- [x] 09-03-PLAN.md — Verify sync bugs fixed by 8.5a-c (SYNC-05)

**Status**: REOPENED 2026-04-19 — success criteria 2, 3, 5 not met in real app. Dogfooding
revealed inline-editor version text and active-version switching still fail on the joiner,
and concurrent edits inside a revision do not round-trip. Plans 1–3 landed work but the
phase's goal (dogfoodable live-collab revisions) was not achieved. Continuation in phases
10–13 on the `omni-fixes` branch.

### Phase 10: Strip Broken Collab Sync Layer
**Goal**: Remove all code paths that make live-collab annotation sync inconsistent, leaving
main-text sync working and annotation sync intentionally disabled. Clean ground for Phase 11's rebuild.
**Depends on**: Phase 9 (reopened)
**Requirements**: SYNC-05 (stability)
**Success Criteria** (what must be TRUE):
  1. Effect-by-effect write handlers in `createAnnotationSyncPlugin` deleted (addAnnotation/removeAnnotation/updateThread/_updateActiveRevisionVersion/_addVersionToRevision/_deleteVersionFromRevision branches gone)
  2. Per-version subtree Y.Text bindings removed from `createNestedEditorState` and `NestedEditorController`
  3. `hasSubtreeForRevision` short-circuit deleted from `annotationField` Phase 3 — Phase 3 runs unconditionally again
  4. `_hasCollabSubtree` branching removed from `NestedEditorController` (single code path, no fork)
  5. `needsCollabModeRebuild` + associated `$effect` blocks removed from `Revision.svelte` and `RevisionModal.svelte`
  6. All tests coupled to the old sync-plugin design deleted (revision-lifecycle, version-coordination, go-live-mid-session, nested-editor-sync, version-switch-live, subtree-binding, any other directly-affected files)
  7. Typecheck passes, biome passes
  8. Integration test (non-Playwright) proves: two peers connected via the twoPeerHarness, main text edits on peer A character-wise appear on peer B
**Plans**: to be scoped in `/gsd-plan-phase 10`

### Phase 11: Unified Subtree Sync Rebuild
**Goal**: Single source of truth for annotation state in Yjs with per-character merge
inside revision versions. State is projected both ways via a single diff-and-write cycle
and a single observeDeep-driven rebuild — no effect-specific handlers.
**Depends on**: Phase 10
**Requirements**: SYNC-05 (functionality)
**Success Criteria** (what must be TRUE):
  1. Annotations Y.Map entries have shape that mirrors `GenericAnnotation` with per-version Y.Text children for revision bodies
  2. `createAnnotationSyncPlugin` writes to Y.Map via a single diff-and-reconcile function on every transaction (no per-effect branches)
  3. `observeDeep` drives a single rebuild path for remote changes — no partial updates
  4. Revision version text merges character-by-character between peers (two peers typing into the same version converge without loss)
  5. activeVersionIndex is a Y.Map field; switching on one peer visibly switches on the other
  6. Add version, delete version, thread append all round-trip between peers
  7. Integration tests (non-Playwright) cover: concurrent typing in same version, version switch propagation, add/delete version, thread append, joiner sees owner's pre-existing annotations on initial sync
**Plans**: to be scoped in `/gsd-plan-phase 11`

### Phase 12: Nested Editor Reunification
**Goal**: One code path for the nested editor regardless of collab state. Drop the
local/collab mode fork in `NestedEditorController` now that collab sync is correct.
**Depends on**: Phase 11
**Requirements**: SYNC-05 (maintainability)
**Success Criteria** (what must be TRUE):
  1. `NestedEditorController` has no `_hasCollabSubtree` flag, no mode branch, no dual-mode lifecycle
  2. Nested editor always uses the same extension set whether or not collab is active
  3. Version text flows via the same mechanism in both modes (Yjs binding on the version's Y.Text, which exists in both live and local contexts after the model unification)
  4. `needsCollabModeRebuild` and its `$effect` callers fully removed from `Revision.svelte` and `RevisionModal.svelte`
  5. Integration test (non-Playwright) proves the inline editor works identically with collab on vs off for: create revision, type in inline editor, switch version, add/delete version, undo/redo
**Plans**: to be scoped in `/gsd-plan-phase 12`

### Phase 13: Dogfooding Regression Suite
**Goal**: Lock in the rebuild with integration tests that would have caught the Phase 9
bugs. All run inside vitest — no Playwright. These are the tests Phase 9 should have had.
**Depends on**: Phase 12
**Requirements**: SYNC-05 (verification), dogfoodable quality bar
**Success Criteria** (what must be TRUE):
  1. Integration test: owner types inside a revision's nested editor → peer sees character-wise text updates, and vice versa
  2. Integration test: owner switches active version → peer's active version updates, peer's inline editor body updates to new version's text
  3. Integration test: two peers type concurrently into the same version (last-X chars on each side) → both converge to the merged result without data loss
  4. Integration test: joiner connects to an owner who already has revisions with multiple versions → joiner sees all of them correctly and can interact
  5. Integration test: owner deletes a version that is active on both peers → peer's active version falls back correctly, no dangling references
  6. Integration test: Cmd-z on joiner immediately after connect does not revert to pre-connect state
  7. Integration test: threading append from both peers concurrently → both messages survive (no lost write)
  8. Each test exercises the FULL stack end-to-end in vitest (parent view, nested editor controller, yjsBinding, annotation sync plugin, observeDeep reconciliation) without mocks or Playwright
**Plans**: to be scoped in `/gsd-plan-phase 13`

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 6.5 -> 7 -> 7.5 -> 8 -> 8.5a -> 8.5b -> 8.5c -> 9 -> 10 -> 11 -> 12 -> 13

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Data Model | 3/3 | Complete | - |
| 2. Auth Foundation | 2/2 | Complete | - |
| 3. Anonymous Auth | 1/1 | Complete | - |
| 4. Relay Core | 3/3 | Complete | - |
| 5. Relay Persistence | 3/3 | Complete | 2025-04-17 |
| 6. Client Collab | 3/3 | Complete | 2025-04-17 |
| 6.5. Collab Polish | 4/4 | Complete | 2025-04-17 |
| 7. Connection UX | 1/1 | Complete | 2026-04-19 |
| 7.5. Yjs Migration | 7/7 | Complete | - |
| 8. Annotation Sync | 6/6 | Complete | - |
| 8.5a. CRDT Data Shape | 2/2 | Complete | 2026-04-18 |
| 8.5b. CRDT Sync Plumbing | 2/2 | Complete | 2026-04-19 |
| 8.5c. CRDT Nested Editor Wiring | 2/2 | Complete | 2026-04-18 |
| 9. Fix Live Collab Revision Editing Bugs | 3/3 | Reopened | - |
| 10. Strip Broken Collab Sync Layer | 0/- | Planned | - |
| 11. Unified Subtree Sync Rebuild | 0/- | Planned | - |
| 12. Nested Editor Reunification | 0/- | Planned | - |
| 13. Dogfooding Regression Suite | 0/- | Planned | - |

---

## v2 Backlog

Ideas deferred from v1 that may become future phases.

| Item | Description | Deferred From |
|------|-------------|---------------|
| Shared Document Mode | Server as source of truth, owner-independent sessions (Google Docs model). Functionally equivalent to Live Room if owner stays online, but survives owner disconnect. Includes offline editing for all participants via Yjs persistence. | Phase 6 |
| Presence/Cursors | Online status, follow mode (PRES-01 through PRES-04). Note: live cursor positions already implemented in Phase 6.5. | v1 scope |
| Sharing UI | Share links, permissions, revoke access (SHAR-01 through SHAR-04) | v1 scope |

---
*Roadmap created: 2025-04-16*
*Granularity: fine (8-12 phases)*
*Coverage: 23/23 requirements mapped*
