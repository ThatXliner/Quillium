# Architecture Overview

Quillium is built as a modern web application using SvelteKit, packaged as a cross-platform desktop app via Tauri. The architecture is dominated by the complexity of the annotation and revision system — understanding how CodeMirror state, Svelte stores, and nested editors interact is the main onboarding challenge for new contributors.

---

## Core Technologies

| Layer | Technology | Why |
|---|---|---|
| Frontend framework | SvelteKit + TypeScript | Reactivity, SSG mode for Tauri |
| Editor engine | CodeMirror 6 | Full state management, extensible plugins |
| Desktop runtime | Tauri (Rust) | Cross-platform packaging, native file I/O |
| Styling | Tailwind CSS v4 | Utility-first, co-located styles |
| State management | CodeMirror StateFields + Svelte stores | Hybrid: editor state lives in CM, UI state in Svelte |
| AI integration | Universal AI SDK | Provider-agnostic, streaming |
| Linting/formatting | Biome | 4-space indent, 100-char line width |

---

## Application Layout

The UI is a three-panel layout rendered by `src/routes/+page.svelte`:

```
                                        ┌─────────────────────┐
                                        │ GoLive │ AuthButton │  ← Top-right cluster
                                        └─────────────────────┘
┌──────────────┬──────────────────────┬──────────────────┐
│  AI Sidebar  │       Editor         │   Annotations    │
│              │                      │                  │
│  Chat        │  CodeMirror 6        │  Comment cards   │
│  Feedback    │  (816px fixed width) │  Revision cards  │
│  Revise      │  Status bar          │  Suggestion cards│
└──────────────┴──────────────────────┴──────────────────┘
                        ┌─────┐
                        │AutoAI│  ← Bottom-left bubble
                        └─────┘
```

The top-right cluster contains:
- `GoLiveButton` — collab toggle ("Go Live" / "Live"), copy ID, join by ID menu
- `AuthButton` — sign in button (logged out) or avatar dropdown (logged in)

Modal overlays (revision editors, diff views) are rendered on top via `modalStack` — a stack of `<RevisionModal>` and `<DiffModal>` instances managed by `src/lib/stores.ts`.

---

## File Structure

```
src/
├── hooks.client.ts            # Global error handlers, crash backup, PostHog exception capture
├── lib/
│   ├── ai/
│   │   ├── AISidebar.svelte   # Tab picker (Chat / Feedback / Revise / Context / Readers / Settings)
│   │   ├── AISettings.svelte  # Provider/model configuration
│   │   ├── Chat.svelte        # General AI chat
│   │   ├── DocumentContext.svelte # Context reference display
│   │   ├── Feedback.svelte    # AI feedback on document or selection (routes through persona streams)
│   │   ├── Readers.svelte     # Reader persona configuration panel
│   │   ├── Revise.svelte      # AI-powered revision generation
│   │   ├── chatFactory.ts     # Shared AI request/streaming helpers
│   │   ├── clientStreams.ts    # Streaming response handling
│   │   ├── provider.ts        # Provider-agnostic client setup
│   │   ├── settings.svelte.ts # AI settings (reactive, persisted)
│   │   └── utils.ts           # Shared AI utilities
│   ├── auth/
│   │   ├── AuthButton.svelte    # Top-right auth button (sign in / avatar dropdown)
│   │   ├── AuthModal.svelte     # Sign in / sign up modal
│   │   ├── AvatarDropdown.svelte # Dropdown menu for logged-in user
│   │   ├── NameEntryModal.svelte # Anonymous user display name prompt
│   │   ├── auth.svelte.ts       # Reactive auth state store (Svelte 5 $state runes)
│   │   ├── avatarUtils.ts       # initials() and avatarColor() helpers
│   │   ├── schemas.ts           # Zod schemas for auth forms
│   │   ├── supabase.ts          # Supabase client singleton
│   │   └── index.ts             # Re-exports for public API
│   ├── autoai/
│   │   ├── AutoAIFace.svelte         # Animated face SVG component (purely presentational)
│   │   ├── AutoAIWidget.svelte       # Bubble + expanded panel UI, face state machine
│   │   ├── faceAnimation.svelte.ts   # Eye tracking + sleep/wake state (extracted from widget)
│   │   ├── engine.ts            # Review orchestration, AI calls, annotation application
│   │   └── settings.svelte.ts   # AutoAI settings store (reactive, persisted)
│   ├── collab/
│   │   ├── GoLiveButton.svelte    # Top-right collab toggle + join-by-ID menu
│   │   ├── annotationSchema.ts    # CM ↔ Yjs bidirectional converters for annotations
│   │   ├── awareness.ts           # Yjs awareness protocol for cursor/presence sync
│   │   ├── index.ts               # Public API: enableCollab, disableCollab, etc.
│   │   ├── relativePosition.ts    # RelativePosition utilities for cursor anchoring
│   │   ├── store.ts               # Svelte stores: collabState, ownerLeftSignal, etc.
│   │   ├── types.ts               # CollabSession, YjsAnnotationNode, awareness types
│   │   ├── yjsAnnotations.ts      # Y.Map-based annotation sync ViewPlugin
│   │   ├── yjsBinding.ts          # CodeMirror ↔ Y.Text binding (custom, not y-codemirror.next)
│   │   ├── yjsProvider.ts         # Y.Doc + WebsocketProvider setup with JWT auth
│   │   ├── yjsUndo.ts             # Unified undo stack via Y.UndoManager
│   │   └── test-helpers/
│   │       └── twoPeerHarness.ts  # Two-peer test harness for convergence tests
│   ├── db/
│   │   ├── index.ts           # Typed invoke() wrappers for all Rust DB commands
│   │   ├── types.ts           # TypeScript mirrors of Rust structs (DocumentMeta, DraftMeta, etc.)
│   │   └── events.ts          # Event payload types and builders
│   ├── debug/
│   │   ├── DebugPanel.svelte  # Development-only debug overlay
│   │   ├── scenarios.ts       # Canned test scenarios for debug panel
│   │   └── store.svelte.ts    # Debug panel visibility state
│   ├── editor/
│   │   ├── Editor.svelte      # CodeMirror mount point + state sync
│   │   ├── extensions.ts      # Full CodeMirror extension stack
│   │   ├── listeners.ts       # Persistence + change listeners
│   │   ├── replay.ts          # Event log replay for state reconstruction
│   │   ├── restore.ts         # Crash-recovery restore with annotation re-anchoring
│   │   ├── dictionaryPlugin.ts # Mod-B keymap for dictionary popover trigger
│   │   ├── dictionaryUtils.ts # Pure helper functions for dictionary (extracted for testing)
│   │   ├── DictionaryPopover.svelte # Floating dictionary/thesaurus UI
│   │   ├── StatusBar.svelte   # Word count, WPM, character count
│   │   ├── VersionHistory.svelte # Full-screen snapshot browser
│   │   └── plugins/
│   │       └── annotations/
│   │           ├── models.ts          # Type defs, factory helpers, type guards
│   │           ├── annotationField.ts # StateField + all StateEffects + undo support
│   │           ├── utils.ts           # Range mapping, active annotation queries
│   │           ├── diff.ts            # Diff computation for suggestions
│   │           ├── nestedEditor.ts    # Nested editor lifecycle helpers
│   │           ├── commentAi.ts       # Shared AI prompt/stream helpers for comment threads
│   │           ├── revisionModalKeyguard.ts # Prevents modal shortcuts when CM editor has focus
│   │           ├── eventBus.ts        # Typed pub/sub bus decoupling plugins from components
│   │           ├── NestedEditorController.ts # Shared lifecycle/sync for nested editors
│   │           ├── index.ts           # Keybindings, ViewPlugins, public API
│   │           ├── Annotations.svelte # Right panel container + card positioning
│   │           ├── Comment.svelte     # Comment card
│   │           ├── CommentModal.svelte # Full-screen comment thread modal
│   │           ├── DiffModal.svelte   # Full-screen diff view overlay
│   │           ├── PreComment.svelte  # Draft form for empty-thread comment
│   │           ├── Revision.svelte    # Revision card + inline nested editor
│   │           ├── RevisionModal.svelte # Full-screen nested editor overlay
│   │           ├── Suggestion.svelte  # Suggestion card with diff view
│   │           ├── Thread.svelte      # Message list inside a card
│   │           ├── ThreadMessage.svelte # Single message (with inline edit)
│   │           ├── TutorialGuide.svelte # In-editor tutorial callouts
│   │           └── default.css        # Highlight CSS classes for all annotation types
│   ├── readers/
│   │   ├── colors.ts            # Hex → lightTint/mediumTint helpers for persona avatar backgrounds
│   │   ├── presets.ts           # ReaderPersona type, DEFAULT_PERSONAS (8 builtin personas)
│   │   ├── prompt.ts            # buildPersonaPrompt() — assembles persona identity + chattiness directive
│   │   └── settings.svelte.ts   # Reactive persona list store, localStorage persistence, CRUD helpers
│   ├── library/
│   │   ├── ContinuePill.svelte  # "Continue writing" shortcut on library page
│   │   ├── DocumentCard.svelte  # Single document card in the grid
│   │   ├── DocumentGrid.svelte  # Grid layout for document list
│   │   ├── EmptyState.svelte    # Empty library placeholder
│   │   ├── LibraryTopBar.svelte # Library page header + actions
│   │   └── PreviewPanel.svelte  # Document preview sidebar
│   ├── save/
│   │   └── Save.svelte          # Save indicator
│   ├── settings/
│   │   ├── SettingsModal.svelte # App-level settings overlay
│   │   ├── FontGuideModal.svelte # Font guide with descriptions and samples
│   │   └── fonts.ts             # Canonical font list with metadata
│   ├── tutorial/
│   │   ├── Tutorial.svelte      # Onboarding tutorial overlay
│   │   └── steps.ts             # Tutorial step definitions
│   ├── ui/
│   │   ├── Kbd.svelte           # Keyboard shortcut display component
│   │   └── UpdateBanner.svelte  # In-app auto-update notification
│   ├── constants.ts             # App-wide constants (feedback form URL, etc.)
│   ├── errorGuard.ts            # Suspicious change detection + crash backups
│   ├── ErrorBanner.svelte       # Error/recovery banner UI
│   ├── export.ts                # Document export (txt, json, md, txt+json)
│   ├── navigation.ts            # Page transitions between editor and library
│   ├── posthog.ts               # PostHog analytics init + opt-out sync
│   ├── stores.ts                # Global Svelte stores (includes settingsOpen for native menu)
│   └── settings.svelte.ts       # App settings (reactive, persisted to localStorage)
├── routes/
│   ├── +layout.svelte           # Root layout
│   ├── +layout.ts               # SvelteKit layout config
│   ├── +page.svelte             # Editor page: three panels + modal stack renderer
│   ├── library/
│   │   └── +page.svelte         # Library page (document list, trash/restore)
│   └── history/
│       └── +page.svelte         # Version history browser (thin wrapper around VersionHistory.svelte)
src-tauri/src/
├── lib.rs                       # Tauri command registration + native app menu
├── main.rs                      # Entry point
├── keychain.rs                  # OS keychain for API key storage
└── db/
    ├── mod.rs                   # Re-exports and shared types (AppendEventResult, LoadResult, etc.)
    ├── schema.rs                # SQLite schema creation + migrations (WAL mode)
    ├── documents.rs             # Document CRUD, trash, drafts, trash retention
    ├── events.rs                # Event log append, snapshot CRUD, pruning, retention
    └── load.rs                  # Document state reconstruction (latest snapshot + replay)
```

---

## Icons and Logo

| File | Purpose |
|---|---|
| `static/logo.svg` | Quill mark on transparent background — used in-app and on the landing page |
| `static/icon.svg` | **Source of truth for the app icon.** Hand-crafted quill mark on neumorphic rounded-rect background |
| `src-tauri/icons/Quillium.png` | Pre-rendered 512×512 PNG exported from `icon.svg`. SVG filter rendering (`feDropShadow`) varies across tools (Inkscape, Chromium, `tauri icon`), so this PNG is used for platform icon generation |
| `src-tauri/icons/*` | Generated platform icons (icns, ico, Windows/iOS/Android sizes) |

To regenerate all platform icons from `Quillium.png`: `bun run icons`

If the logo design changes, update `icon.svg` first, then re-export `Quillium.png` (e.g. from a browser), then run `bun run icons`.

---

## State Management Mental Model

This is the most important section to understand before touching any annotation or editor code.

### Two separate state worlds

Quillium runs two parallel state systems that must be kept in sync:

**1. CodeMirror state** — lives inside `EditorView`. Immutable, transaction-based. Every change produces a new state object. Extensions (`StateField`, `ViewPlugin`, etc.) live here. Supports undo/redo via `historyField`.

**2. Svelte stores** — reactive signals consumed by components. Do not update automatically when CodeMirror state changes. Must be manually pushed by `Editor.svelte`'s `updateListener`.

```mermaid
flowchart TD
    Input["User edit or dispatched transaction"]

    subgraph CMState["CodeMirror state"]
        CM["EditorView state<br/>document + historyField + annotationField"]
    end

    Listener["Editor.svelte updateListener fires"]
    Mirrors["Svelte mirror stores<br/>$annotations, $activeAnnotation,<br/>$documentContent, $selectedText,<br/>$saveStatus, $currentDocumentTitle"]

    subgraph CollabStores["Collab stores<br/>separate from updateListener"]
        CollabState["$collabState"]
        OwnerLeft["$ownerLeftSignal"]
        Reconnect["$reconnectAttempt"]
    end

    Input --> CM --> Listener --> Mirrors
    CollabStores -. "updated by collab provider/UI" .-> Mirrors
```

