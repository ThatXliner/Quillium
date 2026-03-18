# RevisionModal — Architecture Notes & Bug Analysis

## Current State

`RevisionModal.svelte` is ~1207 lines as of the `no-stacked-modal` branch. It's doing too much
in one file but the logic is genuinely complex and tightly coupled. This doc captures everything
known so future work doesn't have to re-derive it.

---

## Active Bugs (as of 2026-03-17)

### Bug 1: `state_proxy_equality_mismatch` warning

**Symptom:** Svelte console warning about `$state(...)` proxy identity mismatch with `===`.

**Probable location:** `modalStack.push()` in `stores.ts` (lines ~334–344):
```ts
const isDuplicate = s.some(
    (existing) =>
        existing.parentView === entry.parentView  // ← comparing proxied vs plain EditorView
```
When `s` comes from the writable store's internal `$state`, `existing.parentView` may be a
Svelte proxy wrapping the EditorView, while `entry.parentView` is the raw EditorView. `===`
fails even though they refer to the same underlying object.

**Also possible:** `crumbSelectedVersions` effect in RevisionModal reads `crumb.parentView.state`
from `$modalStack` (a Svelte store). Store values are NOT proxied by default — only `$state(...)`
is. So if the store is a plain writable, this warning is more likely from somewhere else.

**Fix:** Use a stable identity that doesn't get proxied for comparison — e.g. store a numeric ID
on each EditorView or compare by `revisionId + stackIndex` instead of `parentView` reference.

Or, in `modalStack.push`, use `$state.raw(existing).parentView` (Svelte 5 escape hatch) or
add a `.id` property to EditorView instances.

---

### Bug 2: `Maximum call stack size exceeded` when creating a nested revision inside the modal

**Symptom:** Calling `Mod-Alt-k` (or equivalent) to create a sub-revision inside the revision
modal causes a stack overflow.

**Trigger path:**
1. User selects text inside nested editor, presses `Mod-Alt-k`
2. `makeParentUndoKeymap` → `publishAnnotationUiEvent({ type: "revision-open-nested-editor", command: { revisionId, type: "revision", ... } })`
3. `annotationUiEvent` store updates
4. **Sensor Effect C** in `RevisionModal` fires: `send({ type: "NESTED_ANNOTATION_EVENT" })`
5. `executePendingNestedCommand` dispatches to the nested editor (creates the annotation)
6. The nested editor's `updateListener` fires → sets `modalAnnotations = editor.state.field(annotationField)`
7. Setting `modalAnnotations` triggers the publish effect → `modalAnnotationStores.set(stackIndex, modalAnnotations)`
8. `modalAnnotationStores` update → triggers **Sensor Effect B** which reads `$modalAnnotationStores`
9. Sensor B calls `send({ type: "EXTERNAL_DOC_CHANGED" })` or `send({ type: "VERSION_SWITCHED" })`

**Suspected infinite loop:** Steps 5–9 may create a cycle if `modalAnnotations` being set from
the `executePendingNestedCommand` dispatch causes Sensor B to fire `send(VERSION_SWITCHED)`,
which then calls `destroyEditor` → triggers effects → re-creates editor → triggers updateListener
again...

**Alternative theory:** `Math.max(...Object.keys(nestedAnns).map(Number))` in the
`NESTED_ANNOTATION_EVENT` handler can receive an empty array if the annotation wasn't actually
created (guard already added in attempted refactor — `if (keys.length === 0) break`). With
`Math.max()` called on empty spread, it returns `-Infinity`, and `nestedAnns[-Infinity]` is
undefined. This doesn't cause a stack overflow though.

**More likely root cause:** When `executePendingNestedCommand` creates the revision annotation
in the nested editor AND then `modalStack.push(...)` is called synchronously, pushing to
`modalStack` triggers a Svelte re-render. During that re-render, Sensor Effect C runs again
because `$annotationUiEvent` hasn't changed (same token), but `lastNestedEditorEventToken` check
should prevent re-firing. Unless the re-render happens BEFORE `lastNestedEditorEventToken = event.token`
is committed, causing repeated execution.

**Safest fix to try:** Defer `modalStack.push` in the `NESTED_ANNOTATION_EVENT` handler with
`setTimeout(() => modalStack.push(...), 0)` so it runs outside the current Svelte flush cycle.

**Also try:** Adding `event.token > lastNestedEditorEventToken` instead of `!==` comparison
to avoid potential re-entry.

