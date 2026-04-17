# Architecture

**Analysis Date:** 2026-04-16

## Pattern Overview

**Overall:** Hybrid reactive architecture combining SvelteKit frontend with CodeMirror 6 state management and Tauri desktop runtime.

**Key Characteristics:**
- Dual state worlds: CodeMirror (immutable, transaction-based) and Svelte stores (reactive, manually synced)
- Annotation-driven non-linear editing model (comments, suggestions, revisions)
- Nested editors as full EditorView instances with parent-relative coordinate mapping
- Event-sourced persistence with SQLite append-only event log + periodic snapshots
- Plugin-based extension system with ViewPlugins for decoration and behavior injection

---

## Layers

**UI / Component Layer:**
- Purpose: Svelte component tree rendering pages, modals, sidebars, and editor UI
- Location: `src/lib/` (Svelte components) and `src/routes/` (page-level routes)
- Contains: `.svelte` files organized by feature (editor, ai, library, annotations, etc.)
- Depends on: Svelte stores, CodeMirror view, Tauri commands
- Used by: Browser DOM, user interactions

**CodeMirror State Layer:**
- Purpose: Immutable transaction-based editor state, extensions, plugins
- Location: `src/lib/editor/` (Editor.svelte, extensions.ts, plugins/)
- Contains: StateFields, ViewPlugins, keymaps, transaction builders
- Depends on: CodeMirror 6 (npm), annotation field state, nested editor controllers
- Used by: updateListener, transaction dispatchers, view plugins

**Annotation System:**
- Purpose: Non-linear editing model with comments, suggestions, revisions
- Location: `src/lib/editor/plugins/annotations/`
- Contains: annotationField.ts (StateField), models.ts (types), UI components
- Depends on: CodeMirror state, undo/redo history, event bus
- Used by: Editor, nested editors, annotation cards, AI features

**Persistence / Database Layer:**
- Purpose: SQLite-based crash-safe storage of document state and events
- Location: `src-tauri/src/db/` (Rust), `src/lib/db/` (TypeScript wrappers)
- Contains: Event log, snapshots, document metadata, migrations
- Depends on: Tauri invoke(), SQLite (WAL mode), schema versioning
- Used by: listeners.ts, load flow, version history browser

**AI / Integration Layer:**
- Purpose: Streaming AI requests, provider abstraction, annotation creation
- Location: `src/lib/ai/` (Chat.svelte, Feedback.svelte, chatFactory.ts, etc.)
- Contains: Provider client setup, multi-persona execution, streaming handlers
- Depends on: Universal AI SDK, CodeMirror state, annotation factory functions
- Used by: User interaction, AutoAI engine, comment suggestion threads

**Desktop / Native Layer:**
- Purpose: File I/O, native menu, keyboard shortcuts, OS integration
- Location: `src-tauri/src/` (Rust backend), Tauri bridging in frontend
- Contains: Tauri commands (invoke wrappers), menu registration, keychain
- Depends on: Tauri API, Rust crates (rusqlite, keyring)
- Used by: Frontend via `invoke()` calls, system events

---

## Data Flow

**Document Load Flow:**

1. User opens editor or navigates to `/` with document ID
2. `Editor.svelte` calls `loadDocumentState(docId, draftId)` (Rust Tauri command)
3. Rust loads most-recent snapshot + events since that snapshot ID
4. TypeScript calls `EditorState.fromJSON(snapshotJson)` to restore snapshot
5. `replayEvents()` applies event log entries in order, rebuilding editor state
6. `EditorView` is created with the reconstructed state
7. Svelte stores are manually synced via `updateListener` callback

**Edit Flow (user types):**

1. User types or selects text
2. CodeMirror processes change, transaction created
3. `annotationField.update()` phase 1: remap annotation selections through text changes
4. Phase 2: apply StateEffects (add/remove/update annotations)
5. Phase 3: push document text into revision version states
6. `updateListener` fires, pushes changes to Svelte stores (`$annotations`, `$documentContent`)
7. UI components update reactively
8. `listeners.ts` extracts event payload, calls `appendEvent()` (Tauri command)
9. Event is written to SQLite atomically; returns whether snapshot is needed
10. If `needsSnapshot`, calls `createSnapshot()` with serialized `state.toJSON()`

**Annotation Creation Flow (from UI):**

1. User selects text + Mod-Alt-M (comment) or Mod-Alt-K (revision)
2. Keymap handler calls `createCommentCommand()`/`createRevisionCommand()`
3. Command creates `addAnnotation` StateEffect with new annotation object
4. Transaction dispatched with effect to `editorView`
5. `annotationField` Phase 2 inserts annotation into map
6. `updateListener` detects change, dispatches `updateListener` callback
7. Svelte store `$annotations` updates, triggering component re-renders
8. Comment card (PreComment.svelte) or Revision card renders
9. User submits/confirms, triggering `updateThread` or version edit