### Why `$editorView` doesn't trigger reactivity

`editorView` is a `writable<EditorView>`. It's set once at mount and never updated again — the `EditorView` object is mutated in place by CodeMirror on each transaction. Svelte's reactivity won't fire. This is intentional: the store is only for *imperative access* (e.g., dispatching a transaction from the AI sidebar). For *reactive data*, use the manually-synced mirror stores.

### Transaction annotation vs. StateEffect

CodeMirror has two mechanisms for attaching metadata to a transaction:

- **`StateEffect`** — persistent. Stored in history, can be inverted for undo. Used for all annotation mutations.
- **`Transaction.annotation()`** — ephemeral metadata on the transaction itself. Not stored in history, not invertible. Used for flags like `revisionInternalEdit` (signals to `ViewPlugin`s that a transaction is revision-system-driven) and `nestedEditorEdit` (identifies the revision whose nested editor originated a parent dispatch).

---

## The Annotation System

The annotation system is the core of Quillium's non-linear editing model. It is layered:

```
models.ts           — Plain types, factory helpers, type guards (no CM imports)
annotationField.ts  — StateField + StateEffects + undo/redo (CM state layer)
utils.ts            — Pure query helpers: range mapping, active annotation
index.ts            — ViewPlugins + keybindings + public factory functions
Svelte components   — UI rendering, nested editor lifecycle
```

### Data model

All annotation types share a `BaseAnnotation`:

```typescript
type BaseAnnotation = {
    selection: EditorSelection; // what text is annotated (document positions)
    id: number;                 // unique within the annotation map
    thread: Thread;             // array of { message, author, time }
};

type CommentAnnotation    = BaseAnnotation & { _type: "comment" };
type SuggestionAnnotation = BaseAnnotation & { _type: "suggestion"; replacements: SuggestionReplacement[] };
type RevisionAnnotation   = BaseAnnotation & {
    _type: "revision";
    activeVersionIndex: number; // index into versions[]
    versions: VersionState[];  // all version texts (or full EditorState blobs)
};

type Annotations = { [id: number]: GenericAnnotation };
```

`VersionState` is intentionally opaque: `{ doc: string; label?: string } & object`. Each entry always reflects the most recent text that lived under a revision range in the parent document; Phase 3 (`pushDocToVersionState`) pushes the parent document slice into `versions[activeVersionIndex].doc` whenever the parent edits that slice. Nested editor state isn't serialized as a standalone snapshot anymore — we rebuild from whatever `doc` is stored in the revision slot when the editor reopens, so `versionText(version)` continues to just read `.doc`. `VersionStateSchema` still uses `.passthrough()` so extra keys survive if they are added elsewhere.

Use `isAnnotationOfType(annotation, "revision")` everywhere — never compare `_type` directly.

### `annotationField` — the StateField

`annotationField` is the single source of truth for all annotation data. Its `update()` function runs on **every** CodeMirror transaction and proceeds in three phases:

#### Phase 1: Remap positions

```
remapAnnotationSelections(annotations, tr)
```

Maps every annotation's `selection` through `tr.changes` so positions stay accurate as text is inserted or deleted.

- Comments and suggestions are **removed** if their range collapses to zero width (text was fully deleted).
- Revisions **temporarily survive** empty ranges via `allowEmpty: true` in `cleanRangesOf()`. This keeps the annotation alive (with its version list) long enough for `collapsedRevisionResolver` to dispatch a clean removal. The revision is then removed without creating a history entry, and undo fully restores both text and annotation via `_restoreAnnotation` effects stored by `invertedAnnotationFieldEffects`.

#### Phase 2: Apply effects

Processes each `StateEffect` in the transaction. Each effect type has a corresponding branch:

| Effect | Action |
|---|---|
| `addAnnotation` | Insert into the map at `e.value.id` |
| `removeAnnotation` | Delete from the map |
| `updateThread` | Replace `annotation.thread` |
| `_addVersionToRevision` | Splice new version into `annotation.versions` |
| `_deleteVersionFromRevision` | Splice version out |
| `_updateActiveRevisionVersion` | Update `activeVersionIndex`, rebuild selection to span new text |
| `_updateRevisionVersionState` | Replace a version's blob with the nested editor's serialized state |
| `addSuggestion` | Text search + add suggestion annotation |
| `_applySuggestion` | Delete suggestion from map |

Effects touching a specific revision ID are tracked in `revisionsWithExplicitEffect` (a `Set<number>`). This set is used in Phase 3.

#### Phase 3: Push document text into version state

```
if (tr.docChanged) {
    annotations = pushDocToVersionState(annotations, tr, revisionsWithExplicitEffect);
}
```

For each revision **not** in `revisionsWithExplicitEffect`, reads the document slice under the revision's range and writes it back into `versions[activeVersionIndex].doc`. This keeps the version text current when the user types inside an active revision in the main document.

**Critical invariant:** Phase 3 only runs when `tr.docChanged`. It skips revisions that had an explicit effect this transaction (their text was already set correctly by the effect handler). The `revisionsWithExplicitEffect` set is per-revision, not a single boolean — this matters when multiple revisions exist.

