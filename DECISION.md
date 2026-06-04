# Decisions Index

This file consolidates the live `D-*` decision markers still referenced in the active codebase.

## Notes

- Scope: `src/`, `tests/`, `supabase/`, and `ARCHITECTURE.md`.
- Excludes generated output, dependency folders, and `.worktrees/` copies.
- Decision IDs are phase-local, not globally unique. The same marker can mean different things in different planning phases, so entries are grouped by origin phase.
- This index also includes non-`D-*` decision references that still survive in comments, tests, or schema notes.

## Other Live References

### Named doc references

| Reference | Meaning in code | Live references |
| --- | --- | --- |
| `PATTERNS.md` | Seed data comment still points at an old planning artifact | `supabase/seed.sql:3` |
| `ROADMAP.md` | Test file still frames coverage in roadmap terms | `tests/lib/collab/annotation-sync.test.ts:4` |
| `CLAUDE.md` | E2E note still points at repo-level constraints | `tests/e2e/undoAutoNavigate.pw.ts:13` |
| `CONTEXT.md` | Mid-session role switch note still references context docs directly | `src/lib/collab/index.ts:366` |

### Unnumbered decision phrases

| Phrase | Meaning in practice | Live references |
| --- | --- | --- |
| `source of truth` | Owner/relay/subtree authority rules that are sometimes documented without a `D-*` tag | `src/lib/editor/listeners.ts:226`<br>`src/lib/collab/GoLiveButton.svelte:184`<br>`src/lib/editor/plugins/annotations/models.ts:99`<br>`src/lib/editor/plugins/annotations/nestedEditor.ts:8` |
| `Google Docs-style` | Cursor and annotation presentation decisions sometimes survive as prose rather than markers | `src/lib/collab/awareness.ts:6`<br>`src/lib/collab/awareness.ts:203`<br>`src/lib/editor/plugins/annotations/Annotations.svelte:346` |
| `append-only` | Thread/event shape decisions that are sometimes repeated without introducing a new marker | `src/lib/collab/annotationSchema.ts:5`<br>`src/lib/collab/types.ts:9`<br>`src/lib/collab/yjsAnnotations.ts:56`<br>`tests/lib/collab/thread-append.test.ts:2` |
| `recursive Y.Map` | Annotation tree shape decisions that are often referenced directly by data-shape prose | `src/lib/collab/annotationSchema.ts:46`<br>`src/lib/collab/annotationSchema.ts:112`<br>`src/lib/collab/types.ts:57`<br>`tests/lib/collab/annotationSchema.test.ts:55` |

## Phase 1 Data Model

| Marker | Decision | Live references |
| --- | --- | --- |
| D-01 | `users` table stores display names only (no avatars stored) | `supabase/migrations/20260422000001_initial_schema.sql:241` |
| D-02 | Avatars auto-generated from display name (client-side, e.g. initials or identicon) | `src/lib/auth/avatarUtils.ts:5` |
| D-04 | Anyone with the link can join (no granular permission levels for v1) | `supabase/migrations/20260422000001_initial_schema.sql:197` |
| D-05 | Owner can reset token (invalidates old link) or disable sharing entirely | `supabase/migrations/20260422000001_initial_schema.sql:189`<br>`supabase/migrations/20260422000001_initial_schema.sql:193` |
| D-08 | Each row = one version number assigned by relay | `supabase/migrations/20260422000001_initial_schema.sql:148` |

## Phase 1 Test Harness & Invariants

| Marker | Decision | Live references |
| --- | --- | --- |
| D-01 | `flushAll(...peers)` is variadic and is the only flush primitive used by two-peer convergence tests | `src/lib/collab/test-helpers/twoPeerHarness.ts:184` |
| D-02 | Convergence detection uses a state-vector equality loop with a max-iteration cap | `src/lib/collab/test-helpers/twoPeerHarness.ts:184` |
| D-03 | Reject fixed-tick or single-await flushing; use the explicit convergence loop instead | `src/lib/collab/test-helpers/twoPeerHarness.ts:184` |
| D-07 | Feedback-loop tests use single-character dispatches, not batched bursts | `tests/lib/collab/feedback-loop.test.ts:11` |
| D-08 | Feedback-loop coverage is a regression harness for the Phase 3 rewrite | `tests/lib/collab/feedback-loop.test.ts:13` |
| D-13 | If the convergence property test fails on current code, skip the failing case with a TODO for the fixing phase | `tests/lib/collab/convergence-projection.test.ts:12` |

## Phase 2 Auth Foundation