---

## Architecture of the Current File

```
RevisionModal.svelte (1207 lines)
├── Script (~733 lines)
│   ├── Props + constants (L71–82)
│   ├── Context panel data: contextLayers $derived.by, scroll/intersection effects (L83–223)
│   ├── Version dropdown state: crumbSelectedVersions, openDropdown, selectVersion (L225–264)
│   ├── FSM: states, send(), fsmState (L266–343)
│   ├── FSM $effect continuation (L345–372)
│   ├── Sensor Effect A: dialog bind + rebuild token (L374–390)
│   ├── Core editor state: editor, editorHost, etc. (L391–413)
│   ├── createEditor, moveCursorToEnd, destroyEditor (L414–488)
│   ├── close() (L490–492)
│   ├── Sensor Effect B: external sync / version switch (L494–518)
│   ├── Version dropdown close-on-outside-click effect (L520–530)
│   ├── executePendingNestedCommand (L532–586)
│   ├── Sensor Effect C: nested annotation event (L588–603)
│   ├── onDestroy (L614–617)
│   ├── Publish effect: modalAnnotationStores (L619–625)
│   ├── Label editing state + functions (L627–664)
│   ├── addVersion, navigateVersion, onDialogKeydown (L666–697)
│   └── Thread state + dispatchUpdateThread (L699–732)
├── Template (~289 lines)
│   ├── Header: breadcrumbs + version dropdowns + label input + actions (L741–909)
│   ├── TutorialGuide (L911)
│   └── Body: thread sidebar + editor + right sidebar (context + annotations) (L913–1020)
└── Style (~184 lines)
    ├── .revision-modal-inner, .revision-modal-thread, .revision-modal-editor
    ├── .version-popover, .version-option, .version-option-active
    └── .context-scroll, .context-text, .context-depth-*, .context-nest-*, .context-jump-*
```

---

## Proposed Refactor (Ready to Implement)

Four extractions reduce the main file to ~300 lines. All four were drafted and type-checked
(4 errors → 0 new errors introduced) before being stashed.

### 1. `useRevisionModalEditor.svelte.ts` — Editor lifecycle hook

A `.svelte.ts` rune module that encapsulates the FSM, createEditor/destroyEditor, and all three
sensor effects. Returns reactive getters/setters for `editor`, `modalAnnotations`,
`modalActiveAnnotation`, and exposes `send()`.

**Key design note:** Cannot use `$store` syntax in `.svelte.ts` — must receive store values as
getter functions passed from the parent component (which CAN use `$store`). Specifically:
- `getModalEntry: () => ModalEntry & { rebuildToken? }` — for Sensor A
- `getParentAnnotations: () => AnnotationsMap | undefined` — for Sensor B
- `getAnnotationUiEvent: () => AnnotationUiEvent | null` — for Sensor C

`editorHost` and `wrapperEl` DOM refs cannot use `bind:this` directly on hook properties.
Solution: declare plain `$state` vars in the main component, use `bind:this` on them, then
sync them into the hook via `$effect(() => { hook.wrapperEl = wrapperEl; })`.

Estimated reduction: ~340 script lines from main file.

### 2. `useRevisionContext.svelte.ts` — Context layer data hook

A `.svelte.ts` rune module that computes `contextLayers` (the nested text context snippets).
Receives `getCrumbs()` and `getModalAnnotations()` (for reactive invalidation). Exposes
`loadMoreBefore(prevScrollHeight, el)` and `loadMoreAfter()` for lazy loading.

Scroll/intersection logic stays in the panel component (owns the DOM refs).

Estimated reduction: ~60 script lines from main file.

### 3. `RevisionModalHeader.svelte` — Header component

Contains the breadcrumb nav, per-crumb version dropdowns (with popover), label input,
"New version" button, close button, and all `.version-*` CSS.

**Important:** Make all state internal — `openDropdown`, `editingVersionLabel`, `labelInputValue`
are all internal `$state`. The header computes `selectedVersions` itself via `$derived`.
Parent only passes `crumbs`, `revision`, `stackIndex`, `modKey`, and callbacks:
`onSelectVersion`, `onAddVersion`, `onClose`, `onCommitLabel(label: string | undefined)`.

**DO NOT use `$bindable`** for these — the Svelte type checker marks bindable props as constants
in the child component script (even though they work at runtime). Use callbacks instead.

Estimated reduction: ~170 template lines + ~45 CSS lines from main file.