**Nested Editor Edit Flow:**

1. User types in nested (revision) editor
2. Nested editor's `updateListener` fires
3. Calls `translateAndDispatch(update, parentView, revisionId)`
4. Translates change positions to parent coordinates (adds revision.selection.main.from offset)
5. Dispatches to parent with `nestedEditorEdit.of(revisionId)` annotation
6. Parent `annotationField` Phase 1: revision selection remapped (no change if edit is inside)
7. Parent Phase 3: `pushDocToVersionState` reads revision range text, updates `versions[activeVersionIndex].doc`
8. Parent `updateListener` fires, syncs parent stores
9. Nested editor's sync `$effect` detects `activeVersion.doc` changed, patches buffer
10. Parent doc is persisted; nested changes bubble up to root via chain of `translateAndDispatch` calls

**Modal Stack Interaction:**

1. User clicks on an annotation or annotation card
2. Component calls `modalStack.push({ type: "revision", revisionId, parentView, ... })`
3. `+page.svelte` re-renders, creates new `RevisionModal` entry
4. Modal opens, creates nested `EditorView` with `NestedEditorController`
5. Controller sets up parent sync effect watching parent's annotation state
6. If user edits nested annotation, event bus emits `"nested-annotation-create"`
7. Revision.svelte sidebar listens, creates sub-modal via `modalStack.push()` with parent `view` = modal's editor
8. Modal stack grows; breadcrumbs chain all the way down
9. On close, `modalStack.pop()` removes entry; FSM transitions to cleanup

**State Management Sync (the critical mental model):**

```
CodeMirror State (immutable transactions)
    ├── historyField
    ├── annotationField
    └── document text
         │
         └─► updateListener callback
             ├─► $annotations = newAnnotations (Svelte store)
             ├─► $documentContent = newText
             ├─► $selectedText = editorView.state.sliceDoc(...)
             ├─► $activeAnnotation = getActiveAnnotation()
             └─► listeners.ts extracts + persists to SQLite
```

The key invariant: Svelte stores are **reactive mirrors** that must stay in sync with CodeMirror state. They are not derived (would duplicate update logic). They are not automatic (CodeMirror state is immutable; updates must be pushed explicitly). The `updateListener` is the **single point** where both worlds meet.

**State Management:** CodeMirror owns all editor state (text, selections, undo/redo, annotations). Svelte stores mirror subsets of that state for reactive component updates. UI-only state (modal stack, panel visibility, AI sidebar mode) lives exclusively in Svelte stores. Never mutate CodeMirror state from Svelte components—always dispatch transactions.

---

## Key Abstractions

**EditorView + CodeMirror Extensions:**
- Purpose: DOM-mounted editor instance with plugin system
- Examples: `src/lib/editor/extensions.ts` (main extension stack), `src/lib/editor/Editor.svelte` (mount point)
- Pattern: Extensions registered via `StateField` (data), `ViewPlugin` (behavior), facet providers, keymaps. Each extension can react to `update` events (transaction + state change). `updateListener` is a top-level plugin that syncs to Svelte stores.

**Annotation Types & State Field:**
- Purpose: Unified data model for comments, suggestions, revisions; persisted state management
- Examples: `src/lib/editor/plugins/annotations/annotationField.ts`, `src/lib/editor/plugins/annotations/models.ts`
- Pattern: `annotationField` is a `StateField<Annotations>` that holds the map `{ id: annotation }`. Every CodeMirror transaction triggers its `update()` function in three deterministic phases: (1) remap selection ranges, (2) apply StateEffects, (3) push doc text to active revision versions. Undo/redo is handled by `invertedAnnotationFieldEffects` which generates reverse effects for each mutation.

**Nested Editor Controller:**
- Purpose: Encapsulate lifecycle and sync for inline and modal revision editors
- Examples: `src/lib/editor/plugins/annotations/NestedEditorController.ts`, used by `Revision.svelte` and `RevisionModal.svelte`
- Pattern: Constructor creates an `EditorView` from a `VersionState` blob. `syncFromParent(doc)` patches the buffer when parent changes. `updateListener` calls `translateAndDispatch(parentView, revisionId)` to map nested edits back to parent. `needsVersionSwitch()` and `needsAnnotationRebuild()` signal when to destroy and recreate. Flush behavior configurable: `"flush"` (modal saves state to parent on destroy) vs `"no-flush"` (parent is source of truth via Phase 3).