**Undo interaction:** Phase 3 mutations are not directly invertible by the history system (they're inline state updates, not `StateEffect`s). However, because CodeMirror's undo also inverts the document change that caused the push, the revision range collapses back to its pre-edit position, and the next Phase 3 push on the inverted transaction re-reads the correct (pre-edit) text. The net result is correct as long as you don't switch versions mid-undo (which is handled by explicit effects + their inversions).

### Undo/redo: `invertedAnnotationFieldEffects`

Registered via `invertedEffects.of(...)` from `@codemirror/commands`. When CodeMirror undoes or redoes a transaction, it calls this function on the original transaction and expects back the effects that should be applied in the *inverse* transaction.

| Original effect | Inverted effect |
|---|---|
| `addAnnotation` | `removeAnnotation` (same object) |
| `removeAnnotation` | `addAnnotation` (same object) |
| `updateThread` | `updateThread` with old thread |
| `_addVersionToRevision` | `_deleteVersionFromRevision` at same index |
| `_deleteVersionFromRevision` | `_addVersionToRevision` at same index, with old version |
| `_updateActiveRevisionVersion` | `_updateActiveRevisionVersion` with old index |
| `_updateRevisionVersionState` | `_updateRevisionVersionState` with old blob |
| `_applySuggestion` | `addAnnotation` (restores the suggestion) |
| *(implicit)* collapsed revision in doc-change | `removeAnnotation(collapsed)` + `_restoreAnnotation(original)` |

The last row is generated **implicitly** (no explicit `StateEffect` needed): when a doc-changing transaction collapses a revision's range to zero width, `invertedAnnotationFieldEffects` stores both a `removeAnnotation` for the collapsed state and a `_restoreAnnotation` for the original pre-deletion annotation. On undo (which re-inserts the deleted text), `_restoreAnnotation` re-adds the annotation with its original selection. `_restoreAnnotation` is also used for comments/suggestions that were silently dropped by a deletion.

**`_revisionCleanup` guard:** The cleanup transaction dispatched by `collapsedRevisionResolver` (tagged `_revisionCleanup.of(true)` and `addToHistory.of(false)`) is skipped entirely by `invertedAnnotationFieldEffects`. Without this guard, the `removeAnnotation` effects in the cleanup would generate spurious `addAnnotation(collapsed)` effects that would be merged into the deletion's undo entry alongside the correct `_restoreAnnotation` effects, causing orphaned collapsed annotations to re-appear on undo.

`addAnnotation`/`removeAnnotation` carry the full annotation object (not just an ID) precisely to make inversion cheap — no `startState` lookup needed.

### State effects are private; transaction builders are public

Effects prefixed with `_` are not exported from `annotationField.ts`. All external code uses named builder functions:

```typescript
// Public API — these bundle effects + doc changes atomically
setActiveRevisionVersion(state, annotationId, to)
createNewRevision(state, annotationId)
deleteRevisionVersion(state, annotationId, versionId)
updateRevisionVersionState(state, annotationId, versionId, newVersionState)
branchSuggestion(state, annotationId)
applySuggestion(state, annotationId, replacementIndex)
```

Each builder returns a `TransactionSpec` (not dispatched yet). The caller is responsible for `view.dispatch(builder(...))`.

### `revisionInternalEdit` — the revision-system-driven flag

```typescript
export const revisionInternalEdit = Annotation.define<boolean>();
```

A `Transaction.annotation` (not a `StateEffect`) set to `true` on every transaction dispatched by the public revision API builders (`setActiveRevisionVersion`, `createNewRevision`, `deleteRevisionVersion`, `updateRevisionVersionState`, `branchSuggestion`). It marks the transaction as revision-system-driven — the doc change is part of the revision system's own operation, not user typing.

Three consumers check for this flag:

1. **`collapsedRevisionResolver`** (`ViewPlugin`) — skips auto-removal of collapsed revisions, because the collapse is intentional (the builder is replacing the text with the correct version content).
2. **`boundaryInsertNudge`** (`ViewPlugin`) — skips emitting nudge UI events for programmatic insertions.
3. **`invertedAnnotationFieldEffects`** — skips implicit annotation remapping detection, because these transactions manage their own annotation state via explicit `StateEffect`s.

Because it is a `Transaction.annotation` and not a `StateEffect`, it is **not** stored in history and **not** inverted. The inverted `StateEffect`s on each transaction already carry the full semantic meaning of "undo this op."

### `_revisionCleanup` — the cleanup-transaction flag

```typescript
export const _revisionCleanup = Annotation.define<boolean>();
```

Set to `true` on the transaction dispatched by `collapsedRevisionResolver` when it removes collapsed revisions. Always paired with `Transaction.addToHistory.of(false)`. Its sole consumer is `invertedAnnotationFieldEffects`, which returns an empty effects array immediately when it sees this annotation — preventing the cleanup's `removeAnnotation` effects from generating spurious `addAnnotation(collapsed)` effects in the undo entry for the deletion.

---

## ViewPlugins and Extensions

`index.ts` registers three `ViewPlugin`s and one facet extension that react to editor updates:

### `annotationDecorations`

Builds `DecorationSet`s for all annotation types on every `selectionSet`, `docChanged`, or annotation state change. Applies CSS classes:

- `cm-comment` / `cm-comment-active`
- `cm-revision` / `cm-revision-active`
- `cm-suggestion` / `cm-suggestion-active`

Active state is determined by `getActiveAnnotation()` — the annotation whose range contains the cursor. If multiple ranges overlap, the narrowest one wins.

### `revisionAtomicRanges`

Registered via `EditorView.atomicRanges.of(...)` (a facet provider, not a `ViewPlugin`). Marks all **inactive** revision ranges as atomic. The cursor jumps over the entire span instead of entering it. This does *not* block edits — `atomicRanges` only governs cursor placement.

### `collapsedRevisionResolver`

Monitors for revision ranges that collapsed to `from === to` in a `docChanged` transaction (that is not annotated `revisionInternalEdit`). Collects **all** such collapsed revisions and, in a single `queueMicrotask`-deferred dispatch:

- Removes all collapsed revisions via `removeAnnotation` effects.
- Tags the transaction `Transaction.addToHistory.of(false)` so no new undo history entry is created.
- Tags the transaction `_revisionCleanup.of(true)` so `invertedAnnotationFieldEffects` skips it entirely (no spurious `addAnnotation(collapsed)` effects are generated).

Undo is handled entirely by the `_restoreAnnotation` effects that `invertedAnnotationFieldEffects` stored on the *deletion* transaction — a single Cmd+Z re-inserts the deleted text and restores all revision annotations (with all versions intact) in one step.

The `queueMicrotask` defers the dispatch past the current update cycle (required to avoid "dispatch inside update"). The stale-state guard (`update.view.state !== update.state`) prevents a double-dispatch if the user presses Cmd+Z synchronously before the microtask fires.

### `boundaryInsertNudge`

Fires a `revision-boundary-nudge` UI event when text is inserted immediately at a revision's `from` or `to` boundary. This signals the revision card to show a brief hint pointing the user to the nested editor.

---

## Stores vs derived
- Stores in `src/lib/stores.ts` mirror pieces of CodeMirror state because the update listener is the only place aware of doc/annotation changes. Derived stores recalculate automatically from their dependencies, but there is no single upstream store for annotations, active selection, and document text. Attempting to make these derived would mean repeating the imperative update logic inside their calculations, so writable mirrors keep the flow explicit. Components only derive from these mirrors when the dependency chain is direct (e.g., modal breadcrumbs from `modalStack`).

## Nested Editors

Each `RevisionAnnotation` still supports two editing surfaces: a lightweight inline editor inside the revision card and a full-screen modal. Both are full `CodeMirror EditorView` instances. The parent document remains the **single source of truth** — nested editors are direct viewports onto the parent document’s revision range `[rev.from, rev.to]`.

### Architecture: direct parent dispatch (still)

Nested editors remain intentional viewports that never own their document. When the user types inside a nested editor:

1. The `updateListener` calls `translateAndDispatch(update, parentView, revisionId)` as before.
2. `translateAndDispatch` translates each change into parent coordinates (`rev.selection.main.from + delta`) and dispatches it with `nestedEditorEdit.of(revisionId)` plus `Transaction.addToHistory.of(true)`.
3. The parent doc is the single source of truth, so Phase 3 (`pushDocToVersionState`) still re-reads the post-transaction slice and keeps `versions[activeVersionIndex].doc` current for version switching (the revision is not added to `revisionsWithExplicitEffect`, so it pushes normally).

### NestedEditorController

Both inline (`Revision.svelte`) and modal (`RevisionModal.svelte`) editors delegate lifecycle and sync to a shared `NestedEditorController` class. The controller encapsulates:

- **Create/destroy**: Calls `createNestedEditorState` and manages the `EditorView` instance.
- **Parent → nested sync**: `syncFromParent(doc)` replaces the nested buffer when external changes arrive. Skips self-originated changes by tracking `lastDispatchedDoc` internally.
- **Nested → parent sync**: The controller’s `updateListener` calls `translateAndDispatch` to map nested edits to parent coordinates. It uses a CodeMirror `Transaction.annotation` (`parentSyncEdit`) to tag sync transactions, so the listener reliably skips them regardless of async callback timing.
- **Flush behavior**: Configured as `"flush"` (modal) or `"no-flush"` (inline). Flush serializes nested state via `updateRevisionVersionState` before destroying.
- **Version switch / annotation blob detection**: `needsVersionSwitch()` and `needsAnnotationRebuild()` let the owning component decide when to tear down and recreate.

Replacing the whole buffer is the tradeoff we accepted for this reactive path: the cursor/selection and scroll position do not survive the rewrite, so the nested editor appears to jump back to the top. There is no dedicated cursor-persistence mechanism yet.

When collab is active, `createNestedEditorState` also installs `createAwarenessExtension` with position mappers over the parent revision range. The nested editor still has no Yjs text binding and still syncs edits through `translateAndDispatch`; awareness only maps cursor coordinates so collaborators can see each other inside inline and modal annotation editors. Nested awareness uses `broadcastInitialCursor: false` and `clearCursorOnDestroy: false` so mounting a background nested editor does not steal or clear the user's shared cursor. It broadcasts only once that nested editor has focus.

### Inline editor

`Revision.svelte` creates a `NestedEditorController` with `flushBehavior: "no-flush"` (the parent doc is the source of truth via Phase 3). Svelte `$effect` blocks watch `activeVersion?.doc` and delegate to `controller.syncFromParent()`. Version switches and annotation blob changes trigger destroy + recreate via the controller.

### Modal editor

`RevisionModal.svelte` creates a `NestedEditorController` with `flushBehavior: "flush"`. The external-sync `$effect` watches the parent’s annotation state:

- **Root-level modals** (`stackIndex === 0`) watch `$annotationsStore`.
- **Deeply nested modals** (`stackIndex > 0`) watch `$modalAnnotationStores[stackIndex - 1]`.

Annotation IDs are scoped per-editor and can collide across nesting levels, so deeply nested modals must never read from `$annotationsStore` directly.

On destroy, the controller flushes nested editor state into the parent revision’s version blob using the `editorVersionIndex` tracked at creation time (not `rev.activeVersionIndex`, which may have changed). **This flush is believed to be redundant**: `translateAndDispatch` already syncs doc text per-keystroke, and `flushAnnotationStateToParent` syncs sub-annotations per-effect, so by the time `destroy()` runs the parent should already have all state. The flush is kept as a defensive safety net and is instrumented with PostHog (`nested_editor_flush_to_parent_meaningful`) to verify. If telemetry confirms zero meaningful flushes over ~1 month, remove `flushToParent` and the destroy-time call.

#### RevisionModal FSM

The modal editor's lifecycle is governed by a finite state machine rather than ad-hoc `$effect` chains. All transitions go through a single `send(event)` function.

```mermaid
stateDiagram-v2
    [*] --> unmounted
    unmounted --> mounting: DIALOG_BOUND
    mounting --> ready: TICK_RESOLVED
    ready --> rebuilding: REBUILD_REQUESTED / VERSION_SWITCHED
    rebuilding --> ready: TICK_RESOLVED
```

| State | Description |
|---|---|
| `unmounted` | Initial. Waiting for `dialogEl` to bind in the DOM. |
| `mounting` | Dialog is open, waiting for `tick()` so the editor host div is rendered. On `TICK_RESOLVED`: creates the nested editor, executes any `pendingNestedCommand`, transitions to `ready`. |
| `ready` | Normal operating state. Processes external doc changes (`EXTERNAL_DOC_CHANGED`), nested annotation events (`NESTED_ANNOTATION_EVENT`), and rebuild/version-switch requests. |
| `rebuilding` | Editor destroyed, waiting for `tick()` before recreating from the (possibly new) active version. Transitions back to `ready` on `TICK_RESOLVED`. |

| Event | Trigger |
|---|---|
| `DIALOG_BOUND` | Sensor Effect A detects `dialogEl` is bound |
| `TICK_RESOLVED` | `tick().then(...)` resolves after a state transition |
| `REBUILD_REQUESTED` | Sensor Effect A detects a new `rebuildToken` on the modal stack entry (set by `popToAndRebuild` when a child modal switches the parent's active version) |
| `VERSION_SWITCHED` | User picks a different version from the breadcrumb dropdown, Sensor Effect C-0 handles `annotation-add-version` from the nested editor's ⌘Enter, or Sensor Effect B detects the parent's `activeVersionIndex` changed |
| `EXTERNAL_DOC_CHANGED` | Sensor Effect B detects the parent's version doc text changed (undo, typing in parent) |
| `NESTED_ANNOTATION_EVENT` | Sensor Effect C receives a `revision-open-nested-editor` UI event targeting this modal's revision |

#### Sensor effects

The FSM is driven by five reactive sensor effects that translate external signals into FSM events:

| Effect | Watches | Sends |
|---|---|---|
| **A: Dialog bind + rebuild token** | `dialogEl`, `$modalStack[stackIndex].rebuildToken` | `DIALOG_BOUND`, `REBUILD_REQUESTED` |
| **B: External sync** | `$annotationsStore` (root) or `$modalAnnotationStores[stackIndex-1]` (nested) | `VERSION_SWITCHED`, `EXTERNAL_DOC_CHANGED` |
| **C-0: Add-version from nested editor** | `annotationEventBus` `"annotation-add-version"` event where `annotationId === revisionId` and modal is top | Calls `addVersion()` which dispatches `createNewRevision` + sends `VERSION_SWITCHED` synchronously |
| **C: Nested annotation event** | `annotationEventBus` `"nested-annotation-create"` event where `command.revisionId === revisionId` | `NESTED_ANNOTATION_EVENT` |
| **D: Nested revision click** | `annotationEventBus` `"revision-focus-request"` event — handled by `Revision.svelte` cards in the modal's sidebar | Pushes a new modal onto `modalStack` directly (no FSM event needed) |

Sensor Effect D handles the case where the user clicks on a nested revision decoration inside the modal's CodeMirror editor. The `revisionClickHandler` extension (included in every nested editor via `getExtensions`) fires a `revision-focus-request` with the nested annotation's ID. Effect D checks whether that ID belongs to a revision in *this* modal's nested editor — if so, it pushes a new modal with `parentView: editor`, enabling click-to-open at any nesting depth.

### Undo

`makeParentUndoKeymap` still delegates `Mod-z`/`Mod-y` to `undo(parentView)`/`redo(parentView)` because nested editors continue to have no local history (`getExtensions({ history: false })`). The parent history records nested edits as plain doc changes (via `translateAndDispatch` + `addToHistory:true`), and the reactive watcher eventually catches the inverted transaction and replaces the nested buffer, so the editor always reflects the current undo/redo state.

### Version switch

Version switching is the **only** time the nested editor is ripped down and recreated from a `VersionState` blob. Other parent-driven updates mutate the existing view via `dispatch`ed buffer replacements, so there is no rebuilding on every keystroke—just a new text payload that overwrites the current document when something external touched the revision range.

### `nestedSavedFields`

```typescript
export const nestedSavedFields = { annotationField };
```

`nestedSavedFields` is still exported mainly for tooling/tests. No `historyField` is present because nested editors continue to have no local history. `VersionStateSchema` uses `.passthrough()` so any extra keys survive round-trips through `RawAnnotationsSchema.safeParse()`, but the production path now only relies on simple `{ doc, label? }` blobs.

### Infinite nesting

Modal’s `parentView` can be another nested `EditorView`. `translateAndDispatch` chains up the stack automatically — each call dispatches to its immediate parent, which may itself be a nested editor whose watcher catches the change.

**Upward path** (nested edit → root): each `translateAndDispatch` call maps the change to parent coordinates and dispatches to the parent view. If the parent is itself a nested editor, its own `translateAndDispatch` fires and propagates further up. This continues until the root editor is reached and the change enters the global undo history.

**Downward path** (undo/external change → nested editors): each modal’s external-sync `$effect` detects changes in its parent `view`’s annotation state and patches its nested editor buffer. This cascades: root change → level-0 modal pulls → level-0’s nested editor state changes → level-1 modal pulls, etc.

**Sub-annotation creation from within a modal**: the nested editor’s `makeParentUndoKeymap` binds Mod-Alt-m/k to emit `"nested-annotation-create"` on the `annotationEventBus`. The `Revision.svelte` component in the modal’s sidebar catches this and pushes a new modal for the sub-annotation. The sub-annotation is created directly in the new modal’s nested editor via `executePendingNestedCommand`.

**Annotation ID independence**: each nested editor has its own `annotationField` with IDs starting from 0. The global `$annotationsStore` only contains the root editor’s annotations. Nested modals must not look up their `revisionId` in `$annotationsStore` — it would find an unrelated annotation or `undefined`.

---

## The `modalStack`

`modalStack` in `stores.ts` is the mechanism for opening nested revision/diff overlays.

```typescript
type ModalEntry =
    | { type: "diff"; suggestionId: number; parentView: EditorView; label: string }
    | { type: "revision"; revisionId: number; parentView: EditorView; label: string; pendingNestedCommand?: PendingNestedCommand };
```

`+page.svelte` renders `{#each $modalStack as entry}` — every entry produces a live overlay simultaneously. Modals stack visually, not replace each other.

| Method | Effect |
|---|---|
| `push(entry)` | Open new modal on top |
| `pop()` | Close topmost modal |
| `popTo(i)` | Close all modals above index `i` |
| `popToAndRebuild(i)` | `popTo(i)` + stamp `rebuildToken` on entry `i` so it recreates its editor |
| `clear()` | Close all modals |

**`popToAndRebuild`**: when a child modal switches the active version on a parent-level revision, the parent modal's editor was built from the old version and must be recreated. Stamping `rebuildToken: Date.now()` on the entry signals the parent modal's `$effect` to destroy and recreate its editor with the new version's content.

**Breadcrumbs**: each `RevisionModal` receives its `stackIndex` and derives `crumbs = $modalStack.slice(0, stackIndex + 1)`. Every open modal renders the full breadcrumb trail, so the deepest nesting level always shows the complete path.

---

## The Annotation Event Bus

`annotationEventBus` (in `eventBus.ts`) is a typed publish/subscribe bus that decouples `ViewPlugin` / command logic from component-specific reactions.

Components subscribe via `annotationEventBus.on(type, handler)` inside `$effect` blocks and return the unsubscribe function as cleanup. Events are delivered directly to all listeners of the matching type — no deduplication tokens needed.

| Event type | Emitted by | Consumed by |
|---|---|---|
| `revision-boundary-nudge` | `nudgeBoundary` command, `boundaryInsertNudge` plugin | `Revision.svelte` (shows hint) |
| `revision-request-modal` | `redirectToNestedEditor` command | `Revision.svelte` (opens modal with pending command) |
| `nested-annotation-create` | `makeParentUndoKeymap` (Mod-Alt-m/k) | `Revision.svelte` (opens modal), `RevisionModal.svelte` (FSM event) |
| `revision-focus-request` | `revisionClickHandler` dom event | `Revision.svelte` (places cursor or opens modal) |
| `pending-comment-alert` | `createCommentCommand` | `Annotations.svelte` (flashes existing pending comment) |
| `pending-nested-editor-selection` | `createRevisionCommand` | Stored in bus, consumed by `controller.applyPendingSelection()` on mount |
| `annotation-focus-reply` | Keyboard shortcut (Cmd+/) | `Thread.svelte` (focuses reply textarea) |
| `annotation-add-version` | `addRevisionVersionCommand`, keyboard shortcuts | `RevisionModal.svelte` (creates new version + synchronous FSM transition when modal is open), `Revision.svelte` (creates new version when no modal is open) |

**Pattern for consuming events in Svelte:**
```typescript
$effect(() => {
    return annotationEventBus.on("revision-boundary-nudge", (event) => {
        if (event.revisionId !== revision.id) return;
        // handle event
    });
});
```

---

## Persistence

Quillium uses a crash-safe, append-only SQLite event log (WAL mode) with periodic snapshots. All database operations run in Rust via Tauri commands — the TypeScript layer calls `invoke()` wrappers in `src/lib/db/index.ts`.

### Schema overview

| Table | Purpose |
|---|---|
| `documents` | Document metadata (title, word count, preview, tags) |
| `drafts` | Named drafts per document (default one per document) |
| `events` | Append-only log of CM transactions, one row per update |
| `snapshots` | Full `EditorState.toJSON()` blobs; auto-pruned on startup per retention policy, or manually via the Version History storage panel |
| `_meta` | Key/value flags (active draft pointers) |

The `documents` table has **no `state_json` column**. Document state lives entirely in `snapshots`.

### Event log flow

```typescript
// extensions.ts
export const savedFields = { historyField, annotationField };

// On every docChanged || annotationsChanged (listeners.ts):
const result = await appendEvent(draftId, JSON.stringify(payload));
if (result.needsSnapshot) {
    createSnapshot(draftId, JSON.stringify(state.toJSON(savedFields)), result.eventId);
}
```

`appendEvent` (Rust) atomically inserts the event row, bumps `documents.updated_at`, and returns `{ eventId, needsSnapshot }`. A snapshot is triggered when ≥50 events have accumulated since the last snapshot, or ≥120 seconds have elapsed.

### Load flow

```typescript
// Editor.svelte
const loaded = await loadDocumentState(docId, draftId);
// loaded.snapshotStateJson  → latest snapshot blob
// loaded.snapshotEventId    → id of that snapshot (-1 for seed)
// loaded.eventsSince        → events after the snapshot
```

`loadDocumentState` (Rust) fetches the most-recent snapshot for the draft and all events with `event_id > snapshot.up_to_event_id`. The snapshot is restored first, then any `eventsSince` are replayed in order via `replayEvents()` to reconstruct the full editor state.

### Event payload format

Each event has a `type` field that determines its shape:

- `doc_change` — pure text edit `{ changes: [{from, to, insert}], selection }`
- `annotation_add` / `annotation_remove` / `annotation_update` — annotation mutations
- `compound` — doc change + annotation effects in the same CM transaction

### Snapshot pruning

`create_snapshot` (Rust) inserts the snapshot with no inline pruning. Automatic pruning happens on app startup: if a snapshot retention policy is configured (via `setSnapshotRetention`), all unlabeled snapshots older than that many days are pruned across all drafts. Named snapshots (distinguished by a non-null `label` column) are never auto-pruned and persist until explicitly deleted by the user.

`VersionState` blobs (nested editor state) are also serialized inside `annotationField.toJSON()` — they're stored as opaque objects within the `versions` array and round-trip correctly because they're already JSON-safe.

### Crash-safety matrix

| Data | Durability on crash |
|---|---|
| Main doc text | Per-keystroke — every `doc_change` event is written to SQLite before the next keystroke |
| Active revision version text | Per-keystroke — `translateAndDispatch` forwards nested editor changes to the parent as `doc_change` events; Phase 3 (`pushDocToVersionState`) keeps `versions[activeVersionIndex].doc` current |
| Non-active revision version text | **Snapshot-only** — see known gap below |
| `activeVersionIndex` version index | **Snapshot-only** |
| Version labels | **Snapshot-only** |
| Thread messages | Per-action — captured as `annotation_update` events |

### Revision version state persistence

**Relevant files:**
- `src/lib/editor/listeners.ts` — `extractAnnotationEvents()`
- `src-tauri/src/db/events.rs` — `SNAPSHOT_EVENT_THRESHOLD = 50`, `SNAPSHOT_TIME_THRESHOLD_SECS = 120`

`extractAnnotationEvents` writes `addAnnotation`, `removeAnnotation`, and `updateThread` as explicit event log entries. Revision-specific internal effects (`_updateRevisionVersionState`, `_addVersionToRevision`, etc.) are captured by a pre/post diff on `annotationField`: any annotation whose identity changed between `tr.startState` and `tr.state` (and wasn't already handled by an explicit effect) gets an `annotation_update` event emitted. This ensures version switches, label edits, and structural changes are persisted per-action without needing to export internal effects.

---

## Keybindings

The annotation keymap (installed at `Prec.high`) intercepts before default CodeMirror bindings:

| Key | Command chain |
|---|---|
| `Backspace` | `nudgeBoundary("backward")` → `deleteAdjacentRevision("backward")` → default |
| `Delete` | `nudgeBoundary("forward")` → `deleteAdjacentRevision("forward")` → default |
| `Mod-Alt-M` | `redirectToNestedEditor("comment")` → `createCommentCommand` |
| `Mod-Alt-K` | `redirectToNestedEditor("revision")` → `createRevisionCommand` |
| `Mod-B` | `openDictionary` (dictionary popover, `dictionaryPlugin.ts`) |

Each handler returns `false` to fall through to the next binding if it doesn't apply. `redirectToNestedEditor` returns `true` (swallowing the keypress) only when the cursor is inside an active revision — otherwise it returns `false` and the real create command runs.

The native app menu (see § Native App Menu) also registers accelerators that are handled outside of CodeMirror:

| Key | Action |
|---|---|
| `Mod-,` | Toggle settings modal |
| `Mod-O` | Navigate to library |
| `Mod-Shift-H` | Navigate to version history |

---

## AutoAI

AutoAI is a background AI review system that watches document content and creates annotations automatically. It runs as an independent subsystem, separate from the AI sidebar (aside from the AI provider), and is controlled via a fixed-position bubble widget in the bottom-left corner.

### Files

| File | Purpose |
|---|---|
| `src/lib/autoai/settings.svelte.ts` | Settings store, type definitions, localStorage persistence |
| `src/lib/autoai/engine.ts` | Review orchestration, AI calls (`generateObject`), annotation dispatch |
| `src/lib/autoai/AutoAIWidget.svelte` | Bubble + expanded settings panel UI, wires settings + engine + face animation |
| `src/lib/autoai/AutoAIFace.svelte` | Purely presentational animated face SVG component |
| `src/lib/autoai/faceAnimation.svelte.ts` | Factory owning eye-offset, tracking, and sleep/wake state (consumed by the widget) |

### Settings

AutoAI settings are stored in `autoAISettings` (`$state` proxy) and persisted to localStorage under `"quillium-autoai-settings"`:

| Setting | Type | Default | Description |
|---|---|---|---|
| `enabled` | boolean | `false` | Whether AutoAI is active |
| `mode` | `"continuous"` \| `"manual"` | `"continuous"` | Auto-review on change vs. manual trigger |
| `debounceMs` | number | 10000 | Delay (ms) before triggering a review after doc change |
| `persona` | string | `"AutoAI"` | Name shown in annotation author fields |
| `annotationTypes` | set | all three | Which types to create: comments, suggestions, revisions |
| `conservativeness` | enum | `"balanced"` | Review depth: conservative / balanced / thorough |

### Review Engine (`engine.ts`)

**`startAutoAI()`** subscribes to the `documentContent` store. On each change ≥ 20 characters it schedules a debounced `runReview()`.

**`stopAutoAI()`** unsubscribes the listener and cancels any pending timer.

**`triggerManualReview()`** cancels any pending debounce and calls `runReview()` immediately (no thinking state — the user already made the decision).

**`runReview()` flow:**

```
documentContent changed (≥ 20 chars)
→ debounce (debounceMs)
→ autoAIThinking = true           ← face shows >_< while waiting
→ ensureApiKeyLoaded()            ← async — thinking face visible here
→ autoAIThinking = false
→ autoAIReviewing = true          ← face switches to scanning squint
→ generateObject() — single non-streaming AI call
    system prompt: persona + conservativeness level + annotation type constraints
    Zod schema: array of { type, targetText, ... }
→ applyAnnotations() — for each result:
    find targetText in current doc
    dispatch createComment / createSuggestion / createRevision
→ autoAIReviewing = false
```

`autoAIThinking` and `autoAIReviewing` are exported writable stores (not the global `aiProcessing`) so the face state machine reacts only to AutoAI's own activity. `aiProcessing` is still set for the duration to block concurrent AI sidebar operations.

### Widget UI (`AutoAIWidget.svelte`)

A morphing bubble component fixed at `bottom: 24px; left: 24px`:

**Collapsed** (67 × 67px):
- Animated `<AutoAIFace>` reacting to app state (see face states below)
- Rainbow gradient border while enabled; spinning animation during review
- Bubble dimmed to 50% opacity when no API key is configured

**Expanded** (320 × 310px):
- Small face icon in the header (scaled down, static eye offsets)
- Persona name (editable inline), enable toggle, close button
- Mode selector (Auto / Manual)
  - Auto mode: delay slider (2–60 s)
  - Manual mode: "Review now" button
- Annotation type pills (Comments / Suggestions / Revisions)
- Depth slider (Conservative → Balanced → Thorough)

Closes on outside click. Controls are dimmed at 40% opacity when no API key is set.

### Face State Machine (`AutoAIFace.svelte`)

`AutoAIFace` is a purely presentational SVG component driven by a `state` prop and `eyeOffsetX`/`eyeOffsetY` props (–4 to +4 px). All animation is CSS keyframes.

**States** (priority order, highest first):

| State | Appearance | Condition |
|---|---|---|
| `disabled` | × eyes | No API key configured |
| `reviewing` | Narrow squint, scanning left-right | `autoAIReviewing` is true |
| `thinking` | `>_<` face with head bob | `autoAIThinking` is true |
| `waking` | Eyes stretch open (yawn) | Within 1600ms of waking from sleep |
| `sleeping` | Horizontal bars + floating zzz | 30s idle with no interactions |
| `tracking` | Bar eyes offset toward caret/cursor | Engaged after 1s of sustained typing (then within 2s linger after the last caret/edit); mouse also tracks within 180px of the widget |
| `idle` | Bar eyes, synchronized blink every ~3s | Default |

**Eye tracking**: `computeEyeOffset()` maps the distance and direction from the widget center to the target into a ±4px offset clamped by `dist / 80`. The caret position is broadcast via the `quillium:caret-moved` CustomEvent (emitted by `listeners.ts` on `selectionSet || docChanged`, throttled to one dispatch per `requestAnimationFrame` per editor view via a `WeakMap`). Caret/typing tracking is gated by a sustained-typing check: the first caret event opens a streak, each subsequent event extends it, and the streak is broken by 500ms of silence. Tracking only engages once the streak has lasted `SUSTAINED_TYPING_MS` (1s). This prevents a single keystroke or a short correction from snapping the eyes into tracking mode. Mouse tracking fires when either (a) caret tracking is currently active (i.e. within the 2s linger window after the last caret/typing event that crossed the sustained-typing gate) or (b) the cursor is within `PROXIMITY_RADIUS_PX` (180px) of the widget center, which gives an "it noticed you" beat as you approach the bubble. Outside both conditions the widget ignores `mousemove` entirely. When tracking ends the face transitions to `idle`; the derived `tx` resolves to `translate(0,0)` in any non-tracking state, and a 0.35s `transition: transform` on the `.tracker` wrapper group interpolates the eye offset smoothly back to the center, so the eyes glide (rather than snap) to the middle before the blink animation resumes.

**Sleep/wake**: After 30s of no `keydown` or caret events, the face sleeps. Any interaction triggers a 1600ms waking animation before returning to idle. Opening the panel silently clears the sleep state (no waking animation, since the bubble is hidden while the panel is open). The sleep timer reschedules itself if it fires while the panel is open or a review is active.

### Keybinding

`Mod-Shift-r` — registered in `src/lib/editor/extensions.ts` (main editor only). Dispatches the custom DOM event `"quillium:manual-review"`, which `+page.svelte` handles by calling `triggerManualReview()` if AutoAI is enabled. This keybinding is **not** included in nested editor extension stacks.

### Integration Points

- **Document content**: Engine subscribes to `documentContent` (written by `Editor.svelte`'s `updateListener`).
- **Annotation creation**: Calls the same factory functions (`createComment`, `createSuggestion`, `createRevision`) used by the AI sidebar and other annotation flows.
- **AI settings**: Reads `aiSettings` (provider, model, apiKey) via `createModel()` — AutoAI shares the same provider configuration as the sidebar.
- **`+page.svelte`**: Renders `<AutoAIWidget />`, listens for `"quillium:manual-review"` and `"quillium:open-ai-settings"` custom events.

---

## Reader Personas

Reader personas are configurable AI "readers" that provide feedback from distinct perspectives (e.g., Skeptical Editor, Clarity Coach, First-Time Reader). Each persona has its own lens, chattiness level, and identity. When the user triggers feedback via the Feedback tab, all enabled personas run in parallel — each producing annotations attributed to that persona's name.

### Files

| File | Purpose |
|---|---|
| `src/lib/readers/presets.ts` | `ReaderPersona` type definition, `DEFAULT_PERSONAS` (8 builtin personas) |
| `src/lib/readers/settings.svelte.ts` | `readersSettings` reactive store, localStorage persistence, CRUD helpers |
| `src/lib/readers/prompt.ts` | `buildPersonaPrompt()` — assembles persona identity block + chattiness directive |
| `src/lib/readers/colors.ts` | `lightTint()` / `mediumTint()` — hex color helpers for persona avatar styling |
| `src/lib/ai/Readers.svelte` | Configuration panel UI (persona cards, toggles, chattiness dots, custom creator) |

### Data Model

```ts
type ReaderPersona = {
    id: string;          // UUID for custom, slug for builtin (e.g. "skeptical-editor")
    name: string;        // Display name
    emoji: string;       // Avatar emoji
    color: string;       // Hex color for accent/avatar
    description: string; // Short tagline shown on collapsed cards
    profile?: {          // Rich profile for builtin cards (expanded view)
        about: string;
        goodFor: string[];
        example: string;
    };
    instruction: string; // AI prompt — not shown to users
    builtin: boolean;
    enabled: boolean;
    chattiness: "quiet" | "normal" | "verbose";
};
```

### Builtin Personas

| Persona | Focus | Default |
|---|---|---|
| Skeptical Editor 🔍 | Logical gaps, weak claims | Enabled |
| Clarity Coach 💡 | Jargon, ambiguity, readability | Enabled |
| First-Time Reader 👶 | Missing context, assumed knowledge | Enabled |
| Emotional Reader 💜 | Tone, voice, emotional resonance | Enabled |
| Flow Reader 🌊 | Pacing, transitions, momentum | Disabled |
| Devil's Advocate 😈 | Challenging assumptions, counterpoints | Disabled |
| Expert Reader 🎓 | Depth, accuracy, intellectual rigor | Disabled |
| Casual Skimmer ⚡ | Scannability, key points visibility | Disabled |

### Chattiness

Each persona has a 3-level chattiness setting that controls how much feedback it produces:

| Level | Behavior |
|---|---|
| `quiet` | Only flag significant issues; say nothing if the passage is solid |
| `normal` | Comment on issues worth the writer's attention |
| `verbose` | Be thorough; flag everything, even minor issues |

The chattiness directive is prepended to the persona's system prompt via `buildPersonaPrompt()`.

### Settings Persistence

Persona settings are stored in localStorage under `"quillium-readers-settings"` as a JSON array. On load, saved state is merged with `DEFAULT_PERSONAS` — user toggles and chattiness are preserved, but new builtins are added if the preset list grows. Custom (non-builtin) personas are appended after builtins.

### Multi-Persona Execution

When the user clicks a feedback button in `Feedback.svelte`, the `sendWithPersonas()` helper checks for enabled personas. If any exist, it calls `runMultiPersonaStreams()` in `chatFactory.ts`, which:

1. Gets all enabled personas via `getEnabledPersonas()`
2. Runs each persona's AI stream **in parallel** (`Promise.all`)
3. Each stream uses `buildPersonaPrompt(persona)` prepended to the mode's system prompt
4. Tool-call handlers attribute annotations (comments/suggestions/revisions) to the persona's name
5. PostHog events are captured per persona completion

If no personas are enabled, Feedback falls back to the standard single-stream behavior.

### UI (`Readers.svelte`)

The Readers panel is the 5th tab in the AI sidebar (key `5`). It displays:

- **Enabled personas** at the top, **disabled personas** below a divider (dimmed at 55% opacity)
- Each card shows: emoji avatar (colored circle), name, description, chattiness dots (1–3), enable toggle
- Clicking a builtin card expands it to show: about text, "Good for" tags, example feedback quote
- **Custom reader form** at the bottom: name, emoji, color swatch picker, instruction textarea
- Custom personas can be deleted; builtins cannot

### Integration Points

- **Feedback.svelte**: Routes all sends through persona check; sets `personaInFlight` flag to disable UI during multi-persona runs
- **chatFactory.ts**: `runMultiPersonaStreams()` handles parallel persona execution and annotation attribution
- **AI sidebar**: Readers is tab index 5 in `AISidebar.svelte`; uses rose theme accent

---

## Dictionary & Thesaurus

A floating popover triggered by `Mod-B` (⌘B) when a single word is selected. Provides definitions, synonyms/antonyms from the Free Dictionary API, and an AI "describe → find word" mode.

### Files

| File | Purpose |
|---|---|
| `src/lib/editor/dictionaryPlugin.ts` | CodeMirror keymap — validates selection (single word, ≤60 chars), computes popover coordinates, writes to `dictionaryTrigger` store |
| `src/lib/editor/DictionaryPopover.svelte` | Floating popover UI — definitions, synonym/antonym chips, AI describe mode |
| `src/lib/ai/clientStreams.ts` (`streamDictionary`) | AI stream for "describe → find word" mode (no document context injected) |

### Flow

```
User selects a word → Mod-B
→ dictionaryPlugin validates: single word, no whitespace, ≤60 chars
→ writes { word, selectionFrom, selectionTo, x, y } to dictionaryTrigger store
→ DictionaryPopover $effect reacts:
    - positions popover at (x, y), clamped to viewport
    - fetches https://api.dictionaryapi.dev/api/v2/entries/en/{word}
    - renders definitions, synonyms (click to replace), antonyms (click to look up)
→ "Describe → find word" (AI mode):
    - uses createAiChat({ mode: "dictionary" }) → streamDictionary
    - no document context sent (only selected text)
→ "Open in Chat": sets pendingChatMessage store → AISidebar opens Chat tab
```

### Integration Points

- **`dictionaryTrigger` store** (`stores.ts`): Written by the keymap, read by `DictionaryPopover.svelte`.
- **`pendingChatMessage` store** (`stores.ts`): Written by "Open in Chat" button, read by `AISidebar.svelte` (opens Chat tab) and `Chat.svelte` (pre-fills input).
- **`Annotations.svelte`**: Shows a `⌘B dictionary` keyboard hint when a single word is selected.
- **Synonym replacement**: Dispatches a CodeMirror transaction replacing the trimmed selection range with the chosen synonym.

---

## Common Flows

### Creating a comment

```
User selects text
→ Mod-Alt-M
→ canCreateNewComment() check (enforces single-pending mutex)
→ addAnnotation dispatched { _type: "comment", thread: [] }
→ PreComment.svelte renders (thread.length === 0 = pending state)
→ User fills in text + submits
→ updateThread dispatched with first message
→ Comment.svelte renders (thread.length > 0)
```

### Creating a revision

```
User selects text
→ Mod-Alt-K
→ addAnnotation dispatched { _type: "revision", versions: [{ doc: selected }], activeVersionIndex: 0 }
→ Text becomes atomic in main doc (cannot edit directly)
→ Revision.svelte renders with one version pill
→ isActive → nested editor auto-opens (if setting enabled)
```

### Switching revision versions

```
User clicks version pill N
→ view.dispatch(setActiveRevisionVersion(state, id, N))
  Transaction contains:
    - _updateActiveRevisionVersion effect (N)
    - doc change: replace revision range with versions[N].doc
    - revisionInternalEdit.of(true)  ← prevents collapsedRevisionResolver from firing
    - Transaction.addToHistory.of(true)
→ annotationField Phase 2: updates activeVersionIndex, rebuilds selection to new span
→ Phase 3 skipped for this revision (it's in revisionsWithExplicitEffect)
→ Svelte store sync → Revision.svelte re-renders with new active pill
→ syncRecursiveEditorToActiveVersion detects version change → reloads nested editor
```

### Undo of version switch

```
User presses Cmd+Z
→ historyField inverts the transaction
→ invertedAnnotationFieldEffects called on original transaction:
    - sees _updateActiveRevisionVersion { to: N }
    - emits _updateActiveRevisionVersion { to: oldCurrentlySelected }
→ Inverted doc change restores old text
→ Inverted effect restores activeVersionIndex
→ Full undo: document text AND annotation state revert together
```

### Editing in nested editor (inline or modal)

```
User types in nested editor
→ nested editor updateListener fires
→ translateAndDispatch(update, parentView, revisionId):
    - maps changes to parent coordinates (+ rev.selection.main.from offset)
    - dispatches to parent with nestedEditorEdit.of(revisionId) + addToHistory:true
→ Parent transaction:
    Phase 1: revision selection remapped (no-op for inserts inside range)
    Phase 2: no revision effects
    Phase 3: nestedEditorEdit is not added to revisionsWithExplicitEffect → annotationField runs and updates versions[activeVersionIndex].doc

On undo (Mod-z in nested editor delegates to undo(parentView)):
→ Parent undoes doc change → revision range text reverts
→ Phase 3 runs on inverted transaction → version.doc pushed to reverted text
→ Svelte $effect in Revision.svelte / RevisionModal.svelte detects activeVersion.doc changed
    → patches nested editor buffer (full replace via controller.syncFromParent, guarded by parentSyncEdit annotation)
    → nested editor shows reverted text (no destroy/recreate)
```

### Editing in main doc while revision is active (non-atomic mode)

```
User types inside an active revision range (atomicRevisions off)
→ Normal doc change transaction (no explicit revision effects, no nestedEditorEdit)
→ Phase 1: revision selection remapped through change
→ Phase 2: no revision effects
→ Phase 3: pushDocToVersionState runs for this revision
    - reads doc.slice(revision.from, revision.to)
    - writes into versions[activeVersionIndex].doc
→ Svelte $effect detects activeVersion.doc changed → patches nested editor buffer

On undo:
→ Doc change inverted → text reverts
→ Phase 3 runs again on inverted transaction → version.doc pushed back to reverted text
→ Svelte $effect patches nested editor with reverted text
```

---

## Design Constraints and Intentional Tradeoffs

### Revisions can survive empty ranges (undo restores them)

Comments and suggestions are removed when their text is deleted. Explicitly deleting the revision (select + Delete or delete-from-the-right) removes the annotation and versions immediately; nothing survives unless you undo the deletion. If you delete every character inside a nested version editor, the revision is still intact: its main-document range never collapsed, so the only thing that changes is the version text kept inside the annotation. That version can be empty safely and the revision remains available (and undoable) because the structural branch stays anchored to the original selection.

**How deletion works**: When a revision range collapses to zero length it survives only long enough for the system to record `_restoreAnnotation` effects; `collapsedRevisionResolver` immediately removes the zero-width annotation (in a microtask, tagged with `addToHistory.of(false)` and `_revisionCleanup`) so the field never holds a dangling collapsed revision.

**How undo works**: Undo is what makes it look like the revision “survived”: Cmd+Z reapplies both the deleted text and the original revision (with all versions) using the stored `_restoreAnnotation` effects.

### Nested editors are full `EditorView` instances

Each nested editor has its own annotations and keybindings, but **no local history** — undo/redo delegates to the parent via `makeParentUndoKeymap`. Writers can annotate within a revision version (infinite nesting), and nested annotation state (sub-annotations) is preserved across sessions in `VersionState` blobs via `editor.state.toJSON(nestedSavedFields)` + `updateRevisionVersionState` (called by the modal editor's `destroyEditor`).

### Direct editing of active revisions is blocked

Direct editing of revision ranges from the main document is not explicitly blocked by a transaction filter. Inactive revision ranges use `atomicRanges` to govern cursor placement only. All intentional revision editing goes through the nested editor.

### Separate `StateEffect` per mutation, not a generic update

Rather than a single `mutateAnnotation` effect, there is one effect per operation. This keeps undo/redo inversion explicit and local — each effect's inverse is declared adjacent to it in `invertedAnnotationFieldEffects`. The cost is some verbosity in effect declarations.

### Full annotation stored in `addAnnotation`/`removeAnnotation`

Both carry the complete annotation object (not just an ID). This lets the undo inversion restore exact prior state without a `startState` lookup.

---

## Known Limitations

- **Multi-selection not supported.** The system assumes one selection range per annotation (`selection.main`). Multi-cursor is not handled.
- **Thread updates are coarse-grained.** `updateThread` replaces the entire thread array. Undo of a single message edit reverts the entire thread.
- **One pending comment at a time.** `canCreateNewComment()` enforces a single draft (empty-thread) comment. Finer-grained locking is unresolved.
- **No explicit annotation status enum.** `thread.length === 0` means pending comment; there is no FSM. Acknowledged technical debt.
- **`addSuggestion` inversion uses `Math.max` on IDs.** Assumes IDs are sequential and increasing; works until suggestions are added in bulk.
- **`queueMicrotask` in `collapsedRevisionResolver`.** Necessary to avoid dispatching inside a `ViewPlugin.update`, but ordering relative to other queued microtasks is not guaranteed under rapid undo.
- **Deeply nested modal external-sync relies on `modalAnnotationStores`.** Each RevisionModal publishes its nested editor's annotations to a global per-level store (`modalAnnotationStores`). Child modals read from `modalAnnotationStores[stackIndex - 1]` instead of `$annotationsStore`. This chains correctly for undo cascades but adds a global store dependency that could be replaced with a more direct parent-child signal in the future.

---

## Settings

### App settings (`settings.svelte.ts`)

User preferences live in a Svelte 5 `$state` proxy (`appSettings`) persisted to localStorage under `"quillium-app-settings"`. Changes are applied immediately via `applySettings()` (which sets CSS custom properties on `document.documentElement`) and saved explicitly via `persistSettings()`.

| Setting | Type | Default | What it controls |
|---|---|---|---|
| `docFontFamily` | string | `"Georgia, serif"` | Editor body font (CSS custom property `--doc-font-family`) |
| `docFontSize` | number | `18` | Editor body font size (`--doc-font-size`) |
| `uiFontFamily` | string | `"system-ui, ..."` | UI chrome font (`--ui-font-family`) |
| `uiZoom` | number | `1` | `document.documentElement.zoom` |
| `selectTextInNestedEditor` | boolean | `true` | Auto-select text when opening a nested editor |
| `showNestedEditor` | boolean | `true` | Show inline nested editor in revision cards |
| `atomicRevisions` | boolean | `true` | Block direct editing of revision ranges in the main doc |
| `customQuickActions` | array | `[]` | User-defined quick actions for the AI sidebar |
| `titleVisibility` | enum | `"hover"` | Document title display: `"hover"`, `"always"`, `"never"` |
| `titleHoverDelay` | number | `350` | Milliseconds before title appears on hover |
| `titleLingerDuration` | number | `3000` | Milliseconds title stays visible after mouse leaves |
| `analyticsEnabled` | boolean | `true` | PostHog opt-in/out |
| `aiEnabled` | boolean | `false` | Whether AI features are active |
| `showShortcutHints` | boolean | `true` | Keyboard shortcut hints in the annotation panel |

Font settings are separate from AI settings (`src/lib/ai/settings.svelte.ts`), which store provider, model, and API key selection.

### Why localStorage instead of SQLite

App settings are presentation preferences, not document data. They need to be available before the Tauri backend finishes loading (fonts and zoom affect initial render), and they're per-device rather than per-document. localStorage is synchronous and available immediately, while SQLite requires an async `invoke()` round-trip. API keys are the exception: they go through the OS keychain via `src-tauri/src/keychain.rs` because localStorage is readable by any code in the webview.

### Font system (`settings/fonts.ts`)

`FONTS` is the single source of truth for font metadata: CSS families, categories, picker groups, "Our Pick" status, samples, and guide descriptions. Both `SettingsModal.svelte` and `FontGuideModal.svelte` derive their data from this array. Two runtime-resolved entries (system sans-serif, system monospace) are injected by `SettingsModal` at mount time using `document.fonts.check()` to detect what's installed.

### Settings UI

`SettingsModal.svelte` opens as a `<dialog>`. Changes apply live but aren't persisted until the user clicks Save. Closing without saving triggers a shake + red ring animation (same pattern as annotation alerts) and reverts to the last saved state. `FontGuideModal.svelte` is a sub-modal with font descriptions, categories, and samples.

---

## Error guard and crash recovery

### Why this exists

A writing app that loses user text is a catastrophic failure. The event log in SQLite is crash-safe for normal operations, but two scenarios can still cause data loss: (1) a bug that silently deletes large chunks of text in a single transaction, and (2) a JavaScript crash that prevents the persistence layer from running. The error guard addresses both.

### Suspicious change detection (`errorGuard.ts`)

`isSuspiciousDeletion(oldText, newText)` runs in `listeners.ts` *before* a transaction is persisted. If a single transaction batch deletes >= 20% of the document AND >= 100 characters, the pre-deletion editor state is saved as a named snapshot ("Before large deletion (auto)") via `createNamedSnapshot`, and an error banner directs the user to the version history page (`/history`) where they can restore from it. The thresholds are intentionally conservative: false positives just mean an extra snapshot, while false negatives mean lost text.

### Crash backup

`saveEmergencyBackup(reason)` captures whatever text is in `$documentContent` at the moment of the crash. Called from three places in `hooks.client.ts`:
- `window.addEventListener("error", ...)` — uncaught errors
- `window.addEventListener("unhandledrejection", ...)` — unhandled promise rejections (skips Svelte's benign `effect_orphan` error)
- `handleError` — SvelteKit's route-level error handler

Backup goes to `"quillium_backup_crash"` in localStorage. The crash banner (red) offers "Restore previous" to push the backup text back into the live editor, "Save copy" to download as plain text, and "Reload app".

### Crash restoration (`restore.ts`)

When the user clicks "Restore previous" in the crash banner, `restoreBackup(view, documentText)` replaces the entire document with the backup text. Existing annotations aren't just discarded: each annotation's anchor text is extracted before the swap, then re-matched in the restored document using `SearchCursor`. If found, the annotation is placed at the match position. If not found, it's placed at position 0 with a console warning. Nested annotations inside revision `VersionState` blobs are also healed the same way.

The restore transaction is tagged with `userEvent: "input.restore"` so the persistence layer's suspicious-change detector skips it (otherwise it would trigger another backup of the pre-restore state).

### Why localStorage for crash backups

Crash backups must survive the crash that triggered them. SQLite writes go through Tauri's IPC, which may not complete if the JavaScript runtime is in a bad state. localStorage writes are synchronous and handled by the webview engine, making them more likely to succeed during a crash. For non-crash scenarios (suspicious deletions), the SQLite snapshot system is sufficient since the persistence layer is still functional.

### Banner differentiation

The error banner has two distinct appearances:
- **Crash** (red, `OctagonAlert` icon): "Restore previous" + "Save copy" + "Reload app". Stack trace shown via "Show details".
- **Suspicious deletion** (amber, `AlertTriangle` icon): "View version history" navigates to `/history` where the user can restore from a named snapshot created automatically before the deletion.

---

## Library and document management

### Data model

The library uses a `documents` + `drafts` schema in SQLite:
- Each document has metadata (title, word count, preview text, tags, timestamps, `deletedAt` for soft-delete)
- Each document has one or more drafts (default one, created automatically)
- Document state (text + annotations) lives in the `events` + `snapshots` tables, keyed by draft

### Auto-derived document title

New documents start with the title "Untitled". On each save, `listeners.ts` checks whether the title is still "Untitled" and, if so, derives one from the first line of the document once either:
- the user presses Enter (creating a second line), or
- the first line contains at least 4 words.

The title is set to `firstLine.slice(0, 40)`. Once derived, the title is "owned" — it won't be overwritten automatically again. A separate `extractTitleFromStateJson` helper in `Editor.svelte` does the same extraction when loading a saved document whose title wasn't persisted in metadata.

If AI is enabled, the user can also click "Suggest" in the status bar title area to get an AI-generated title (also capped at 40 characters).

### Library page (`routes/library/+page.svelte`)

Two tabs: Library and Trash. Documents are displayed as cards in a grid with a search bar and a preview panel. The `ContinuePill` component shows a shortcut to the most recently edited document.

Operations: create, open, rename (via preview panel), trash (soft-delete), restore from trash, permanent delete. Trash has a configurable auto-empty period (`getTrashRetention`/`setTrashRetention` Rust commands).

### Navigation (`navigation.ts`)

Two functions: `goToLibrary()` and `goToEditor()`. Both set a `data-direction` attribute on `<html>` before calling SvelteKit's `goto()`, which CSS transitions use to animate the page slide direction (left for library, right for editor).

---

## Version History

`src/lib/editor/VersionHistory.svelte` is a full-screen snapshot browser. The route `routes/history/+page.svelte` is a thin wrapper that renders it directly.

### Layout

Two-panel layout: a read-only CodeMirror preview on the left, and a timeline sidebar on the right listing all snapshots grouped by date (Today / Yesterday / day-of-week / This month / month + year).

### Snapshot types

- **Auto-saved** — created automatically by the persistence layer every 50 events or 120 seconds. Accumulate indefinitely unless a retention policy is configured, in which case snapshots older than the policy threshold are pruned on app startup.
- **Named checkpoints** — created by the user via the "Name this version…" input in the top bar. Distinguished by a non-null `label` column. Persist until explicitly deleted by the user.

### Snapshot preview

Selecting a snapshot calls `loadSnapshotState(snapshot.id)` to fetch the state JSON blob, then reconstructs a read-only CodeMirror instance (`EditorState.readOnly.of(true)`) from that blob using `EditorState.fromJSON`. The preview editor is rebuilt via a Svelte `$effect` whenever the target DOM element or the loaded state JSON changes — no `tick()` needed.

### Restore

Clicking "Restore this version" requires a two-click confirmation (first click arms it, second click calls `restoreToSnapshot(draftId, snapshotId)`). After a successful restore the user is sent back to the editor via `goToEditor()`.

### Named checkpoint creation

The top bar has a text input and "Save" button. Saving calls `createNamedSnapshot(draftId, stateJson, eventId, label)` with the current editor state serialized via `view.state.toJSON(savedFields)`. Pressing Escape with unsaved label text triggers a shake animation rather than navigating away.

### Storage management

The sidebar shows the total snapshot storage size for the current draft. If it exceeds 1 GB (`STORAGE_WARN_BYTES`), a warning is displayed. Clicking the size badge opens a collapsible storage panel with:

- **Auto-prune retention** — a select dropdown that configures `setSnapshotRetention(days)` (options: Never, 30/60/90/180/365 days, or null for never).
- **Keep last N** — prune all but the most recent N snapshots via `pruneSnapshotsKeepLastN(draftId, n)`.
- **Older than N days** — prune all snapshots older than N days via `pruneSnapshotsOlderThan(draftId, days)`.

Both prune actions require a two-click confirmation.

### Tauri commands used

`listSnapshots`, `loadSnapshotState`, `labelSnapshot`, `createNamedSnapshot`, `restoreToSnapshot`, `getSnapshotStorageSize`, `getSnapshotRetention`, `setSnapshotRetention`, `pruneSnapshotsKeepLastN`, `pruneSnapshotsOlderThan`.

### Bootstrap

Navigating directly to `/history` (bypassing the editor) may leave `currentDraftId` unset. `bootstrapDraftId()` handles this by loading the first document's active draft so the snapshot list can populate correctly.

---

## Comment modals

`CommentModal.svelte` is the full-screen overlay for comment threads, parallel to `RevisionModal` and `DiffModal`. It uses the same `modalStack` and `modalAnnotationStores` pattern: root-level modals read from `$annotationsStore`, deeper modals read from `modalAnnotationStores[stackIndex - 1]`.

The modal includes an AI suggestion feature: the user can ask the AI to analyze the thread + selected text and suggest a response. Prompt building and streaming are extracted to `commentAi.ts` so both `Comment.svelte` (inline card) and `CommentModal.svelte` share the same logic.

---

## Revision modal keyguard

`revisionModalKeyguard.ts` exports `shouldHandleRevisionModalKeydown(event)`. The revision modal listens for `Ctrl-[`, `Ctrl-]` (version navigation) and `Mod+Enter` at the `<dialog>` level. But if a CodeMirror editor inside the dialog already handled the key (e.g. the nested editor consumed `Ctrl-[` for its own version navigation), the modal should not also handle it. The keyguard checks `event.defaultPrevented` and whether the target is inside a `.cm-editor` or is an `<input>`/`<textarea>`. This prevents double-handling of keyboard shortcuts.

---

## Keychain (`keychain.rs`)

API keys are stored in the OS keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service) via the `keyring` crate, keyed by `("com.bryanhu.quillium", provider_name)`. Three Tauri commands: `set_api_key`, `get_api_key`, `delete_api_key`.

This is intentionally separate from localStorage. API keys are secrets; localStorage is readable by any JavaScript in the webview (including potential XSS). The OS keychain requires user-level authentication and is not accessible from the web layer without going through the Tauri command bridge.

---

## PostHog analytics (`posthog.ts`)

Initialized on app load in production only (skipped in dev mode and when env vars are missing). Respects `appSettings.analyticsEnabled`: if the user disables analytics in settings, `posthog.opt_out_capturing()` is called immediately and persists across sessions. `syncAnalyticsOptOut()` is called from the settings modal when the toggle changes.

Events are captured throughout the app (see PostHog Events table below). Exception capture is wired into the crash handlers in `hooks.client.ts`.

---

## Auto-updater

Uses `@tauri-apps/plugin-updater` to check for updates on app launch. If an update is available, `UpdateBanner.svelte` renders a toast-style notification in the bottom-right corner with the version number and an "Update" button.

The update flow has three states:
1. **Available** — banner shows version number + "Update" button.
2. **Downloading** — button changes to "Downloading…" (disabled) after the user clicks. Uses `downloadAndInstall()` to reliably apply updates.
3. **Ready** — banner changes to "is ready — relaunch to finish" + "Relaunch" button. Clicking it calls `relaunch()` from `@tauri-apps/plugin-process`.

The banner can be dismissed at any point. If the update check fails, an error toast is shown.

---

## Changelog ("What's New")

A Discord-style "What's New" modal shown on startup when the user upgrades to a new **minor** version. Patch-only updates (e.g. `0.12.1` → `0.12.2`) do not trigger it — only a new minor (or major) version does, and only if a matching entry exists in `changelog.json`.

**Data flow:**

1. `+page.svelte` calls `tryShowChangelog()` after the beta disclaimer is accepted.
2. `minorVersion()` extracts the `"major.minor"` prefix from `__APP_VERSION__` (e.g. `"0.12.3"` → `"0.12"`).
3. That key is looked up in `src/lib/changelog.json`. If no entry exists, the modal is skipped.
4. The key is compared against `localStorage("quillium_changelog_seen")` via `isNewerMinor()`. If the current minor isn't newer, the modal is skipped.
5. On dismiss, the current minor version is saved to `localStorage` so it won't show again.

**Manual trigger:** The settings modal header has a "What's New" button that dispatches a `quillium:show-changelog` event, which calls `forceShowChangelog()` — this always shows the latest entry regardless of version checks.

**Adding a changelog entry:** Add a `"major.minor"` key to `src/lib/changelog.json` with `date` (display string like `"April 2026"`) and `content` (markdown string). The modal renders the markdown via `renderMarkdown()`.

**PostHog:** A `changelog_viewed` event with the version is captured on dismiss.

---

## Authentication

Quillium uses Supabase Auth for user identity, enabling real-time collaboration features. Authentication is optional — the app works fully offline without an account.

### Files

| File | Purpose |
|---|---|
| `src/lib/auth/supabase.ts` | Supabase client singleton with localStorage session persistence |
| `src/lib/auth/auth.svelte.ts` | Reactive auth state store using Svelte 5 `$state` runes |
| `src/lib/auth/AuthButton.svelte` | Top-right button: "Sign in" when logged out, avatar when logged in |
| `src/lib/auth/AuthModal.svelte` | Sign in / sign up form modal |
| `src/lib/auth/AvatarDropdown.svelte` | Dropdown menu with user info and logout |
| `src/lib/auth/NameEntryModal.svelte` | Display name prompt for anonymous users |
| `src/lib/auth/avatarUtils.ts` | `initials()` and `avatarColor()` for avatar rendering |

### Auth Flows

**Email/password sign up:**
```
User clicks "Sign in" → AuthModal opens → User fills form → signUp(email, password, displayName)
→ Supabase creates user with display_name in raw_user_meta_data → Session stored in localStorage
```

**Anonymous auth (for collaborators):**
```
User clicks "Join" on a shared document → NameEntryModal prompts for display name
→ signInAnonymously(displayName) → Supabase creates anonymous user with is_anonymous: true
→ Session stored in localStorage → Can join collab sessions without full account
```

### Session Persistence

Sessions are stored in localStorage (not SQLite) because:
1. Auth state must be available before Tauri backend loads
2. Supabase SDK expects synchronous storage access
3. Per-device sessions align with desktop app model

The `initAuth()` function is called once at app startup from `+page.svelte`. It checks for an existing session and subscribes to auth state changes.

### Environment Variables

| Variable | Purpose |
|---|---|
| `PUBLIC_SUPABASE_URL` | Supabase project URL |
| `PUBLIC_SUPABASE_PUBLISHABLE_ANON_KEY` | Supabase anon key for client-side auth |

If these are not configured, `supabaseConfigured` is `false` and auth features are disabled (GoLiveButton hidden, AuthButton hidden).

---

## Real-time Collaboration (Quillium Omni)

Quillium Omni enables Live Room collaboration between multiple Quillium instances. The local editor remains CodeMirror, but live document state is mirrored through a Yjs CRDT: main text lives in a shared `Y.Text`, annotations live in a recursive `Y.Map`, cursors use Yjs awareness, and transport is `y-websocket` with Supabase JWT auth.

The current product mode is intentionally owner-led: the owner's local SQLite draft is the source of truth when a room starts, joiners are ephemeral participants, and the room ends when the owner leaves. Persistent shared-document ownership, share links, and permissions are deferred.

### Architecture Overview

```mermaid
flowchart LR
    Owner["Owner<br/>CodeMirror EditorView"]
    Joiner["Joiner<br/>CodeMirror EditorView"]
    OwnerExtensions["Owner collabCompartment<br/>binding + annotations + awareness<br/>keeps existing CM history"]
    JoinerExtensions["Joiner collabCompartment<br/>binding + annotations + awareness + Y.UndoManager<br/>local persistence disabled"]
    OwnerDoc["Owner Y.Doc<br/>Y.Text document<br/>Y.Map annotations"]
    JoinerDoc["Joiner Y.Doc<br/>Y.Text document<br/>Y.Map annotations"]
    Relay["Relay<br/>../quillium-landing/relay<br/>native ws + y-protocols<br/>room = document UUID"]
    Supabase["Supabase<br/>JWT auth + sync_documents<br/>Yjs persistence tables"]

    Owner --> OwnerExtensions --> OwnerDoc
    Joiner --> JoinerExtensions --> JoinerDoc
    OwnerDoc <-->|"Yjs websocket protocol"| Relay
    JoinerDoc <-->|"Yjs websocket protocol"| Relay
    Relay --> Supabase
```

### Files

| File | Purpose |
|---|---|
| `src/lib/collab/index.ts` | Public API: `enableCollab()`, `disableCollab()`, `registerDocumentForCollab()` |
| `src/lib/collab/yjsProvider.ts` | Creates/destroys `Y.Doc` and `WebsocketProvider`, passes JWT auth, tracks reconnect state |
| `src/lib/collab/yjsBinding.ts` | Bidirectional `Y.Text` to CodeMirror document sync |
| `src/lib/collab/yjsAnnotations.ts` | Bidirectional recursive `Y.Map` to `annotationField` sync |
| `src/lib/collab/annotationSchema.ts` | Converts CodeMirror annotations to/from recursive Yjs nodes |
| `src/lib/collab/relativePosition.ts` | Encodes annotation and cursor anchors as Yjs relative positions |
| `src/lib/collab/awareness.ts` | Remote cursor rendering, mapped nested-editor cursor presence, and follow-mode scrolling through Yjs awareness |
| `src/lib/collab/yjsUndo.ts` | Y.UndoManager integration for joiner undo and nested subtree scope |
| `src/lib/collab/types.ts` | `CollabSession`, `CollabState`, Yjs annotation, and awareness types |
| `src/lib/collab/store.ts` | Svelte stores: `collabState`, `collabSession`, presence users, followed client, owner-left, joiner state |
| `src/lib/collab/GoLiveButton.svelte` | UI: "Go Live" toggle, copy ID, join by ID |

### Data Model (Supabase)

| Table | Purpose |
|---|---|
| `users` | User profiles (populated by database trigger on auth.users insert) |
| `sync_documents` | Document registry: `id`, `owner_id`, `title` |
| `yjs_documents` | Full encoded Yjs document snapshots (`state_update`, `state_vector`) |
| `yjs_updates` | Incremental encoded Yjs updates between snapshots |
| `collab_updates` | Legacy OT table from earlier `@codemirror/collab` planning, not used by current Yjs runtime |
| `collab_snapshots` | Legacy OT snapshot table, not used by current Yjs runtime |
| `shares` | Access grants with tokens (v2, not yet implemented in the app UI) |

Runtime collaboration uses the `sync_documents` row to register the room and authorize relay participation. The relay stores live Yjs state in `yjs_documents` and `yjs_updates` for durability, but Live Room startup still treats the owner's local SQLite draft as authoritative: when the owner connects, the app replaces relay text with the local document.

### Relay Responsibilities

The relay lives outside this app repo at `../quillium-landing/relay`.

| Relay file | Responsibility |
|---|---|
| `src/server.ts` | Handles HTTP `/health`, validates WebSocket upgrades, creates rooms, wires persistence |
| `src/auth/middleware.ts` | Verifies Supabase JWTs and checks `sync_documents.owner_id` |
| `src/yjs/rooms.ts` | Manages in-memory `Y.Doc` rooms, loads/persists state, clears rooms after owner disconnect |
| `src/yjs/sync.ts` | Implements Yjs sync and awareness protocol messages over native `ws` |
| `src/persistence/yjsUpdates.ts` | Persists `Y.encodeStateAsUpdate()` snapshots and incremental updates |

The client uses `y-websocket`'s `WebsocketProvider`, while the relay implements the compatible protocol directly with `ws`, `y-protocols/sync`, and `y-protocols/awareness`.

### Collab Extension Integration

The collab system uses CodeMirror's Compartment pattern for hot-swapping. `src/lib/editor/extensions.ts` mounts `collabCompartment.of([])` in the base extension stack; `enableCollab()` replaces it with Yjs-backed extensions after the provider syncs.

```typescript
// extensions.ts - initially empty
collabCompartment.of([])

// enableCollab() - after createYjsProvider() syncs
const binding = createYjsBinding(ytext);
const { extension: undoExt, undoManager } = createYjsUndoExtension(ytext, ymap);
const awarenessExt = createAwarenessExtension(awareness, ytext, displayName, cursorColor);
const annotationSync = createAnnotationSyncPlugin(ytext, ymap, clientID, mainIdMap);

view.dispatch({
    effects: [
        collabCompartment.reconfigure(
            asOwner
                ? [binding, awarenessExt, annotationSync]
                : [binding, undoExt, awarenessExt, annotationSync],
        ),
        ...(asOwner ? [] : [historyCompartment.reconfigure([])]),
    ],
});

// disableCollab() - back to empty, restore standard CM history
view.dispatch({
    effects: [
        collabCompartment.reconfigure([]),
        historyCompartment.reconfigure(history({ newGroupDelay: 250 })),
    ],
});
```

### Owner vs Joiner Flow

**Owner goes live:**

1. User clicks `Go Live`.
2. `GoLiveButton.svelte` creates a named snapshot: `"Before going live (auto)"`.
3. `registerDocumentForCollab(draftId, userId, title)` upserts `sync_documents`.
4. `createYjsProvider(draftId)` opens `WebsocketProvider` with the Supabase JWT.
5. After provider sync, the owner replaces relay `Y.Text` with the local CodeMirror document.
6. `enableCollab()` installs Yjs binding, awareness, and annotation sync.
7. UI sets `isLive = true` and shows `"You're live!"`.

**Joiner joins by ID:**

1. User pastes a document UUID; `joinById()` validates the format.
2. The app captures prior draft ID and editor state in `joinerPriorView`.
3. `currentDraftId = null` and `isCollabJoiner = true`, so persistence listeners skip live edits.
4. `createYjsProvider(docId)` opens `WebsocketProvider` with the Supabase JWT.
5. After provider sync, the joiner replaces local editor contents with relay `Y.Text`.
6. Local annotations are cleared, then Yjs annotation sync projects shared annotations into CodeMirror.
7. `enableCollab()` installs Yjs binding, `Y.UndoManager`, awareness, and annotation sync.
8. UI sets `isLive = true` and shows `"Joined shared document"`.

**Joiner leaves or owner kicks/disconnects:**

1. `disableCollab(view)` calls `disconnectYjsProvider()`, destroying the provider and `Y.Doc`.
2. `collabCompartment` is reconfigured back to `[]`.
3. `historyCompartment` restores standard CodeMirror history.
4. Joiners restore the captured editor snapshot and navigate back to the prior draft/library view.

### Sync Loop

**Local text edit:**

CodeMirror transaction -> `yjsBinding` update hook -> skip Yjs-originated transactions -> write `Y.Text` inside a `"local"` transaction -> provider broadcasts the Yjs update.

**Remote text edit:**

Provider applies remote Yjs update -> `Y.Text.observe()` fires -> `yjsBinding` converts the delta to CodeMirror changes -> dispatch is marked with `yjsAnnotation` to prevent feedback.

**Local annotation change:**

`annotationField` effect -> `yjsAnnotations` update hook -> diff CodeMirror annotations against `Y.Map` -> write add/remove/thread/version/position changes to Yjs with origin `"local"`.

**Remote annotation change:**

`Y.Map.observeDeep()` -> `yjsAnnotations` observer -> skip `"local"` origin -> project recursive Yjs annotation nodes back to `annotationField` -> dispatch CodeMirror effects marked as Yjs-originated.

### Remote Cursors

Remote cursors are rendered Google Docs-style with colored carets and name labels. `awareness.ts` stores cursor anchors as encoded Yjs relative positions, not absolute CodeMirror positions, so cursors track concurrent edits correctly.

Flow: local selection change -> throttled `createAwarenessExtension` update -> encode selection as RelativePosition bytes -> `awareness.setLocalStateField("cursor", ...)` -> provider broadcasts awareness update -> remote peer decodes against its `Y.Text` -> `RemoteCursorWidget` renders caret and label.

`createAwarenessExtension` also accepts optional position mappers:

- `toSharedPosition(localPos, state)` converts an editor-local cursor position to a shared document position before encoding it as a Yjs RelativePosition.
- `fromSharedPosition(sharedPos, state)` converts a decoded shared document position back into the current editor's coordinate space before rendering a cursor widget.

The main editor uses identity mapping. Nested revision editors install the same awareness extension with mapping functions that translate through the parent revision range: nested `0` maps to `rev.selection.main.from`, and remote shared positions outside `[rev.from, rev.to]` are hidden from that nested editor. This lets cursor presence work inside annotation editors without giving nested editors their own independent Yjs text binding.

Presence UI is derived from the same awareness states. `awareness.ts` publishes deduped remote users to `collabPresenceUsers`, and `StatusBar.svelte` renders small colored avatar buttons while collab is active. Clicking an avatar toggles `followedClientId`; every awareness tick asks the active awareness extension to scroll the relevant `EditorView` toward that collaborator's decoded cursor. If the followed collaborator disappears from awareness, follow mode clears itself.

### Connection States

| State | Meaning |
|---|---|
| `disconnected` | Not connected to relay |
| `connecting` | WebsocketProvider handshake/sync in progress |
| `connected` | Active session, synced |
| `syncing` | Reserved for pending-update UI |
| `reconnecting` | Lost connection, auto-reconnect in progress |
| `error` | Connection failed after max retries |

`yjsProvider.ts` updates `collabState` from provider `status`, `sync`, and `connection-close` events. `GoLiveButton.svelte` shows toasts for reconnect/reconnect-failed transitions, and `StatusBar.svelte` shows the current connection indicator:
- Green dot + "Synced" when `connected`
- Yellow dot + "Connecting..." when `connecting` or `reconnecting`
- Red dot + "Disconnected" when `error`

After five reconnect attempts, the provider enters `error`, disconnects, and the user must start a new live session.

### Owner Disconnect Handling

Live Room mode ends when the owner leaves. The relay signals owner disconnect through the websocket close reason, `enableCollab()` calls `handleOwnerLeft()`, and `GoLiveButton.svelte` reacts to `ownerLeftSignal`:

Flow: provider `connection-close` reason is `"Owner left"` -> `handleOwnerLeft()` -> increment `ownerLeftSignal` -> `disconnectYjsProvider()` -> `GoLiveButton` effect calls `disableCollab(view)` -> toast `"The owner ended the session"`.

### Environment Variables

| Variable | Purpose |
|---|---|
| `PUBLIC_RELAY_URL` | WebSocket relay server URL |
| `PUBLIC_SUPABASE_URL` | Supabase project URL (for sync_documents table) |
| `PUBLIC_SUPABASE_PUBLISHABLE_ANON_KEY` | Supabase anon key |

If `PUBLIC_RELAY_URL` is not configured, `relayConfigured` is `false` and the GoLiveButton is hidden.

### Known Limitations

- **Live Room mode only** — session ends when owner disconnects. Shared Document mode (server as source of truth) is deferred to v2.
- **No local persistence for joiners** — joiners are restored to their prior local draft/library view after leaving the room.
- **No offline queue** — if reconnect attempts are exhausted, the session enters `error` and must be restarted.
- **No sharing UI** — joiners must manually paste document UUID. Share links and permissions are deferred to v2.

---

## Yjs Sync Layer (Phase 8)

The current collaboration layer uses Yjs CRDTs for text, annotations, and cursors instead of the earlier planned `@codemirror/collab` OT protocol. This gives the editor conflict-free merging primitives, though Quillium does not yet expose an offline edit queue when relay reconnection fails.

### Architecture

```mermaid
flowchart LR
    CM["CodeMirror document"]
    AF["annotationField"]
    CursorUI["Remote cursor UI"]

    subgraph YDoc["Y.Doc"]
        YText["Y.Text<br/>document"]
        YMap["Y.Map<br/>annotations"]
        Awareness["Awareness<br/>cursor + user"]
        Undo["Y.UndoManager<br/>local undo scope"]
    end

    Relay["native ws relay<br/>../quillium-landing/relay"]

    CM <-->|"yjsBinding.ts"| YText
    AF <-->|"yjsAnnotations.ts"| YMap
    CursorUI <-->|"awareness.ts"| Awareness
    Undo -. "tracks" .-> YText
    Undo -. "tracks" .-> YMap
    YDoc <-->|"WebsocketProvider + JWT"| Relay
```

### Files

| File | Purpose |
|---|---|
| `yjsProvider.ts` | Creates Y.Doc, Y.Text, Y.Map, WebsocketProvider with JWT auth |
| `yjsBinding.ts` | Bidirectional Y.Text ↔ CodeMirror sync ViewPlugin |
| `yjsAnnotations.ts` | Bidirectional Y.Map ↔ annotationField sync ViewPlugin |
| `annotationSchema.ts` | Converters: `codeMirrorToYjsAnnotation()`, `yjsAnnotationToCodeMirror()` |
| `relativePosition.ts` | `absoluteToRelative()`, `relativeToAbsolute()` for position anchoring |
| `awareness.ts` | Remote cursor rendering via Yjs awareness protocol |
| `yjsUndo.ts` | Unified undo stack via Y.UndoManager (text + annotations) |
| `types.ts` | `YjsAnnotationNode`, `CollabSession`, awareness state types |

### YjsAnnotationNode Shape

Annotations are stored as recursive Y.Map structures:

```typescript
type YjsAnnotationNode = Y.Map<unknown>;

// Runtime keys shared by all annotation nodes:
{
    id: string;
    _type: "comment" | "suggestion" | "revision";
    startPos: Uint8Array; // encoded RelativePosition
    endPos: Uint8Array;   // encoded RelativePosition
    thread: Y.Array<MessageObject>;
    annotations: Y.Map<YjsAnnotationNode>; // nested annotations
}

// Suggestion-only keys:
{
    replacements: Y.Array<string>;
    author: string | null;
}

// Revision-only keys:
{
    versions: Y.Map<string, Y.Map<unknown>>;
    // versionNode keys: { text: Y.Text, label?: string, annotations: Y.Map<YjsAnnotationNode> }
    activeVersionIndex: number;
}
```

### Sync Flow

**Y.Text to CodeMirror (remote edits):**
1. `WebsocketProvider` receives and applies a remote Yjs update.
2. `Y.Text.observe()` fires.
3. `yjsBinding` ignores local-origin changes, converts the Yjs delta to CodeMirror changes, and dispatches with `yjsAnnotation.of(true)` to prevent feedback.

**CodeMirror to Y.Text (local edits):**
1. A user edit reaches the `yjsBinding` ViewPlugin.
2. Transactions already marked with `yjsAnnotation` are ignored.
3. Local text changes are written to `Y.Text` inside `ydoc.transact(..., "local")`.
4. The `"local"` origin lets `Y.UndoManager` track the edit and prevents observer re-entry.

**Y.Map to annotationField (remote annotations):**
1. `Y.Map.observeDeep()` fires.
2. `yjsAnnotations` ignores local-origin changes.
3. Shallow key changes rebuild via `replaceAllAnnotations`; thread appends use `updateThread`; version changes rebuild the projected annotation.

**annotationField to Y.Map (local annotations):**
1. User action dispatches an annotation effect such as `addAnnotation`.
2. `yjsAnnotations.update()` intercepts the change.
3. `codeMirrorToYjsAnnotation()` builds the recursive Yjs node.
4. The node is written to `Y.Map` inside a `"local"` Yjs transaction.

### RelativePosition Anchoring

Annotation positions use Yjs RelativePosition instead of absolute indices. This survives concurrent edits:

```typescript
// Save: absolute CM selection → encoded RelativePosition
const { startPos, endPos } = absoluteToRelative(ytext, selection);
// startPos, endPos are Uint8Array

// Load: encoded RelativePosition → absolute CM selection
const selection = relativeToAbsolute(ydoc, ytext, startPos, endPos);
// Returns null if anchored text was deleted
```

### Awareness (Remote Cursors)

Remote cursors use Yjs awareness protocol with position anchoring:

1. `createAwarenessExtension` observes local cursor changes.
2. Cursor positions are encoded as RelativePositions.
3. The local awareness state stores `{ anchorPos, headPos }` as JSON-safe byte arrays.
4. Peers receive the awareness update, decode positions against their own `Y.Text`, and render a `RemoteCursorWidget`.

Position mapping: When doc changes arrive, cursor positions are re-resolved from RelativePosition, so they track concurrent edits correctly.

Nested annotation editors use the same extension with `toSharedPosition`/`fromSharedPosition` hooks. Those hooks translate between nested-editor offsets and root document offsets through the parent revision's current `selection.main` range. A remote cursor outside the revision range returns `null` from `fromSharedPosition`, so it is not rendered in that nested editor.

Follow mode is awareness-driven, not a separate transport. `collabPresenceUsers` stores the deduped remote awareness users shown in the status bar. Clicking a collaborator avatar sets `followedClientId`, and each awareness tick scrolls the active editor view toward that user's decoded cursor. If the target client disappears, the followed id is cleared.

### Unified Undo (D-83)

Y.UndoManager tracks both Y.Text and Y.Map changes in a single stack:

```typescript
const undoManager = new Y.UndoManager([ytext, ymap], {
    trackedOrigins: new Set(["local"]), // Only undo local changes
    captureTimeout: 500, // Merge rapid edits
});
```

- `Mod-z` → `undoManager.undo()` (undoes text + annotation changes together)
- `Mod-Shift-z` / `Mod-y` → `undoManager.redo()`
- `breakUndoCapture()` forces a new undo step (used at modal boundaries)
- `addSubtreeToUndoScope()` registers nested editor Y.Text with the stack (Phase 8.5c)

### ID Mapping

CodeMirror uses numeric annotation IDs; Yjs uses string IDs. `AnnotationIdMap` maintains bidirectional mapping:

```typescript
class AnnotationIdMap {
    getOrCreateCmId(yjsId: string): number  // Auto-allocates CM ID
    getOrCreateYjsId(cmId: number, clientId: string): string
    getYjsId(cmId: number): string | undefined
    getCmId(yjsId: string): number | undefined
    register(yjsId: string, cmId: number): void
    remove(yjsId: string): void
}
```

### Test Harness

`test-helpers/twoPeerHarness.ts` provides a two-peer test harness:

```typescript
const peerA = makePeer("A", "initial text");
const peerB = makePeer("B", "");

const disconnect = connect(peerA, peerB);
// Peers now sync bidirectionally

peerA.view.dispatch({ changes: { from: 0, insert: "Hello " } });
// peerB.view.state.doc.toString() === "Hello initial text"

disconnect();
teardown(peerA);
teardown(peerB);
```

Key patterns:
- Origin-based filtering: updates marked "remote" skip local undo logic
- Bidirectional state sync on connect
- Explicit teardown prevents memory leaks

---

## Native App Menu

`lib.rs` builds a native application menu with five submenus: Quillium, File, Edit, View, and Window.

| Submenu | Custom items | Accelerator |
|---|---|---|
| Quillium | Settings… | `Cmd+,` / `Ctrl+,` |
| File | Library | `Cmd+O` / `Ctrl+O` |
| Edit | (standard: Undo, Redo, Cut, Copy, Paste, Select All) | — |
| View | Version History | `Cmd+Shift+H` / `Ctrl+Shift+H` |
| Window | (standard: Minimize, Maximize, Close) | — |

Custom menu items emit Tauri events (`menu:settings`, `menu:library`, `menu:history`) to the frontend webview. `+page.svelte` listens for these events via `@tauri-apps/api/event` and dispatches the appropriate action (toggle `$settingsOpen`, call `goToLibrary()`, or call `goToHistory()`).

The `settingsOpen` store is exported from `stores.ts` so that both the native menu handler and in-app UI (StatusBar gear button, `Cmd+,` keydown) can toggle it.

---

## Document Export

`export.ts` provides document export in four formats:

| Format | Extension | Contents |
|---|---|---|
| Plain text | `.txt` | Document text only |
| Text + annotations | `.txt` | Document text + annotations as JSON after a `---` separator |
| JSON | `.json` | Structured object with title, timestamp, text, and annotations |
| Markdown | `.md` | Document text with annotations as footnotes |

`exportDocument(view, format)` serializes the current editor state, derives the filename from the document title, and triggers a browser download via `Blob` + `<a>` click.

---

## PostHog Events

| Event | When | File |
|---|---|---|
| `app_session_started` | Editor mounts with a document | `Editor.svelte` |
| `editor_undo` | User triggers undo from native menu | `Editor.svelte` |
| `editor_redo` | User triggers redo from native menu | `Editor.svelte` |
| `editor_select_all` | User triggers select all from native menu | `Editor.svelte` |
| `ai_sidebar_opened` | User opens AI sidebar to a mode | `AISidebar.svelte` |
| `ai_message_sent` | Any AI request is dispatched | `chatFactory.ts` |
| `ai_chat_message_sent` | User sends AI chat message | `Chat.svelte` |
| `ai_chat_quick_prompt_used` | User uses a chat quick prompt | `Chat.svelte` |
| `ai_feedback_requested` | User requests AI feedback | `Feedback.svelte` |
| `ai_feedback_quick_prompt_used` | User uses a feedback quick prompt | `Feedback.svelte` |
| `ai_revise_requested` | User triggers AI revision | `Revise.svelte` |
| `ai_revise_quick_prompt_used` | User uses a revise quick prompt | `Revise.svelte` |
| `context_generated` | AI context is generated for a document | `clientStreams.ts` |
| `context_cleared` | User clears document context | `DocumentContext.svelte` |
| `annotation_created` | AI creates a comment, suggestion, or revision | `chatFactory.ts` |
| `comment_created` | User submits a new comment | `PreComment.svelte` |
| `comment_ai_suggestion_requested` | User requests AI suggestion in thread | `Comment.svelte`, `CommentModal.svelte` |
| `comment_modal_opened` | User opens full-screen comment modal | `Comment.svelte` |
| `suggestion_applied` | User applies an AI suggestion | `Suggestion.svelte` |
| `suggestion_branched` | User converts suggestion to revision | `Suggestion.svelte` |
| `suggestion_diff_viewed` | User views a suggestion diff inline | `Suggestion.svelte` |
| `suggestion_diff_modal_opened` | User opens the full-screen diff modal | `Suggestion.svelte` |
| `revision_version_created` | User creates a new revision version | `Revision.svelte`, `RevisionModal.svelte` |
| `annotation_deleted` | User deletes a comment, suggestion, or revision | `Comment.svelte`, `Suggestion.svelte`, `Revision.svelte` |
| `nested_editor_flush_to_parent_meaningful` | Nested editor syncs a meaningful change to parent | `NestedEditorController.ts` |
| `dictionary_synonym_replaced` | User replaces word with synonym | `DictionaryPopover.svelte` |
| `dictionary_chip_lookup` | User clicks a synonym/antonym chip to look it up | `DictionaryPopover.svelte` |
| `dictionary_open_in_chat` | User sends word to AI chat from dictionary | `DictionaryPopover.svelte` |
| `dictionary_describe_lookup` | User looks up a custom description in dictionary | `DictionaryPopover.svelte` |
| `modal_stack_duplicate_push` | Duplicate modal push was prevented | `stores.ts` |
| `settings_saved` | User saves settings | `SettingsModal.svelte` |
| `tutorial_completed` | User completes onboarding | `Tutorial.svelte` |
| `tutorial_skipped` | User skips onboarding | `Tutorial.svelte` |
| `ai_settings_provider_changed` | User changes AI provider | `AISettings.svelte` |
| `ai_settings_model_changed` | User changes AI model | `AISettings.svelte` |
| `draft_scrapped` | User scraps current draft | `Save.svelte` |
| `library_viewed` | User navigates to the library page | `library/+page.svelte` |
| `document_created` | User creates a new document | `library/+page.svelte` |
| `document_opened` | User opens a document from library | `library/+page.svelte` |
| `document_renamed` | User renames a document | `library/+page.svelte` |
| `document_trashed` | User moves document(s) to trash | `library/+page.svelte` |
| `document_restored` | User restores document(s) from trash | `library/+page.svelte` |
| `document_deleted_permanently` | User permanently deletes document(s) | `library/+page.svelte` |
| `document_exported` | User exports a document | `export.ts` |
| `reader_persona_toggled` | User enables/disables a reader persona | `Readers.svelte` |
| `reader_chattiness_changed` | User cycles a persona's chattiness level | `Readers.svelte` |
| `reader_persona_created` | User creates a custom reader persona | `Readers.svelte` |
| `reader_persona_removed` | User deletes a custom reader persona | `Readers.svelte` |
| `reader_persona_review_completed` | A single persona finishes its feedback stream | `chatFactory.ts` |
| `autoai_toggled` | User enables/disables AutoAI | `AutoAIWidget.svelte` |
| `autoai_mode_changed` | User switches auto/manual mode | `AutoAIWidget.svelte` |
| `autoai_manual_review_triggered` | User clicks "Review now" | `AutoAIWidget.svelte` |
| `autoai_settings_changed` | User changes AutoAI depth or annotation types | `AutoAIWidget.svelte` |
| `crash_backup_restored` | User restores from crash backup | `ErrorBanner.svelte` |
| `crash_backup_downloaded` | User downloads crash backup | `ErrorBanner.svelte` |
| `crash_banner_dismissed` | User dismisses the error banner | `ErrorBanner.svelte` |
| `crash_app_reloaded` | User clicks "Reload app" after crash | `ErrorBanner.svelte` |
| `editor_replay_event_failed` | A single event fails during event log replay | `replay.ts` |
| `editor_replay_completed_with_failures` | Event log replay finishes with one or more failures | `replay.ts` |
| `update_available` | App detects a new version on launch | `+page.svelte` |
| `update_started` | User clicks "Update" to begin download | `+page.svelte` |
| `update_ready` | Download completes, relaunch offered | `+page.svelte` |
| `update_relaunched` | User clicks "Relaunch" | `+page.svelte` |
| `update_dismissed` | User dismisses the update banner | `+page.svelte` |
| `update_failed` | Update download/install fails | `+page.svelte` |