| Marker | Decision | Live references |
| --- | --- | --- |
| D-10 | Auth UI lives in the top-right area of the app | `src/lib/auth/AuthButton.svelte:4` |
| D-13 | Instant activation for prototype accounts; no email verification | `src/lib/auth/AuthModal.svelte:6` |
| D-14 | Session storage uses localStorage (`persistSession: true`) | `src/lib/auth/supabase.ts:24` |
| D-15 | Logged-out state uses a faint glassy "Sign In" button | `src/lib/auth/AuthButton.svelte:5`<br>`src/lib/auth/AuthButton.svelte:79` |
| D-15b | Logged-in state uses a display-name-derived avatar plus dropdown menu | `src/lib/auth/AuthButton.svelte:6`<br>`src/lib/auth/AuthButton.svelte:57` |
| D-16 | Display name is collected during sign-up | `src/lib/auth/AuthModal.svelte:5`<br>`src/lib/auth/auth.svelte.ts:57` |
| D-17 | Auth modal is minimal, with tabs to switch between login and signup | `src/lib/auth/AuthModal.svelte:4` |

## Phase 3 Anonymous Auth

| Marker | Decision | Live references |
| --- | --- | --- |
| D-20 | Anonymous users choose a display name before joining | `src/lib/auth/auth.svelte.ts:88` |
| D-22 | No account required; just lightweight name entry | `src/lib/auth/NameEntryModal.svelte:4` |
| D-23 | Anonymous auth only triggers when joining a shared document | `src/lib/auth/NameEntryModal.svelte:5` |
| D-24 | Anonymous sessions persist in localStorage across restarts | `src/lib/auth/auth.svelte.ts:89` |
| D-26 | Anonymous users can sign in while viewing a shared doc | `src/lib/auth/NameEntryModal.svelte:6`<br>`src/lib/auth/NameEntryModal.svelte:163` |

## Phase 5 Relay Persistence

| Marker | Decision | Live references |
| --- | --- | --- |
| D-41 | Periodic snapshots are stored so state can be reconstructed quickly on reload | `supabase/migrations/20260422000001_initial_schema.sql:108` |

## Phase 6 Client Collab

| Marker | Decision | Live references |
| --- | --- | --- |
| D-50 | Per-user undo via author-tagged changes / client identity | `src/lib/collab/GoLiveButton.svelte:246`<br>`src/lib/collab/collabPlugin.ts:9`<br>`src/lib/collab/collabPlugin.ts:126`<br>`src/lib/collab/yjsUndo.ts:5`<br>`src/lib/collab/yjsUndo.ts:28`<br>`tests/lib/collab/yjsUndo.test.ts:5` |
| D-51 | Collab extension stays in the stack and is enabled/disabled via a Compartment | `src/lib/collab/collabPlugin.ts:8`<br>`src/lib/collab/collabPlugin.ts:23`<br>`src/lib/collab/index.ts:83`<br>`src/lib/editor/extensions.ts:143` |
| D-52 | Socket lifecycle is per-document and tied to the collab session | `src/lib/collab/socket.ts:7` |
| D-53 | JWT from `getSession().access_token` is passed in the auth handshake | `src/lib/collab/socket.ts:8`<br>`src/lib/collab/socket.ts:35` |
| D-55 | Owner local SQLite is the source of truth; relay is the broadcast / active-session recovery layer | `src/lib/collab/index.ts:167`<br>`src/lib/collab/index.ts:173` |
| D-56 | "Go Live" toggle sits near auth controls in the top-right area | `src/lib/collab/GoLiveButton.svelte:4` |
| D-57 | Live Room mode only; the session ends when the owner leaves | `src/lib/collab/GoLiveButton.svelte:5`<br>`src/lib/collab/index.ts:168`<br>`src/lib/collab/yjsProvider.ts:5` |
| D-58 | Take a snapshot before pulling remote state | `src/lib/collab/GoLiveButton.svelte:6`<br>`src/lib/collab/GoLiveButton.svelte:226`<br>`src/lib/collab/GoLiveButton.svelte:239` |
| D-59 | Owners manually toggle collab for their own docs; joiners auto-connect | `src/lib/collab/GoLiveButton.svelte:7` |

## Phase 6.5 Collab Polish

| Marker | Decision | Live references |
| --- | --- | --- |
| D-60 | Remote cursors use a Google Docs-style colored caret with name label | `src/lib/collab/awareness.ts:6`<br>`src/lib/collab/awareness.ts:92`<br>`src/lib/collab/awareness.ts:203`<br>`tests/lib/collab/awareness.test.ts:7` |
| D-61 | Collaborators are kicked immediately when the owner disconnects; no warning-first flow | `src/lib/collab/yjsProvider.ts:6`<br>`src/lib/collab/yjsProvider.ts:208` |

## Phase 7 Connection UX

| Marker | Decision | Live references |
| --- | --- | --- |
| D-104 | On reconnection failure, set `collabState` to `error` | `src/lib/collab/yjsProvider.ts:144` |
| D-105 | Do not silently fall back to local-only mode; require manual re-entry to Go Live | `src/lib/collab/yjsProvider.ts:146` |

## Phase 7.5 Yjs Migration