**Modal Stack:**
- Purpose: Manage nested modal overlays for revisions, diffs, comments; track parent-child relationships
- Examples: `src/lib/stores.ts` (`modalStack` store), `src/routes/+page.svelte` (`{#each $modalStack}`), `RevisionModal.svelte`
- Pattern: Stack of entries with `type` (revision/diff/comment), `parentView` (EditorView instance), and stack index. Breadcrumbs derived from `$modalStack.slice(0, stackIndex + 1)`. Deeply nested modals read from `$modalAnnotationStores[stackIndex - 1]` instead of `$annotationsStore` to avoid ID collisions. FSM in `RevisionModal` manages mount/tick/rebuild/ready states.

**Annotation Event Bus:**
- Purpose: Typed pub/sub decoupling ViewPlugins and commands from component reactions
- Examples: `src/lib/editor/plugins/annotations/eventBus.ts`, consumed by `Revision.svelte`, `RevisionModal.svelte`
- Pattern: Each event type (e.g., `"revision-boundary-nudge"`, `"nested-annotation-create"`) has subscribers. ViewPlugins emit when user interacts; components subscribe in `$effect` blocks, returning unsubscribe cleanup. No deduplication tokens needed—direct handler dispatch.

**Stores (State Management):**
- Purpose: Reactive UI state and CodeMirror state mirrors
- Examples: `src/lib/stores.ts` (global), `src/lib/editor/plugins/annotations/index.ts` (annotation-specific)
- Pattern: Writable stores (`editorView`, `annotations`, `documentContent`, `modalStack`, etc.) are manually updated by `updateListener` or explicit dispatches. Derived stores recalculate from dependencies (e.g., `activeAnnotation` derived from `annotations` and `editorView.state.selection`). Components consume via `$store` syntax.

**Persistence: Event Log + Snapshots:**
- Purpose: Crash-safe, append-only record of changes with periodic snapshots
- Examples: `src/lib/db/index.ts` (TypeScript), `src-tauri/src/db/` (Rust)
- Pattern: Every significant change (`docChanged` or annotation mutation) extracts an event payload, appends to SQLite `events` table atomically, returns `needsSnapshot` flag. Snapshots created when ≥50 events accumulated or ≥120 seconds elapsed. Load flow: fetch latest snapshot + events since, restore snapshot, replay events. Undo/redo handled entirely by CodeMirror history; changes are re-recorded as events.

**AI Provider Abstraction:**
- Purpose: Provider-agnostic streaming and tool-call handling
- Examples: `src/lib/ai/provider.ts` (client setup), `src/lib/ai/chatFactory.ts` (request builders), `src/lib/ai/clientStreams.ts` (stream handlers)
- Pattern: `createModel()` wraps the selected provider (OpenAI, Anthropic, etc.) and exposes a unified interface. `streamChat()`, `streamFeedback()`, `streamRevise()` are mode-specific stream builders that inject system prompts and context. Tool handlers (`createComment`, `createSuggestion`, `createRevision`) dispatch annotation factory functions directly to CodeMirror.

---

## Entry Points

**Editor Route (`/`):**
- Location: `src/routes/+page.svelte`
- Triggers: App startup, navigation via `goToEditor()`, link clicks
- Responsibilities: Mount Editor.svelte with document ID, render three-panel layout (AI sidebar | editor | annotations), manage modal stack rendering, dispatch native menu events (`menu:settings`, `menu:library`, `menu:history`), listen for custom DOM events (`quillium:manual-review`, `quillium:show-changelog`), render error/update banners

**Library Route (`/library`):**
- Location: `src/routes/library/+page.svelte`
- Triggers: Navigation via `goToLibrary()` or native menu
- Responsibilities: Fetch document list from Rust, render grid of cards, implement search, trash/restore/delete operations, handle document creation and renaming, show preview panel sidebar

**History Route (`/history`):**
- Location: `src/routes/history/+page.svelte`
- Triggers: Navigation via `goToHistory()` or native menu
- Responsibilities: Thin wrapper that renders VersionHistory.svelte full-screen; handles bootstrap of draft ID if missing

**Editor Component (`Editor.svelte`):**
- Location: `src/lib/editor/Editor.svelte`
- Triggers: When `+page.svelte` mounts and document ID is available
- Responsibilities: Load document state via `loadDocumentState()`, create EditorView, mount CodeMirror DOM, set up `updateListener`, subscribe to `documentContent` changes for AI sidebar, manage nested editor mounting/unmounting, handle manual review and AutoAI

**AI Sidebar (`AISidebar.svelte`):**
- Location: `src/lib/ai/AISidebar.svelte`
- Triggers: Rendered by `+page.svelte` side panel
- Responsibilities: Render tab picker (Chat / Feedback / Revise / Context / Readers / Settings), route to corresponding sub-component, manage API key checking, dispatch `quillium:open-ai-settings` on key error

**AutoAI Engine:**
- Location: `src/lib/autoai/engine.ts`
- Triggers: `startAutoAI()` called from `+page.svelte` on mount
- Responsibilities: Subscribe to `documentContent` store, debounce changes, trigger AI review, dispatch annotation creation commands, manage face state (thinking/reviewing/sleeping)

