<script lang="ts">
import { onMount } from "svelte";

export type FaceState =
    | "idle"
    | "tracking"
    | "thinking"
    | "reviewing"
    | "sleeping"
    | "waking"
    | "disabled";

export type IdleVariant = "blink" | "double-blink" | "look-around" | "squint" | "wide-eyed" | "drowsy";

interface Props {
    faceState: FaceState;
    eyeOffsetX?: number; // –4 to +4, pixels
    eyeOffsetY?: number; // –4 to +4, pixels
    forceIdleVariant?: IdleVariant; // Debug override — locks idle to a specific variant
}

let { faceState, eyeOffsetX = 0, eyeOffsetY = 0, forceIdleVariant }: Props = $props();

// Tracking uses the live offset; idle recenters to 0,0 so the eyes settle
// back to the middle before the blink animation plays. The CSS transition
// on `.tracker` smooths the recenter so it glides rather than snapping.
const tx = $derived(
    faceState === "tracking"
        ? `translate(${eyeOffsetX.toFixed(1)}px, ${eyeOffsetY.toFixed(1)}px)`
        : "translate(0px, 0px)",
);

// Idle animation variants — randomly selected when idle begins
const IDLE_VARIANTS: IdleVariant[] = ["blink", "double-blink", "look-around", "squint", "wide-eyed", "drowsy"];
// Weights: blink is most common, others are occasional treats
const VARIANT_WEIGHTS: Record<IdleVariant, number> = {
    "blink": 40,
    "double-blink": 20,
    "look-around": 15,
    "squint": 10,
    "wide-eyed": 8,
    "drowsy": 7,
};

let idleVariant = $state<IdleVariant>("blink");
let variantTimer: ReturnType<typeof setTimeout> | null = null;

function pickRandomVariant(): IdleVariant {
    const total = Object.values(VARIANT_WEIGHTS).reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    for (const v of IDLE_VARIANTS) {
        r -= VARIANT_WEIGHTS[v];
        if (r <= 0) return v;
    }
    return "blink";
}

// Duration of each variant's animation cycle (ms)
const VARIANT_DURATIONS: Record<IdleVariant, number> = {
    "blink": 6000,
    "double-blink": 4000,
    "look-around": 5000,
    "squint": 3500,
    "wide-eyed": 3000,
    "drowsy": 4500,
};

function scheduleNextVariant() {
    if (variantTimer) clearTimeout(variantTimer);
    const duration = VARIANT_DURATIONS[idleVariant];
    variantTimer = setTimeout(() => {
        idleVariant = pickRandomVariant();
        scheduleNextVariant();
    }, duration);
}

// The active idle variant — forced override or random cycling
const activeIdleVariant = $derived(forceIdleVariant ?? idleVariant);
const activeIdleDuration = $derived(VARIANT_DURATIONS[activeIdleVariant]);

// Start/stop variant cycling based on faceState (skip when forced)
$effect(() => {
    if (forceIdleVariant) {
        if (variantTimer) {
            clearTimeout(variantTimer);
            variantTimer = null;
        }
        return;
    }
    if (faceState === "idle") {
        idleVariant = pickRandomVariant();
        scheduleNextVariant();
    } else {
        if (variantTimer) {
            clearTimeout(variantTimer);
            variantTimer = null;
        }
    }
});

onMount(() => {
    return () => {
        if (variantTimer) clearTimeout(variantTimer);
    };
});
</script>

<!-- aria-hidden: face is decorative; aria-label lives on the parent button -->
<svg
    aria-hidden="true"
    overflow="visible"
    width="42"
    height="30"
    viewBox="0 0 42 30"