### 4. `RevisionModalContextPanel.svelte` — Context panel component

Contains the collapsible context section: scroll container, `{#snippet renderLayer}`, jump button.
All scroll/intersection `$effect` logic lives here (owns DOM refs via `bind:this`).
All `.context-*` CSS moves here.

Parent passes `contextLayers`, `onLoadMoreBefore`, `onLoadMoreAfter`.
`contextCollapsed` is internal state in the component (no need to lift it).

**DO NOT use `$bindable`** for `contextCollapsed` — same reason as above. It's fine as
internal state.

Estimated reduction: ~50 template lines + ~95 CSS lines from main file.

---

## Implementation Sequencing

```
1. Fix Bug 2 (stack overflow) first — needed regardless of refactor
2. Extract useRevisionModalEditor.svelte.ts
3. Extract useRevisionContext.svelte.ts
4. Extract RevisionModalHeader.svelte
5. Extract RevisionModalContextPanel.svelte
6. Simplify RevisionModal.svelte (wire together, remove dead code)
```

Do NOT attempt all in one session. The refactor files were created in a git stash
(`git stash list` → "Preserve modal editor state and show only topmost"). Run
`git stash show -p` to see the draft code if needed.

---

## Key Invariants to Preserve

1. **`editorVersionIndex` must be captured at `createEditor` time**, not read from
   `rev.activeVersionIndex` at `destroyEditor` time. A parent breadcrumb version switch can
   change `activeVersionIndex` between create and destroy, causing the blob to be written to
   the wrong slot.

2. **`lastDispatchedDoc` prevents echo.** After `translateAndDispatch`, the nested editor's
   doc string is stored in `lastDispatchedDoc`. Sensor B checks `externalDoc === lastDispatchedDoc`
   before patching, preventing the change from bouncing back as an external update.

3. **`pullingFromParent` prevents double-dispatch.** Set to `true` while patching the nested
   editor from an external change, so the `updateListener` skips `translateAndDispatch`.

4. **FSM serializes all lifecycle.** Never call `createEditor`/`destroyEditor` directly from
   effects — always go through `send()`. This prevents double-create/double-destroy races.

5. **`initialPendingCommand` must be read at mount time**, not reactively. The modal stack
   entry is mutable (rebuildToken gets stamped onto it), so reading `pendingNestedCommand`
   reactively would see `undefined` after the first rebuild.

6. **`modalAnnotationStores.remove(stackIndex)` must run in `onDestroy`**, not in a cleanup
   effect. Effects run cleanup before re-running, but `onDestroy` runs exactly once on unmount.

---

## The `$state_proxy_equality_mismatch` in `stores.ts`

The `modalStack.push` duplicate detection compares `existing.parentView === entry.parentView`.
If `existing` comes from the store's reactive state (Svelte proxy), this comparison may fail.

Quick workaround: add a unique numeric ID to each EditorView when it's created:
```ts
// In Editor.svelte or nestedEditor.ts:
(editorView as unknown as { _quilliumId: number })._quilliumId = nextId++;

// In modalStack.push:
const existingId = (existing.parentView as unknown as { _quilliumId?: number })._quilliumId;
const entryId = (entry.parentView as unknown as { _quilliumId?: number })._quilliumId;
if (existingId !== undefined && existingId === entryId && ...) isDuplicate = true;
```

Or use `$state.raw` in Svelte 5 to bypass proxy wrapping for the comparison.

---

## Other Notes

- `previewVersionText` is imported from `nestedEditor.ts` and used in both the header breadcrumb
  and the context panel rendering. Keep this import in whichever component uses it; it's a pure
  utility with no side effects.

- The `revision` derived (line 397–399) is intentionally non-reactive to CodeMirror transactions.
  This is correct — it's only used for label editing and "new version" which are user-initiated.
  Reactive data comes from `modalAnnotations`.

- `contextLayers` uses `void modalAnnotations` as a dependency-trick to force re-derivation when
  the nested editor writes back. This is because `crumb.parentView.state` (a CodeMirror state)
  is not `$state`, so changes to it don't naturally invalidate the derived. `modalAnnotations`
  IS `$state` and gets set by the updateListener on every transaction.

- The `no-stacked-modal` branch renamed `RevisionModal` from a self-hosted `<dialog>` to a
  pure content component. The `isTop` prop was removed; z-index/visibility is now controlled
  by `+page.svelte`. `DiffModal` went through the same change.
