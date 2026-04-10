# AutoAI Animated Face — Design Spec

**Date:** 2026-04-10
**Branch:** `better-autoai-avatar`
**Scope:** Replace the static quill SVG icon in `AutoAIWidget.svelte` with a living, animated face character.

---

## Overview

The AutoAI widget bubble (67×67px, bottom-left corner) currently shows a static quill SVG. This spec replaces it with an animated face that reacts to app state — tracking your writing, thinking before a review, squinting while reading, and falling asleep when idle. The face is warm and minimal: two vertical-bar eyes, no mouth, no extra features. Personality comes entirely from eye animation.

The face is implemented as an inline SVG driven by CSS custom properties and keyframe animations, toggled by Svelte state classes. No external animation library, no canvas, no new dependencies.

---

## Visual Design

**Eye shape (base):** Two vertical rounded rectangles (`rect`, `rx="2"`, ~4×14px each), warm dark brown (`#5c4a2a`), centered in the bubble.

**No mouth.** The face communicates entirely through eye shape and movement.

**Bubble shell:** Unchanged from current — same `#faf8f5` background, `#d6b87a` border, rainbow gradient when active, spinning rainbow when reviewing.

---

## State Machine

Six states. Exactly one is active at a time.

### 1. Idle
- **Trigger:** AutoAI is enabled, no recent cursor/caret activity, not reviewing
- **Eyes:** Vertical bars, centered
- **Animation:** Both eyes blink simultaneously every ~3.2s (scaleY → 0.06 → back, ~150ms total)
- **Note:** Blink is synchronized — both eyes move at exactly the same time, no delay between them

### 2. Tracking
- **Trigger:** Cursor moves or caret position changes (replaces idle while active)
- **Eyes:** Vertical bars offset by up to ±4px in the direction of the target
- **Tracking logic:**
  - While typing: track the CodeMirror caret position (converted to page coordinates)
  - While not typing (mouse moving): track the cursor position
  - Transition between the two is immediate (no blending needed)
  - Max shift: 4px. Shift scales with distance — `scale = min(1, distance / 80px)`, so nearby targets produce less movement
  - Eye position is updated via JS on `mousemove` and CodeMirror `update` events, written to CSS custom properties `--ex` and `--ey` on the SVG element, applied via `transform: translate(var(--ex), var(--ey))`
- **Blink:** Suppressed during active tracking (resume after 1s of no movement)

### 3. Thinking
- **Trigger:** AutoAI debounce timer has fired and the review is about to begin (between debounce end and first AI token)
- **Eyes:** >_< shape — two V-shaped pairs of lines (stroke, not fill), replacing the bar eyes
  - Left eye: two lines meeting at a point on the right (`>`)
  - Right eye: two lines meeting at a point on the left (`<`)
- **Animation:** Gentle head bob — the entire face SVG translates ±1.5px on X, 1s period, ease-in-out
- **Duration:** Held for the full pre-review window. If review is cancelled (user edits again), returns to idle.

### 4. Reviewing
- **Trigger:** AI API call is in flight (`aiProcessing.active === true`)
- **Eyes:** Vertical bars squashed to scaleY 0.22 — a narrow, suspicious squint
- **Animation:** Eyes scan left→right then drop, like reading lines of text:
  1. Translate X from −3px → +3px over ~900ms (sweep a line)
  2. Snap back to X −3px, translate Y down 3px (next line)
  3. Sweep X again
  4. Reset Y, repeat
  - Total cycle: ~2.2s
- **Border:** Rainbow spin (existing behavior, unchanged)

### 5. Sleeping
- **Trigger:** No user interaction (no mouse movement, no typing, no review) for 60 seconds, and AutoAI is enabled
- **Eyes:** Rotate to horizontal bars (the same rect, now wide and short: ~14×4px)
- **Animation:** Horizontal bars gently scale on X (0.88 → 1.0, 3s period) — slow breathing
- **ZZZ:** Three `<text>` elements float upward from the right side of the face, staggered by 0.73s each, fading out as they rise. Sized z / z / Z (9px, 11px, 13px).
- **Wake trigger:** Any mouse movement or keypress — immediately transitions to idle

### 6. Disabled
- **Trigger:** No API key configured (`hasApiKey()` returns false)
- **Eyes:** Two × shapes (line pairs), same position as normal eyes
- **Bubble:** Dimmed (opacity 0.4). Border stays at default `#d6b87a` (no rainbow).
- **Replaces:** The current lock icon SVG