>
    {#if faceState === "disabled"}
        <!-- × eyes -->
        <line x1="7"  y1="7"  x2="15" y2="21" stroke="#5c4a2a" stroke-width="3" stroke-linecap="round"/>
        <line x1="15" y1="7"  x2="7"  y2="21" stroke="#5c4a2a" stroke-width="3" stroke-linecap="round"/>
        <line x1="27" y1="7"  x2="35" y2="21" stroke="#5c4a2a" stroke-width="3" stroke-linecap="round"/>
        <line x1="35" y1="7"  x2="27" y2="21" stroke="#5c4a2a" stroke-width="3" stroke-linecap="round"/>

    {:else if faceState === "sleeping"}
        <!-- horizontal bars + zzz -->
        <rect class="sleep-eye" x="5"  y="12" width="14" height="4" rx="2" fill="#5c4a2a"/>
        <rect class="sleep-eye" x="23" y="12" width="14" height="4" rx="2" fill="#5c4a2a"/>
        <text class="zzz z1" x="38" y="14">z</text>
        <text class="zzz z2" x="40" y="9"  font-size="11">z</text>
        <text class="zzz z3" x="43" y="3"  font-size="13">Z</text>

    {:else if faceState === "thinking"}
        <!-- >_< face with head bob on the whole group -->
        <g class="think-face">
            <!-- left > eye -->
            <line class="eye-v" x1="5"  y1="7"  x2="13" y2="15"/>
            <line class="eye-v" x1="5"  y1="23" x2="13" y2="15"/>
            <!-- right < eye -->
            <line class="eye-v" x1="37" y1="7"  x2="29" y2="15"/>
            <line class="eye-v" x1="37" y1="23" x2="29" y2="15"/>
        </g>

    {:else if faceState === "reviewing"}
        <!-- narrow suspicious squint + reading scan -->
        <rect class="review-eye" x="9"  y="7" width="4" height="14" rx="2" fill="#5c4a2a"/>
        <rect class="review-eye" x="25" y="7" width="4" height="14" rx="2" fill="#5c4a2a"/>

    {:else if faceState === "waking"}
        <!-- stretch open from horizontal → tall, slight overshoot -->
        <rect class="wake-eye" x="9"  y="7" width="4" height="14" rx="2" fill="#5c4a2a"/>
        <rect class="wake-eye" x="25" y="7" width="4" height="14" rx="2" fill="#5c4a2a"/>

    {:else}
        <!-- idle / tracking: vertical bar eyes, offset by eyeOffsetX/Y.
             The tracking translate lives on a <g> wrapper so it doesn't
             conflict with the blink scaleY animation on the inner <rect>. -->
        <g class="tracker {faceState === 'tracking' ? 'live' : ''}" style="transform: {tx}">
            <rect
                class="bar-eye {faceState === 'idle' ? `idle-${activeIdleVariant}` : ''}"
                style={faceState === "idle" ? `--idle-duration: ${activeIdleDuration}ms` : undefined}
                x="9"  y="7" width="4" height="14" rx="2" fill="#5c4a2a"
            />
        </g>
        <g class="tracker {faceState === 'tracking' ? 'live' : ''}" style="transform: {tx}">
            <rect
                class="bar-eye {faceState === 'idle' ? `idle-${activeIdleVariant}` : ''}"
                style={faceState === "idle" ? `--idle-duration: ${activeIdleDuration}ms` : undefined}
                x="25" y="7" width="4" height="14" rx="2" fill="#5c4a2a"
            />
        </g>
    {/if}
</svg>

<style>
    /* ── Shared ── */
    .tracker {
        transition: transform 0.35s ease-out;
    }
    .tracker.live {
        transition: none;
    }
    .eye-v {
        stroke: #5c4a2a;
        stroke-width: 2.8;
        stroke-linecap: round;
        fill: none;
    }

    /* ── Idle variants: randomly selected animations ── */
    .bar-eye {
        transform-box: fill-box;
        transform-origin: center;
    }

    /* Standard blink — quick shut-open near end of cycle */
    @keyframes idle-blink {
        0%, 87%, 100% { transform: scaleY(1); }
        92%            { transform: scaleY(0.06); }
        96%            { transform: scaleY(1); }
    }
    .idle-blink {
        animation: idle-blink var(--idle-duration) ease-in-out infinite;
    }

    /* Double-blink — two quick blinks in succession */
    @keyframes idle-double-blink {
        0%, 70%, 100% { transform: scaleY(1); }
        75%            { transform: scaleY(0.06); }
        80%            { transform: scaleY(1); }
        85%            { transform: scaleY(0.06); }
        90%            { transform: scaleY(1); }
    }
    .idle-double-blink {
        animation: idle-double-blink var(--idle-duration) ease-in-out infinite;
    }

    /* Look-around — eyes glance left, center, right */
    @keyframes idle-look-around {
        0%, 100%  { transform: translateX(0px); }
        20%       { transform: translateX(-3px); }
        40%       { transform: translateX(-3px); }
        50%       { transform: translateX(0px); }
        70%       { transform: translateX(3px); }
        85%       { transform: translateX(3px); }
        95%       { transform: translateX(0px); }
    }
    .idle-look-around {
        animation: idle-look-around var(--idle-duration) ease-in-out infinite;
    }

    /* Squint — brief narrowing like focusing on something */
    @keyframes idle-squint {
        0%, 100%  { transform: scaleY(1); }
        30%       { transform: scaleY(0.4); }
        70%       { transform: scaleY(0.4); }
        85%       { transform: scaleY(1); }
    }
    .idle-squint {
        animation: idle-squint var(--idle-duration) ease-in-out infinite;
    }

    /* Wide-eyed — surprised/alert moment with taller eyes */
    @keyframes idle-wide-eyed {
        0%, 100%  { transform: scaleY(1) scaleX(1); }
        25%       { transform: scaleY(1.3) scaleX(0.9); }
        75%       { transform: scaleY(1.3) scaleX(0.9); }
        90%       { transform: scaleY(1) scaleX(1); }
    }
    .idle-wide-eyed {
        animation: idle-wide-eyed var(--idle-duration) ease-in-out infinite;
    }

    /* Drowsy — slow heavy blink like getting sleepy */
    @keyframes idle-drowsy {
        0%, 100%  { transform: scaleY(1); }
        30%       { transform: scaleY(0.2); }
        60%       { transform: scaleY(0.15); }
        80%       { transform: scaleY(0.8); }
        95%       { transform: scaleY(1); }
    }
    .idle-drowsy {
        animation: idle-drowsy var(--idle-duration) ease-in-out infinite;
    }

    /* ── Thinking: >_< head bob ── */
    @keyframes head-bob {
        0%, 100% { transform: translateX(0px); }
        25%       { transform: translateX(-1.5px); }
        75%       { transform: translateX(1.5px); }
    }
    .think-face {
        transform-box: fill-box;
        animation: head-bob 1s ease-in-out infinite;
    }

    /* ── Reviewing: narrow squint + line-scan ── */
    @keyframes scan-x {
        0%   { transform: translate(-3px, 0px) scaleY(0.22); }
        40%  { transform: translate(3px,  0px) scaleY(0.22); }
        50%  { transform: translate(-3px, 3px) scaleY(0.22); }
        90%  { transform: translate(3px,  3px) scaleY(0.22); }
        100% { transform: translate(-3px, 0px) scaleY(0.22); }
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

    /* ── Waking: slow sleepy yawn stretch ── */
    @keyframes wake {
        0%   { transform: scaleY(0.1) scaleX(2.0); }  /* flat sleeping bar */
        25%  { transform: scaleY(0.5) scaleX(1.5); }  /* sluggishly peeling open */
        55%  { transform: scaleY(1.5) scaleX(0.75); } /* wide-open yawn peak — lingers */
        75%  { transform: scaleY(1.5) scaleX(0.75); } /* hold the yawn */
        90%  { transform: scaleY(0.9) scaleX(1.05); } /* drooping closed a touch */
        100% { transform: scaleY(1) scaleX(1); }
    }
    .wake-eye {
        transform-box: fill-box;
        transform-origin: center;
        animation: wake 1.6s ease-in-out forwards;
    }
    @media (prefers-reduced-motion: reduce) {
        [class^="idle-"],
        [class*=" idle-"] {
            animation: none !important;
        }
    }
</style>
