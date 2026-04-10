# AutoAI Animated Face Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static quill SVG in the AutoAI widget bubble with a living animated face that tracks the caret/cursor, shows a >_< thinking face before reviews, squints while reviewing, and falls asleep when idle.

**Architecture:** A new `AutoAIFace.svelte` component owns all SVG markup and CSS keyframe animations, receiving a `state` prop and `eyeOffsetX`/`eyeOffsetY` props from `AutoAIWidget.svelte`. The parent owns state derivation, the sleep timer, and the thinking signal. `engine.ts` gains an exported `autoAIThinking` boolean store that bridges the debounce → review gap.

**Tech Stack:** SvelteKit + Svelte 5 runes, inline SVG, CSS keyframes, CodeMirror `EditorView.updateListener`, `window` CustomEvents. No new dependencies.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/lib/autoai/AutoAIFace.svelte` | **Create** | All face SVG + CSS animations, receives `state` + eye offset props |
| `src/lib/autoai/AutoAIWidget.svelte` | **Modify** | Replace quill icon with `<AutoAIFace>`, add state derivation, sleep timer, caret-event listener |
| `src/lib/autoai/engine.ts` | **Modify** | Export `autoAIThinking` writable boolean store, set/clear it around the debounce→review transition |

---

## Task 1: Add `autoAIThinking` store to engine.ts

**Files:**
- Modify: `src/lib/autoai/engine.ts`

The "thinking" state = debounce has fired but the AI call hasn't started yet. We need a reactive signal the widget can read.

- [ ] **Step 1: Add the store**

In `src/lib/autoai/engine.ts`, add after the existing imports and before `const MIN_DIFF_CHARS`:

```ts
import { get, writable } from "svelte/store";
```

Replace the existing `import { get } from "svelte/store";` line with the above (adds `writable`).

Then add the export right after the imports block:

```ts
/** True while the debounce timer has fired but the AI call has not yet started. */
export const autoAIThinking = writable(false);
```

- [ ] **Step 2: Set `autoAIThinking = true` when debounce fires**

Find `scheduleReview`:

```ts
function scheduleReview(content: string) {
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        debounceTimer = null;
        runReview(content);
    }, autoAISettings.debounceMs);
}
```

Replace with:

```ts
function scheduleReview(content: string) {
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        debounceTimer = null;
        autoAIThinking.set(true);
        runReview(content);
    }, autoAISettings.debounceMs);
}
```

- [ ] **Step 3: Clear `autoAIThinking` when the AI call starts (inside `runReview`)**

Find the top of `runReview`:

```ts
async function runReview(content: string, manual = false) {
    if (!content.trim()) return;

    setAiProcessing(true);
```

Replace with:

```ts
async function runReview(content: string, manual = false) {
    if (!content.trim()) return;

    autoAIThinking.set(false);
    setAiProcessing(true);
```

- [ ] **Step 4: Clear `autoAIThinking` when a pending review is cancelled**

Find `cancelPendingReview`:

```ts
export function cancelPendingReview() {
    if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
    }
}
```

Replace with:

```ts
export function cancelPendingReview() {
    if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
    }
    autoAIThinking.set(false);
}
```

- [ ] **Step 5: Type-check**

```bash
bun run check
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/autoai/engine.ts
git commit -m ":sparkles: feat(autoai): add autoAIThinking store to engine"
```

---

## Task 2: Create AutoAIFace.svelte

**Files:**
- Create: `src/lib/autoai/AutoAIFace.svelte`

This component is purely presentational. It receives `state` and `eyeOffsetX`/`eyeOffsetY`, renders the correct SVG shape, and applies CSS animations. No logic, no stores, no side effects.

- [ ] **Step 1: Create the file**

Create `src/lib/autoai/AutoAIFace.svelte`:

```svelte
<script lang="ts">
export type FaceState =
    | "idle"
    | "tracking"
    | "thinking"
    | "reviewing"
    | "sleeping"
    | "disabled";

interface Props {
    state: FaceState;
    eyeOffsetX?: number; // –4 to +4, pixels
    eyeOffsetY?: number; // –4 to +4, pixels
}

let { state, eyeOffsetX = 0, eyeOffsetY = 0 }: Props = $props();