---

## Implementation Architecture

### Component structure

Extract the face into a dedicated component `src/lib/autoai/AutoAIFace.svelte`. `AutoAIWidget.svelte` passes state as props:

```
<AutoAIFace
  state="idle" | "tracking" | "thinking" | "reviewing" | "sleeping" | "disabled"
  eyeOffsetX={number}   // −4 to +4, updated by parent
  eyeOffsetY={number}   // −4 to +4, updated by parent
/>
```

The parent (`AutoAIWidget.svelte`) owns:
- State derivation (which of the 6 states is active)
- Mouse/caret tracking logic (the `$effect` that writes `eyeOffsetX`/`eyeOffsetY`)
- Sleep timer (`setTimeout`, reset on any interaction)
- Thinking state detection (bridge between debounce fire and `aiProcessing.active`)

The child (`AutoAIFace.svelte`) owns:
- All SVG markup
- All CSS animations
- Rendering the correct eye shape per state
- Applying `--ex`/`--ey` CSS custom properties for tracking offset

### State derivation (in AutoAIWidget.svelte)

```
disabled  → !hasApiKey()
sleeping  → enabled && idle > 60s
thinking  → enabled && debounce fired && !aiProcessing.active
reviewing → enabled && aiProcessing.active
tracking  → enabled && (mouseMoved || caretMoved) within last 1s
idle      → fallback
```

Priority (highest first): disabled > reviewing > thinking > sleeping > tracking > idle

### Caret tracking

CodeMirror exposes cursor coordinates via `view.coordsAtPos(view.state.selection.main.head)`. This returns `{top, left, bottom, right}` in page coordinates. Call this on the existing editor `update` listener (already present in the editor setup), and broadcast the result via a `CustomEvent` on `window` (e.g. `quillium:caret-moved`, `{detail: {x, y}}`). `AutoAIWidget.svelte` listens for this event and updates `eyeOffsetX`/`eyeOffsetY` accordingly.

### Sleep timer

```ts
let sleepTimer: ReturnType<typeof setTimeout> | null = null;

function resetSleep() {
  if (sleepTimer) clearTimeout(sleepTimer);
  sleepTimer = setTimeout(() => { sleeping = true; }, 60_000);
}
```

Reset on: `mousemove` (document), `keydown` (document), caret change.

### Thinking state bridge

The engine currently calls `triggerManualReview()` and sets `aiProcessing.active` when the API call starts. Add a new exported writable `autoAIThinking` (boolean) in `engine.ts` that is set to `true` when the debounce fires and `false` when `aiProcessing.active` becomes true or the review is cancelled.

---

## CSS Animation Summary

| State | Technique | Duration |
|-------|-----------|----------|
| Idle blink | `@keyframes blink` on both eyes, `scaleY` | 3.2s loop |
| Thinking head bob | `@keyframes head-bob` on face `<g>`, `translateX` | 1s loop |
| Reviewing scan | `@keyframes scan-x` on eyes, `scaleY + translateX + translateY` | 2.2s loop |
| Sleeping breathe | `@keyframes breathe` on eyes, `scaleX` | 3s loop |
| ZZZ float | `@keyframes zzz-float` on text elements, `translate + opacity` | 2.2s loop, staggered |
| Tracking | JS → CSS custom props `--ex` `--ey` → `transform: translate()` | Real-time |

All keyframe animations use `transform-box: fill-box; transform-origin: center` so transforms are relative to each element's own bounding box.

---

## Files to Create / Modify

| File | Change |
|------|--------|
| `src/lib/autoai/AutoAIFace.svelte` | **Create** — face SVG + all CSS animations |
| `src/lib/autoai/AutoAIWidget.svelte` | **Modify** — replace quill SVG with `<AutoAIFace>`, add state derivation, tracking logic, sleep timer |
| `src/lib/autoai/engine.ts` | **Modify** — add and export `autoAIThinking` boolean store |

No new dependencies. No new routes. No changes to settings, persistence, or PostHog events.

---

## Out of Scope

- Mouth or additional facial features
- Lottie / Rive / canvas
- Expressions for specific annotation types (comment vs. suggestion vs. revision)
- Sound
- Accessibility: the face is decorative (`aria-hidden="true"`); existing aria-labels on the button are unchanged
