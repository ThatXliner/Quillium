# Revision Modal System: Diagnosis & Refactoring Notes

## Executive Summary

The revision modal system has two categories of problems:

1. **Stacking real `<dialog>` elements** instead of virtually managing a single modal
2. **Inconsistent push/open behavior** depending on the `showNestedEditor` setting

Both stem from the same root cause: the modal stack (`stores.ts:328-371`) is rendered as N simultaneous `<dialog>` elements in `+page.svelte:200-206`, but the intended UX is a single modal whose *content* changes as the user drills deeper. This mismatch between the data model (a stack of entries) and the rendering model (N stacked dialogs) causes stale state, z-index fights, and confusing escape/close behavior.

**Recommendation: yes, refactor.** The modal stack data structure is fine, but the rendering layer and the push/consume logic in `Revision.svelte` need restructuring. Details below.

---

## Problem 1: Stacking Real Dialogs

### Current behavior

`+page.svelte:200-206`:
```svelte
{#each $modalStack as entry, i (entry)}
    {#if entry.type === "diff"}
        <DiffModal ... stackIndex={i} />
    {:else if entry.type === "revision"}
        <RevisionModal ... stackIndex={i} />
    {/if}
{/each}
```

Each `RevisionModal` calls `dialogEl.showModal()` (line 291), creating a new top-level `<dialog>` in the browser's modal layer. When the user nests revisions (revision inside revision), **multiple `<dialog>` elements are open simultaneously**.

### Why this is problematic

1. **Stale parent state.** Each `RevisionModal` captures `initialPendingCommand` eagerly at mount (line 79-81) and reads `view.state` for its revision data. But when a child modal is stacked on top, the parent modal's DOM is still alive and its `$effect` blocks keep firing. The parent's `Sensor Effect B` (line 497-519) continues to react to annotation changes, potentially fighting with the child modal's dispatches. The `pullingFromParent` guard helps, but there's a timing window where both modals process the same `annotationUiEvent`.

2. **Backdrop stacking.** Each `<dialog>::backdrop` adds another `rgba(0,0,0,0.3)` layer. Two deep = 60% opacity, three deep = progressively darker. This is visual noise, not intentional design.

3. **Escape key ambiguity.** The browser's native `<dialog>` escape handling fires `cancel` on the *topmost* dialog, which `RevisionModal` intercepts to call `modalStack.pop()`. This works but is fragile — if focus lands on a parent dialog's element (e.g., during a breadcrumb click), escape might close the wrong one.

4. **Memory/DOM bloat.** Each stacked modal has its own CodeMirror editor instance, IntersectionObserver, scroll handlers, and annotation sidebar. The parent modal's editor stays alive even though it's invisible behind the child.

### Recommended fix

Render a **single `<dialog>`** that reads from `$modalStack[$modalStack.length - 1]` for its current content. The stack still exists as a data structure for breadcrumb navigation and state preservation, but only one `RevisionModal` component is mounted at a time. When the user pops the stack, destroy the current modal's editor, read the parent entry from the stack, and rebuild with the parent's state.

This eliminates backdrop stacking, stale parent effects, and DOM bloat. The `destroyEditor()` flush (line 466-489) already handles persisting nested annotation state back to the parent version blob, so state is preserved across push/pop.

**Key change:**
```svelte
<!-- Instead of #each, render only the top entry -->
{#if $modalStack.length > 0}
    {@const top = $modalStack[$modalStack.length - 1]}
    {@const i = $modalStack.length - 1}
    {#if top.type === "diff"}
        <DiffModal ... stackIndex={i} />
    {:else if top.type === "revision"}
        <RevisionModal ... stackIndex={i} />
    {/if}
{/if}
```

The breadcrumb trail still reads from `$modalStack.slice(0, stackIndex + 1)` — that doesn't change. What changes is that when navigating via breadcrumb (`popTo`), the current component is destroyed and a new one mounts for the target level. The existing `popToAndRebuild` mechanism can be simplified or removed since the component always remounts.

---

## Problem 2: Inconsistent Push/Open Behavior

### Intended behavior (per your spec)

**If inline editors are enabled (`showNestedEditor: true`):**
1. Creating a revision in the main doc → appears as annotation card, inline editor opens. **No modal.**
2. Creating a revision *inside* the inline editor → push a **new modal** containing the inline editor's content, with the newly created revision shown as an annotation in the modal.

**If inline editors are disabled (`showNestedEditor: false`):**
1. Creating a revision anywhere → always push a **new modal** with the selected text as content.
2. No inline editors ever appear.