const tx = $derived(`translate(${eyeOffsetX.toFixed(1)}px, ${eyeOffsetY.toFixed(1)}px)`);
</script>

<!-- aria-hidden: face is decorative; aria-label lives on the parent button -->
<svg
    aria-hidden="true"
    class="face"
    overflow="visible"
    width="42"
    height="30"
    viewBox="0 0 42 30"
>
    {#if state === "disabled"}
        <!-- × eyes -->
        <line x1="7"  y1="7"  x2="15" y2="21" stroke="#5c4a2a" stroke-width="3" stroke-linecap="round"/>
        <line x1="15" y1="7"  x2="7"  y2="21" stroke="#5c4a2a" stroke-width="3" stroke-linecap="round"/>
        <line x1="27" y1="7"  x2="35" y2="21" stroke="#5c4a2a" stroke-width="3" stroke-linecap="round"/>
        <line x1="35" y1="7"  x2="27" y2="21" stroke="#5c4a2a" stroke-width="3" stroke-linecap="round"/>

    {:else if state === "sleeping"}
        <!-- horizontal bars + zzz -->
        <rect class="sleep-eye" x="5"  y="12" width="14" height="4" rx="2" fill="#5c4a2a"/>
        <rect class="sleep-eye" x="23" y="12" width="14" height="4" rx="2" fill="#5c4a2a"/>
        <text class="zzz z1" x="38" y="14">z</text>
        <text class="zzz z2" x="40" y="9"  font-size="11">z</text>
        <text class="zzz z3" x="43" y="3"  font-size="13">Z</text>

    {:else if state === "thinking"}
        <!-- >_< face with head bob on the whole group -->
        <g class="think-face">
            <!-- left > eye -->
            <line class="eye-v" x1="5"  y1="7"  x2="13" y2="15"/>
            <line class="eye-v" x1="5"  y1="23" x2="13" y2="15"/>
            <!-- right < eye -->
            <line class="eye-v" x1="37" y1="7"  x2="29" y2="15"/>
            <line class="eye-v" x1="37" y1="23" x2="29" y2="15"/>
        </g>

    {:else if state === "reviewing"}
        <!-- narrow suspicious squint + reading scan -->
        <rect class="review-eye" x="9"  y="7" width="4" height="14" rx="2" fill="#5c4a2a"/>
        <rect class="review-eye" x="25" y="7" width="4" height="14" rx="2" fill="#5c4a2a"/>

    {:else}
        <!-- idle / tracking: vertical bar eyes, offset by eyeOffsetX/Y -->
        <rect
            class="bar-eye {state === 'idle' ? 'blink' : ''}"
            style="transform: {tx}"
            x="9"  y="7" width="4" height="14" rx="2" fill="#5c4a2a"
        />
        <rect
            class="bar-eye {state === 'idle' ? 'blink' : ''}"
            style="transform: {tx}"
            x="25" y="7" width="4" height="14" rx="2" fill="#5c4a2a"
        />
    {/if}
</svg>

<style>
    /* ── Shared ── */
    .eye-v {
        stroke: #5c4a2a;
        stroke-width: 2.8;
        stroke-linecap: round;
        fill: none;
    }

    /* ── Idle blink: both eyes, synchronized ── */
    @keyframes blink {
        0%, 87%, 100% { transform: scaleY(1); }
        92%            { transform: scaleY(0.06); }
        96%            { transform: scaleY(1); }
    }
    .bar-eye {
        transform-box: fill-box;
        transform-origin: center;
    }
    .blink {
        animation: blink 3.2s ease-in-out infinite;
    }

    /* ── Thinking: >_< head bob ── */
    @keyframes head-bob {
        0%, 100% { transform: translateX(0px); }
        25%       { transform: translateX(-1.5px); }
        75%       { transform: translateX(1.5px); }
    }
    .think-face {
        animation: head-bob 1s ease-in-out infinite;
    }

    /* ── Reviewing: narrow squint + line-scan ── */
    @keyframes scan-x {
        0%   { transform: scaleY(0.22) translate(-3px, 0px); }
        40%  { transform: scaleY(0.22) translate(3px,  0px); }
        50%  { transform: scaleY(0.22) translate(-3px, 3px); }
        90%  { transform: scaleY(0.22) translate(3px,  3px); }
        100% { transform: scaleY(0.22) translate(-3px, 0px); }
    }
    .review-eye {
        transform-box: fill-box;
        transform-origin: center;
        animation: scan-x 2.2s ease-in-out infinite;
    }

    /* ── Sleeping: horizontal bars breathe ── */
    @keyframes breathe {
        0%, 100% { transform: scaleX(1); }
        50%       { transform: scaleX(0.88); }
    }
    .sleep-eye {
        transform-box: fill-box;
        transform-origin: center;
        animation: breathe 3s ease-in-out infinite;
    }

    /* ── ZZZ float ── */
    @keyframes zzz-float {
        0%   { opacity: 0; transform: translate(0px, 0px) scale(0.6); }
        15%  { opacity: 1; }
        85%  { opacity: 0.7; }
        100% { opacity: 0; transform: translate(8px, -16px) scale(1.1); }
    }
    .zzz {
        font-size: 9px;
        font-weight: 800;
        fill: #b5a99a;
        font-family: -apple-system, sans-serif;
    }
    .z1 { animation: zzz-float 2.2s ease-out 0s    infinite; }
    .z2 { animation: zzz-float 2.2s ease-out 0.73s infinite; }
    .z3 { animation: zzz-float 2.2s ease-out 1.46s infinite; }
</style>
```

- [ ] **Step 2: Type-check**

```bash
bun run check
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/autoai/AutoAIFace.svelte
git commit -m ":sparkles: feat(autoai): create AutoAIFace animated SVG component"
```

---

## Task 3: Wire AutoAIFace into AutoAIWidget

**Files:**
- Modify: `src/lib/autoai/AutoAIWidget.svelte`

This is the main wiring task. We replace the quill SVG with `<AutoAIFace>`, add state derivation, the sleep timer, and caret tracking.

- [ ] **Step 1: Add imports**

At the top of the `<script>` block in `AutoAIWidget.svelte`, add after existing imports:

```ts
import AutoAIFace, { type FaceState } from "./AutoAIFace.svelte";
import { autoAIThinking } from "./engine";
```

- [ ] **Step 2: Add face state variables**

After the existing `let open = $state(false);` declarations block, add:

```ts
// ── Face state ──
let eyeOffsetX = $state(0);
let eyeOffsetY = $state(0);
let isTracking = $state(false);
let isSleeping = $state(false);
let trackingTimer: ReturnType<typeof setTimeout> | null = null;
let sleepTimer: ReturnType<typeof setTimeout> | null = null;
const SLEEP_AFTER_MS = 60_000;
const TRACKING_LINGER_MS = 1_000;
```

- [ ] **Step 3: Add derived face state**

After the existing derived values (`const noApiKey`, `const locked`, etc.), add:

```ts
const faceState = $derived<FaceState>(
    !hasApiKey()          ? "disabled"  :
    aiProcessing.active   ? "reviewing" :
    $autoAIThinking       ? "thinking"  :
    isSleeping            ? "sleeping"  :
    isTracking            ? "tracking"  :
                            "idle"
);
```

- [ ] **Step 4: Add helper functions for tracking and sleeping**

Add these functions anywhere in the script block (e.g. after `handleDocClick`):

```ts
function computeEyeOffset(targetX: number, targetY: number) {
    if (!widgetEl) return;
    const rect = widgetEl.getBoundingClientRect();
    const cx = rect.left + rect.width  / 2;
    const cy = rect.top  + rect.height / 2;
    const dx = targetX - cx;
    const dy = targetY - cy;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const scale = Math.min(1, dist / 80);
    eyeOffsetX = parseFloat(((dx / dist) * 4 * scale).toFixed(1));
    eyeOffsetY = parseFloat(((dy / dist) * 4 * scale).toFixed(1));
}

function handleMouseMove(e: MouseEvent) {
    if (open) return;
    isTracking = true;
    isSleeping = false;
    computeEyeOffset(e.clientX, e.clientY);
    resetTrackingTimer();
    resetSleepTimer();
}

function handleCaretMoved(e: Event) {
    const { x, y } = (e as CustomEvent<{ x: number; y: number }>).detail;
    if (open) return;
    isTracking = true;
    isSleeping = false;
    computeEyeOffset(x, y);
    resetTrackingTimer();
    resetSleepTimer();
}

function resetTrackingTimer() {
    if (trackingTimer !== null) clearTimeout(trackingTimer);
    trackingTimer = setTimeout(() => {
        isTracking = false;
        trackingTimer = null;
    }, TRACKING_LINGER_MS);
}

function resetSleepTimer() {
    if (sleepTimer !== null) clearTimeout(sleepTimer);
    sleepTimer = setTimeout(() => {
        if (!open && !aiProcessing.active && !$autoAIThinking) {
            isSleeping = true;
        }
    }, SLEEP_AFTER_MS);
}

function handleAnyInteraction() {
    isSleeping = false;
    resetSleepTimer();
}
```

- [ ] **Step 5: Register / unregister event listeners in onMount/onDestroy**

Find the existing `onMount`:

```ts
onMount(() => {
    document.addEventListener("mousedown", handleDocClick);
    if (autoAISettings.enabled) startAutoAI();
});
```

Replace with:

```ts
onMount(() => {
    document.addEventListener("mousedown", handleDocClick);
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("keydown", handleAnyInteraction);
    window.addEventListener("quillium:caret-moved", handleCaretMoved);
    resetSleepTimer();
    if (autoAISettings.enabled) startAutoAI();
});
```

Find the existing `onDestroy`:

```ts
onDestroy(() => {
    document.removeEventListener("mousedown", handleDocClick);
    stopAutoAI();
});
```

Replace with:

```ts
onDestroy(() => {
    document.removeEventListener("mousedown", handleDocClick);
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("keydown", handleAnyInteraction);
    window.removeEventListener("quillium:caret-moved", handleCaretMoved);
    if (trackingTimer !== null) clearTimeout(trackingTimer);
    if (sleepTimer !== null) clearTimeout(sleepTimer);
    stopAutoAI();
});
```

- [ ] **Step 6: Replace the bubble icon content with AutoAIFace**

In the template, find the entire bubble layer button contents — the `{#if noApiKey}` lock icon block and the `{:else}` quill icon block:

```svelte
        <button
            onclick={toggleOpen}
            aria-label={noApiKey ? "AutoAI — add an API key to enable" : autoAIRunning ? "AutoAI active — click to configure" : "AutoAI paused — click to configure"}
            aria-expanded={open}
            class="w-full h-full flex items-center justify-center rounded-[inherit]
                   bg-transparent border-none cursor-pointer
                   {noApiKey ? 'text-gray-400' : 'text-amber-700'}"
        >
            {#if noApiKey}
                <!-- Lock icon -->
                <svg width="26" height="26" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <rect x="3.5" y="7" width="9" height="7" rx="1.5" stroke="currentColor" stroke-width="1.5"/>
                    <path d="M5.5 7V5.5a2.5 2.5 0 015 0V7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
            {:else}
                <!-- Quill icon -->
                <svg width="28" height="28" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M13 2C10 3 8 6 6 9C6 13 6 13 6 13C7 11 9 10 11 9C13 8 13 8 13 8C11 9 10 11 9 14L7.5 14C7.5 14 7 12 7 10C8 5 10 4 12 3Z" fill="currentColor" opacity="0.85"/>
                    <circle cx="5.5" cy="13.5" r="1" fill="currentColor" opacity="0.5"/>
                </svg>
            {/if}
        </button>
```

Replace with:

```svelte
        <button
            onclick={toggleOpen}
            aria-label={noApiKey ? "AutoAI — add an API key to enable" : autoAIRunning ? "AutoAI active — click to configure" : "AutoAI paused — click to configure"}
            aria-expanded={open}
            class="w-full h-full flex items-center justify-center rounded-[inherit]
                   bg-transparent border-none cursor-pointer"
        >
            <AutoAIFace
                state={faceState}
                eyeOffsetX={eyeOffsetX}
                eyeOffsetY={eyeOffsetY}
            />
        </button>
```

- [ ] **Step 7: Replace the small header icon with AutoAIFace**

In the panel header, find the `bubble-icon` div:

```svelte
                <div class="bubble-icon {autoAIRunning && !locked ? 'bubble-icon-active' : ''}">
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                        <path d="M13 2C10 3 8 6 6 9C6 13 6 13 6 13C7 11 9 10 11 9C13 8 13 8 13 8C11 9 10 11 9 14L7.5 14C7.5 14 7 12 7 10C8 5 10 4 12 3Z" fill="currentColor" opacity="0.85"/>
                        <circle cx="5.5" cy="13.5" r="1" fill="currentColor" opacity="0.5"/>
                    </svg>
                </div>
```

Replace with:

```svelte
                <div class="bubble-icon {autoAIRunning && !locked ? 'bubble-icon-active' : ''}">
                    <div style="transform: scale(0.38); transform-origin: center; width: 42px; height: 30px; display: flex; align-items: center; justify-content: center;">
                        <AutoAIFace state={faceState} eyeOffsetX={0} eyeOffsetY={0} />
                    </div>
                </div>
```

- [ ] **Step 8: Type-check**

```bash
bun run check
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add src/lib/autoai/AutoAIWidget.svelte
git commit -m ":sparkles: feat(autoai): wire AutoAIFace into widget with state machine + tracking"
```

---

## Task 4: Emit caret position from the editor

**Files:**
- Modify: `src/lib/editor/listeners.ts`

The widget needs to know where the caret is. We dispatch a `quillium:caret-moved` CustomEvent from the existing `update` listener.

- [ ] **Step 1: Add caret event dispatch to the save listener**

In `listeners.ts`, find the `save` listener at the bottom:

```ts
const save = EditorView.updateListener.of((update: ViewUpdate) => {
    if (update.docChanged || annotationsChanged(update)) {
        persistTransaction(update);
    }
});
```

Replace with:

```ts
const save = EditorView.updateListener.of((update: ViewUpdate) => {
    if (update.docChanged || annotationsChanged(update)) {
        persistTransaction(update);
    }
    // Broadcast caret position for AutoAIFace eye tracking.
    if (update.selectionSet || update.docChanged) {
        const pos = update.state.selection.main.head;
        const coords = update.view.coordsAtPos(pos);
        if (coords) {
            window.dispatchEvent(
                new CustomEvent("quillium:caret-moved", {
                    detail: { x: coords.left, y: (coords.top + coords.bottom) / 2 },
                }),
            );
        }
    }
});
```

- [ ] **Step 2: Type-check**

```bash
bun run check
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/editor/listeners.ts
git commit -m ":sparkles: feat(editor): broadcast caret position for AutoAIFace tracking"
```

---

## Task 5: Manual smoke test

**Files:** none (testing only)

Run the app and verify all states visually.

- [ ] **Step 1: Start dev server**

```bash
bun run dev
```

Open the app in the browser. Open a document.

- [ ] **Step 2: Verify idle state**

The AutoAI bubble should show two vertical bar eyes. Both eyes should blink simultaneously every ~3s. If no API key: should show × eyes with dimmed bubble.

- [ ] **Step 3: Verify tracking state**

Move the mouse around the screen — the eyes should drift toward the cursor (up to 4px). Click in the editor and move the caret (arrow keys or typing) — the eyes should track the caret position. After 1s of no movement, eyes should return to center and idle blink should resume.

- [ ] **Step 4: Verify thinking state**

Enable AutoAI, set mode to "Auto", set a short delay (2s). Type something (≥20 chars), then stop. After the debounce fires (2s), the face should switch to the >_< with head bob before the rainbow border starts spinning.

- [ ] **Step 5: Verify reviewing state**

While the AI call is running (`aiProcessing.active`), the bubble should show the rainbow spinning border and the eyes should be a narrow squint scanning left→right, dropping a line, repeating.

- [ ] **Step 6: Verify sleeping state**

Leave the app idle (no mouse movement, no typing) for 60 seconds. The eyes should rotate to horizontal bars with zzz floating up. Move the mouse — should immediately return to idle.

- [ ] **Step 7: Commit smoke-test sign-off**

```bash
git commit --allow-empty -m ":white_check_mark: test(autoai): manual smoke test passed — all face states verified"
```
