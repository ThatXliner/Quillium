# Milestones

## v1.0 Omni MVP (Shipped: 2026-04-19)

**Phases completed:** 15 phases, 49 plans, 43 tasks

**Key accomplishments:**

- sync_documents table with owner FK and collab_updates table with version-ordered OT updates for @codemirror/collab
- Supabase client singleton with localStorage session persistence and Svelte 5 runes-based reactive auth store
- 1. [Rule 1 - Bug] Fixed Zod 4 API compatibility
- 1. [Rule 1 - Bug] Fixed TypeScript error in supabase.ts
- 1. [Rule 1 - Bug] Fixed rebaseUpdates readonly return type
- WebSocket client singleton with JWT auth for relay connection, protocol types mirroring relay, and per-document socket lifecycle
- Real-time collab push/pull loop using @codemirror/collab with per-user undo via clientID tagging
- Core toggle functionality (per plan):
- Reason:
- Client-side remote cursor module with StateField, ViewPlugin, WidgetType, CSS theme, and throttled emit plugin (D-60)
- store.ts
- Per-user undo via Y.UndoManager with local-only tracking, and awareness-based cursor sync with Google Docs-style widgets
- WebsocketProvider wrapper connecting to Yjs relay with JWT auth and Svelte store integration
- 1. [Rule 1 - Bug] Fixed WebSocket type mismatches
- Wired up Yjs collab in index.ts and updated GoLiveButton for Yjs-based collaboration
- YjsAnnotation type, RelativePosition utilities, and bidirectional CM<->Yjs annotation converters with Zod validation and try-catch JSON safety
- createYjsUndoExtension extended to accept optional Y.Map for unified per-user undo of text and annotations (D-83)
- Bidirectional Y.Map <-> annotationField ViewPlugin with origin tracking for feedback loop prevention, covering all three annotation types (comment, suggestion, revision)
- 1. [Rule 2 - Security] T-08-05/T-08-06 bounds checking in annotationSchema.ts
- One-liner:
- Two-client convergence test suite (10 tests) verifying annotation sync across basic sync, concurrent ops, thread sync, position tracking, and revision sync
- 1. [Rule 3 - Blocking Issue] Fixed test file importing deleted function
- Deleted files verified as non-existent:
- 1. [Rule 1 - Bug] Fixed additional write path test file
- 1. [Rule 1 - Bug] Fixed concurrent edit test assertion

---
