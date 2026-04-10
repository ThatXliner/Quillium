<script lang="ts">
export type FaceState =
    | "idle"
    | "tracking"
    | "thinking"
    | "reviewing"
    | "sleeping"
    | "waking"
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

    {:else if state === "waking"}
        <!-- stretch open from horizontal → tall, slight overshoot -->
        <rect class="wake-eye" x="9"  y="7" width="4" height="14" rx="2" fill="#5c4a2a"/>
        <rect class="wake-eye" x="25" y="7" width="4" height="14" rx="2" fill="#5c4a2a"/>

    {:else}
        <!-- idle / tracking: vertical bar eyes, offset by eyeOffsetX/Y.
             The tracking translate lives on a <g> wrapper so it doesn't
             conflict with the blink scaleY animation on the inner <rect>. -->
        <g style="transform: {tx}">
            <rect
                class="bar-eye {state === 'idle' ? 'blink' : ''}"
                x="9"  y="7" width="4" height="14" rx="2" fill="#5c4a2a"
            />
        </g>
        <g style="transform: {tx}">
            <rect
                class="bar-eye {state === 'idle' ? 'blink' : ''}"
                x="25" y="7" width="4" height="14" rx="2" fill="#5c4a2a"
            />
        </g>
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
</style>
