# View plugins and extensions

[Desktop annotations/index.ts](../packages/desktop/src/lib/editor/plugins/annotations/index.ts)
registers view plugins and facet extensions that react to editor updates. Shared
annotation decorations live in
[annotationDecorations.ts](../packages/share/src/core/annotationDecorations.ts).
The field owns annotation data; these extensions control how it looks and how
the cursor interacts with it. Read [annotations](annotations.md) for the data model.

## annotationDecorations

Builds `DecorationSet`s for all annotation types on every `selectionSet`, `docChanged`, or annotation state change. Applies CSS classes:

| Class | State |
|-------|-------|
| `cm-comment` / `cm-comment-active` | Comment annotation |
| `cm-revision` / `cm-revision-active` | Revision annotation |
| `cm-suggestion` / `cm-suggestion-active` | Suggestion annotation |

Inactive revisions use a thin, muted purple underline that returns to full strength on hover.
Each nested revision in the displayed version adds another underline beneath its own passage
(two lines for a child, three for a grandchild). The shared decoration builder projects these
version-local ranges into the containing editor; comments and inactive versions add no lines.
Touch devices keep the full underline; active revisions retain their purple background, and
their nested passages keep the depth lines in a deeper purple on top of it.
The shared read-only renderer follows the same treatment, and legacy preview buttons also reveal
the underline on keyboard focus. Empty-revision markers remain visible.

Active state is determined by `getActiveAnnotation()`, the annotation whose range contains the cursor. If multiple ranges overlap, the narrowest one wins.

## revisionAtomicRanges

Registered via `EditorView.atomicRanges.of(...)` (a facet provider, not a `ViewPlugin`). When `appSettings.atomicRevisions` is enabled, marks **all** revision ranges as atomic. The cursor jumps over the entire span instead of entering it.

`atomicRanges` governs cursor placement. It does not prevent edits.

## collapsedRevisionResolver

Monitors for revision ranges that collapsed to `from === to` in a `docChanged` transaction (not annotated `revisionInternalEdit`). Collects all collapsed revisions and, in a single `queueMicrotask`-deferred dispatch:

1. Removes all collapsed revisions via `removeAnnotation` effects
2. Tags `Transaction.addToHistory.of(false)` to avoid a new history entry
3. Tags `_revisionCleanup.of(true)` so `invertedAnnotationFieldEffects` skips cleanup

Undo is handled by `_restoreAnnotation` effects stored on the deletion transaction. Cmd+Z re-inserts deleted text and restores all revisions in one step.

The `queueMicrotask` defers past the current update cycle (required to avoid "dispatch inside update"). The stale-state guard prevents double-dispatch if Cmd+Z fires synchronously before the microtask.

## boundaryInsertNudge

Fires a `revision-boundary-nudge` UI event when text is inserted immediately at a revision's `from` or `to` boundary. This signals the revision card to show a brief hint pointing the user to the nested editor.

Skipped for transactions annotated `revisionInternalEdit` (programmatic insertions).

## Markdown preview

A ViewPlugin that renders markdown with live preview:

- Hides syntax markers (*, **, #) when cursor is not in the node
- Applies styling to heading lines, bold, italic text
- Maintains editability while showing formatted preview

Works with the Lezer markdown parser via `syntaxTree()`.

## Markdown formatting

Keybindings for markdown formatting:

| Key | Action |
|-----|--------|
| `Mod-b` | Toggle bold (`**text**`) |
| `Mod-i` | Toggle italic (`*text*`) |
| `Mod-u` | Toggle underline (HTML `<u>`) |

Handles selection wrapping and cursor placement for empty selections.

## Harper grammar checking

Grammar and style checking integration:

| File | Purpose |
|------|---------|
| `harperLinter.ts` | CM linter extension, harper.js integration |
| `lint.ts` | Issue severity mapping |
| `lintKindColor.ts` | Color coding by issue type |
| `HarperTooltip.svelte` | Hover tooltip UI |

## Extension assembly

[extensions.ts](../packages/desktop/src/lib/editor/extensions.ts) assembles the
root and nested editor extensions and declares their serialized fields. Nested
editors disable their own history and persistence. The root editor installs
persistence listeners and captures the document's undo-after-restart policy.

The custom persistent-history adapter stores Quillium effects alongside
CodeMirror changes and selections. Unsupported or incomplete saved history starts
a fresh undo stack while retaining content. See
[persistence](persistence.md#undo-history-policy-022) for the policy, exact replay,
and legacy-history handling.

## Compartments

CodeMirror Compartments enable hot-swapping extensions:

| Compartment | Purpose |
|-------------|---------|
| `historyCompartment` | Swapped out during collab (Yjs has its own undo) |
| `collabCompartment` | Empty → Yjs binding + awareness when going live |

Every live participant, including the document owner, uses the same scoped `Y.UndoManager`. It
tracks only that participant's local Yjs transactions while rebasing them over remote text,
annotation, and version-group updates. On disconnect, Quillium installs a fresh CodeMirror history
stack rather than reviving the pre-collaboration branch.

`persistentHistoryStateExtension` stays outside `historyCompartment` so a temporary collaboration
reconfiguration cannot resurrect stale pre-collaboration history. The runtime history initializer
lives inside the compartment and is removed together with CodeMirror history.

## Dense annotation columns

The desktop floating column keeps lightweight card shells for its complete
filtered list. Above 100 annotations, an IntersectionObserver per column mounts
full card content near the viewport, with 900px overscan. Distant shells retain
their last measured height (128px before first measurement) so the column stays
scrollable. Active, pending, and focused cards always mount. Unfinished message
edits also keep their card mounted until saved or cancelled; the message component
reports that lifetime through a bubbling `thread-message-editing` event. Reply
drafts live in the existing shared draft store and survive unmounting. Completed,
unfocused cards can unmount again outside the overscan region. Shell count stays
linear. Inline modal lists keep their existing rendering behavior.

The shared column controller uses one ResizeObserver with incremental card
registration owned by card mount/unmount actions, without reactive refresh passes.
Loading a nearby card can update layout without resetting manual
column scrolling; editor-anchor changes and active-card height changes still
reveal the active card. Editor-shell scroll events explicitly reposition cards
because viewport-only updates no longer republish annotation stores.

`tests/e2e/editorScaling.pw.ts` checks dense mounting, distant activation, undo/redo,
and unfinished replies across column scrolling. Its optional timing matrix uses
25k/250k-character drafts with 0/100/1,000 comments. Run it against a production
build with one worker (public environment variables must be configured, or use
the documented local build override):

```bash
CI=1 QUILLIUM_PERF=1 bun run desktop:test:e2e tests/e2e/editorScaling.pw.ts --workers=1 --retries=0
```

`CI=1` makes the existing Playwright config build and serve a production preview.
The optional matrix attaches JSON with initial load, full-card count, seven
20-character browser input timings, and median input latency, asserting a 50ms
median budget. Ordinary CI leaves wall-clock checks disabled and runs the
structural/behavior regressions. The [dense-draft capture](pr-screenshots/editor-scaling-dense.png)
shows the resulting floating columns. Compare performance on the same machine; the
Tauri persistence mock does not measure SQLite or WebKit latency.