### Current behavior (buggy)

There are **7 different code paths** that push modals, and they don't all follow the same logic:

| Location | Trigger | What it does | Issue |
|----------|---------|--------------|-------|
| `Revision.svelte:167-202` | `revision-open-nested-editor` event | Pushes modal if no existing modal for this revision | This is the "create nested annotation inside inline editor" path. It correctly pushes a modal. But the duplicate check (line 181-187) silently swallows the event if a modal already exists, with no feedback to the user. |
| `Revision.svelte:237-245` | `revision-focus-request` when `!showNestedEditor` | Pushes modal with cursor command | Correct for disabled inline editors. |
| `Revision.svelte:433-443` | Click on nested revision decoration in inline editor | Pushes **parent** revision modal with cursor | This was a bugfix (see `nestedRevisionFocusRequest.test.ts`). Correct behavior. |
| `Revision.svelte:553-568` | "New version" button click | If `!showNestedEditor`, push modal | **Bug:** after `await tick()`, it checks `showNestedEditor` again but the version was already created. If inline editors are enabled, it opens the inline editor instead of pushing a modal — but this is for the *parent* revision's new version, not a nested one. This path doesn't push a modal when inline editors are on, which seems correct per spec. |
| `Revision.svelte:602` | Expand (Maximize2) button | Always pushes modal | This is a manual "open in modal" action. Always correct. |
| `Revision.svelte:630` | Boundary hint button (when `!showNestedEditor`) | Pushes modal | Correct. |
| `RevisionModal.svelte:322-337` | `NESTED_ANNOTATION_EVENT` with type "revision" | Creates nested revision in modal editor, then pushes child modal | **Bug:** this pushes a modal for the *nested* revision with `parentView: editor` (the modal's nested editor). This is creating a new stacked dialog. Per the spec, if inline editors are enabled inside the modal, this should show as an inline annotation — only pushing a modal if inline editors are disabled. But the modal's `Annotations` sidebar renders `Revision.svelte` cards with `view={editor}`, and those cards have their own push logic. So this FSM handler races with the `Revision.svelte` card's `revision-open-nested-editor` handler. |

### The race between RevisionModal FSM and Revision.svelte cards

When a user creates a nested revision inside a modal (via `Mod-Alt-k`):

1. `makeParentUndoKeymap` in `nestedEditor.ts:207-211` publishes `revision-open-nested-editor` event
2. **Two listeners** react to this event:
   - `RevisionModal.svelte` Sensor Effect C (line 591-604) → sends `NESTED_ANNOTATION_EVENT` to FSM → FSM creates the annotation AND pushes a child modal (line 322-337)
   - `Revision.svelte` card (line 167-202) in the modal's annotation sidebar → also tries to push a modal for the same revision

The duplicate check in `modalStack.push()` (line 332-344 in stores.ts) prevents a double-push, but **which handler wins is timing-dependent**. If RevisionModal's FSM runs first, it creates the annotation and pushes the modal. If Revision.svelte's handler runs first... it can't, because the annotation doesn't exist yet (it's created by `executePendingNestedCommand` which only runs inside the FSM). So the Revision.svelte handler sees a `revision-open-nested-editor` event with a `revisionId` that matches its *parent* revision (the modal's revision), not the newly created nested one.

This works by accident but is fragile. The event's `command.revisionId` (line 173: `event.command.revisionId !== revision.id`) is the *parent* revision ID (the one the keymap was created for), so the Revision.svelte card for the parent revision matches it. But then line 181-187 checks whether a modal already exists for this revision — and it does (the current modal!), so it swallows the event. The FSM then handles it separately.

**The fundamental issue:** `revision-open-nested-editor` is overloaded. It means both "create a nested annotation inside me" (handled by RevisionModal FSM) and "open a modal for a revision" (handled by Revision.svelte). These should be separate events or the routing should be unambiguous.

### The `showNestedEditor` setting inside modals

The modal always renders its own `Annotations` sidebar with `Revision.svelte` cards. Those cards respect `appSettings.showNestedEditor` — if true, they show inline editors within the modal. If false, clicking activates them but shows no inline editor.

**But** `RevisionModal.svelte` Sensor Effect C + FSM `NESTED_ANNOTATION_EVENT` handler (line 322-337) **always pushes a child modal** when a nested revision is created, regardless of the `showNestedEditor` setting. This means:

- `showNestedEditor: true` → nested revision is created, modal is pushed, AND the Revision.svelte card in the sidebar tries to show an inline editor. The user sees both a new modal and an inline editor in the annotation sidebar of the *parent* modal (which is now behind the child modal and invisible due to stacking).
- `showNestedEditor: false` → same behavior. The modal push is correct here, but the Revision.svelte card won't show an inline editor, which is also correct.

So when inline editors are enabled, the modal push in the FSM handler is wrong — it should let the Revision.svelte card handle display (as an inline editor), and only push a modal if the user explicitly asks (via the expand button) or if inline editors are disabled.

---

## Problem 3: `pendingNestedCommand` Lifecycle

`pendingNestedCommand` is stored as a field on the `ModalEntry` in the stack. It's consumed eagerly at mount time (`RevisionModal.svelte:79-81`). But:

1. The stack entry is mutable (it's a plain object in an array). Nothing prevents other code from reading the `pendingNestedCommand` after it's been consumed.
2. If the FSM handles `NESTED_ANNOTATION_EVENT` and pushes a child modal with its own `pendingNestedCommand` (line 330-336, though it doesn't currently set one), the child's `initialPendingCommand` would be `undefined` because the push doesn't include one. The annotation creation happens in the parent modal's FSM, not via the child's pending command.

This is not actively broken right now, but it's a maintenance trap. The pending command should be a one-shot mechanism with explicit consumption and clearing.

---

## Refactoring Recommendations

### Must-fix (high impact, causing user-visible bugs)

1. **Single dialog rendering.** Change `+page.svelte` to render only the top modal stack entry. This eliminates stale state, backdrop stacking, and escape ambiguity. The modal stack data structure stays as-is for breadcrumb state.

2. **Split the `revision-open-nested-editor` event** into two distinct events:
   - `nested-annotation-create`: "create a new annotation inside this revision's editor" (consumed by RevisionModal FSM only)
   - `revision-request-modal`: "open a modal for this revision" (consumed by Revision.svelte or the rendering layer)

   This eliminates the race between RevisionModal's Sensor Effect C and Revision.svelte's handler.

3. **Respect `showNestedEditor` in RevisionModal's NESTED_ANNOTATION_EVENT handler.** When inline editors are enabled and a nested revision is created inside a modal, do NOT auto-push a child modal. Let the Revision.svelte card in the annotations sidebar handle it (inline editor). Only push a child modal when inline editors are disabled.

### Should-fix (reduces complexity, prevents future bugs)

4. **Make `pendingNestedCommand` a consumed-once mechanism.** After `executePendingNestedCommand` runs, clear it from the stack entry (or use a separate channel that's consumed and discarded).

5. **Simplify `popToAndRebuild`.** If only one modal is ever mounted, `popTo` naturally triggers a remount. The `rebuildToken` stamping mechanism becomes unnecessary.

6. **Remove the duplicate-push guard** (or at least stop relying on it for correctness). The guard in `modalStack.push()` (line 332-354) is a safety net that masks routing bugs. If the event routing is unambiguous (recommendation 2), duplicates can't happen, and the guard becomes a pure assertion/telemetry check.

### Nice-to-have (cleanup)

7. **Consolidate modal push call sites.** Currently 7 different places push modals with slightly different entry shapes. Consider a helper like `openRevisionModal(revisionId, parentView, opts?)` that standardizes the entry construction and ensures consistent label generation.

8. **Extract the FSM into a separate module.** `RevisionModal.svelte` is 1150+ lines with the FSM, sensor effects, context layers, breadcrumb dropdown logic, and template all in one file. The FSM + sensor effects could live in `revisionModalFSM.ts` with explicit inputs/outputs.

---

## Files Involved

| File | Lines | Role |
|------|-------|------|
| `src/lib/stores.ts` | 260-395 | Modal stack types, store, per-level annotation stores |
| `src/lib/editor/plugins/annotations/Revision.svelte` | 167-202, 237-245, 413-443, 553-568, 602, 630 | All modal push call sites from annotation cards |
| `src/lib/editor/plugins/annotations/RevisionModal.svelte` | 266-344, 466-489, 495-519, 589-604 | FSM, editor lifecycle, sensor effects |
| `src/lib/editor/plugins/annotations/nestedEditor.ts` | 156-214 | Keymap that fires `revision-open-nested-editor` |
| `src/routes/+page.svelte` | 200-206 | Modal stack rendering loop |
| `src/lib/settings.svelte.ts` | 17-18 | `showNestedEditor` setting |