---

## Error Handling

**Strategy:** Layered error capture and recovery.

**Patterns:**

1. **Crash Detection** (`hooks.client.ts`):
   - Global `window.addEventListener("error", ...)` catches uncaught errors
   - Global `window.addEventListener("unhandledrejection", ...)` catches unhandled promise rejections
   - SvelteKit `handleError` route handler catches route-level errors
   - All three trigger `saveEmergencyBackup(reason)` → writes text to `localStorage("quillium_backup_crash")`

2. **Suspicious Change Detection** (`errorGuard.ts`):
   - `isSuspiciousDeletion(oldText, newText)` runs **before** persistence in `listeners.ts`
   - If single transaction deletes ≥20% of doc AND ≥100 characters, creates named snapshot ("Before large deletion (auto)")
   - Error banner (amber, AlertTriangle) directs user to `/history` to restore

3. **Crash Recovery** (`restore.ts`):
   - On app load, check `localStorage("quillium_backup_crash")`
   - If exists, show red error banner with "Restore previous", "Save copy", "Reload app"
   - `restoreBackup(view, documentText)` replaces full doc, re-anchors annotations via SearchCursor (text matching in restored doc)
   - Restore transaction tagged `userEvent: "input.restore"` so suspicious-change detector skips it

4. **Nested Editor Error Boundaries**:
   - Modal's FSM guards against "dispatch inside update" via `queueMicrotask` defers
   - Stale-state guard checks `update.view.state !== update.state` before dispatching cleanup

5. **Event Log Replay Errors** (`replay.ts`):
   - Each event wrapped in try-catch; failed event captured as PostHog event
   - If any failures, final completion event has `success: false` + count
   - App continues with best-effort state (not fatal)

---

## Cross-Cutting Concerns

**Logging:** `console.log` / `console.error` in development. PostHog exception capture via `window.addEventListener("error", ...)` in production. No structured logging library.

**Validation:** 
- CodeMirror state validity checked implicitly via transaction application (invalid changes rejected by CM)
- Annotation field ranges validated via `cleanRangesOf()` helper (collapses zero-width ranges)
- Event log replay wraps each event in try-catch; events that fail to apply are logged as PostHog events
- Type guards throughout: `isAnnotationOfType(annotation, "revision")` never `_type ===`

**Authentication:** 
- AI provider API keys stored in OS keychain via Tauri `src-tauri/src/keychain.rs`
- Keys retrieved on demand, not cached in memory
- Missing/invalid keys caught on first AI request; banner prompts user to configure

**Authorization:** 
- No multi-user or access control (single-user desktop app)
- Document soft-delete only (trash with retention policy)
- All operations available to any code path (no permission checks)

---

## Key File Locations

| File Path | Purpose |
|-----------|---------|
| `src/routes/+page.svelte` | Main editor page layout and modal rendering |
| `src/lib/editor/Editor.svelte` | CodeMirror mount point and state sync |
| `src/lib/editor/extensions.ts` | Complete extension stack (history, annotations, keymaps) |
| `src/lib/editor/listeners.ts` | updateListener + event extraction for persistence |
| `src/lib/editor/plugins/annotations/annotationField.ts` | StateField with 3-phase update logic and undo inversion |
| `src/lib/editor/plugins/annotations/models.ts` | Type defs, factory helpers, type guards |
| `src/lib/editor/plugins/annotations/NestedEditorController.ts` | Nested editor lifecycle and parent sync |
| `src/lib/editor/plugins/annotations/index.ts` | ViewPlugins (decorations, collapsed resolver, nudge), keymaps |
| `src/lib/editor/plugins/annotations/eventBus.ts` | Typed pub/sub for ViewPlugin → component events |
| `src/lib/stores.ts` | Global Svelte stores (annotations, documentContent, modalStack, etc.) |
| `src/lib/db/index.ts` | TypeScript Tauri invoke() wrappers for all DB commands |
| `src-tauri/src/db/mod.rs` | DB module exports and shared types |
| `src-tauri/src/db/schema.rs` | SQLite schema, migrations, WAL mode setup |
| `src-tauri/src/db/events.rs` | Event log append, snapshot thresholds |
| `src-tauri/src/db/load.rs` | State reconstruction from snapshot + event replay |
| `src/lib/ai/chatFactory.ts` | Multi-persona execution, request building, tool dispatch |
| `src/lib/autoai/engine.ts` | AutoAI review orchestration and annotation dispatch |
| `src/lib/editor/replay.ts` | Event log replay with error handling |
| `src/lib/errorGuard.ts` | Suspicious deletion detection before persistence |

---

*Architecture analysis: 2026-04-16*