| Marker | Decision | Live references |
| --- | --- | --- |
| D-70 | Clean migration to Yjs with OT removed entirely | `src/lib/collab/GoLiveButton.svelte:8`<br>`src/lib/collab/index.ts:9`<br>`src/lib/collab/index.ts:121`<br>`src/lib/collab/types.ts:6` |
| D-71 | Relay becomes y-websocket with custom auth integration | `src/lib/collab/yjsProvider.ts:4`<br>`src/lib/collab/yjsProvider.ts:93` |
| D-72 | Use a custom Yjs-CodeMirror binding and awareness-based cursor sync | `src/lib/collab/awareness.ts:5`<br>`src/lib/collab/awareness.ts:202`<br>`src/lib/collab/index.ts:10`<br>`src/lib/collab/index.ts:122`<br>`src/lib/collab/types.ts:7`<br>`src/lib/collab/yjsBinding.ts:4`<br>`tests/lib/collab/awareness.test.ts:6` |
| D-74 | UndoManager tracks only local-origin changes for per-user undo | `src/lib/collab/index.ts:123`<br>`src/lib/collab/yjsBinding.ts:11`<br>`src/lib/collab/yjsBinding.ts:131`<br>`src/lib/collab/yjsUndo.ts:4`<br>`src/lib/collab/yjsUndo.ts:27`<br>`src/lib/collab/yjsUndo.ts:46`<br>`tests/lib/collab/undo-manager.test.ts:176`<br>`tests/lib/collab/yjsBinding.test.ts:5`<br>`tests/lib/collab/yjsUndo.test.ts:4` |

## Phase 8 Annotation Sync

| Marker | Decision | Live references |
| --- | --- | --- |
| D-83 | Use a single unified undo stack for text plus annotations | `ARCHITECTURE.md:1799`<br>`src/lib/collab/index.ts:229`<br>`src/lib/collab/yjsUndo.ts:29`<br>`src/lib/collab/yjsUndo.ts:32`<br>`src/lib/collab/yjsUndo.ts:42`<br>`tests/lib/collab/yjsUndo.test.ts:214` |

## Phase 8.5 CRDT Subtrees For Nested Editors

| Marker | Decision | Live references |
| --- | --- | --- |
| D-90 | Annotations become recursive `Y.Map` nodes with Yjs children | `src/lib/collab/annotationSchema.ts:4`<br>`src/lib/collab/types.ts:8`<br>`src/lib/collab/yjsAnnotations.ts:53`<br>`tests/lib/collab/annotation-tree.test.ts:2`<br>`tests/lib/collab/annotationSchema.test.ts:4`<br>`tests/lib/collab/types.test.ts:4`<br>`tests/lib/collab/yjsAnnotations.test.ts:7` |
| D-92 | Nested annotations reuse the same recursive shape at arbitrary depth | `src/lib/collab/annotationSchema.ts:4`<br>`src/lib/collab/types.ts:8`<br>`src/lib/collab/yjsAnnotations.ts:53`<br>`tests/lib/collab/annotation-tree.test.ts:2`<br>`tests/lib/collab/annotationSchema.test.ts:4`<br>`tests/lib/collab/types.test.ts:4`<br>`tests/lib/collab/yjsAnnotations.test.ts:7` |
| D-93 | Comment threads are append-only `Y.Array<MessageObject>` values | `src/lib/collab/annotationSchema.ts:5`<br>`src/lib/collab/types.ts:9`<br>`src/lib/collab/types.ts:36`<br>`src/lib/collab/yjsAnnotations.ts:56`<br>`tests/lib/collab/thread-append.test.ts:2`<br>`tests/lib/collab/thread-append.test.ts:211`<br>`tests/lib/collab/yjsAnnotations.test.ts:479` |
| D-94 | No migration or backwards-compat path for the old Phase 8 wire format | `src/lib/collab/annotationSchema.ts:6`<br>`src/lib/collab/yjsAnnotations.ts:58` |
| D-96 | Undo should auto-navigate to a non-focused nested editor when that is where the change lands | `tests/e2e/undoAutoNavigate.pw.ts:2` |
| D-97 | New subtree `Y.Text` instances are added to the UndoManager tracked scope | `src/lib/collab/yjsUndo.ts:125` |

## Phase 9 Fix Live Collab Revision Editing Bugs

| Marker | Decision | Live references |
| --- | --- | --- |
| D-100 | Joiner collab happens in a separate ephemeral room-backed view, not by mutating a local document | `src/lib/collab/GoLiveButton.svelte:164`<br>`src/lib/collab/GoLiveButton.svelte:172`<br>`src/lib/editor/listeners.ts:224` |
| D-103 | Restore the prior view on leave, kick, exhausted reconnects, or app-close during a live session | `src/lib/collab/GoLiveButton.svelte:222`<br>`src/lib/collab/index.ts:55`<br>`src/lib/collab/index.ts:283`<br>`src/lib/collab/index.ts:355`<br>`src/lib/collab/index.ts:376`<br>`src/lib/collab/store.ts:56` |
