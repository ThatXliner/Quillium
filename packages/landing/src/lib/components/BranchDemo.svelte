<script lang="ts">
// BranchDemo.svelte — a tiny *working* revision picker used as the hero
// visual. Show-don't-tell: the visitor clicks Original / Take 2 / Take 3 and
// watches the highlighted sentence swap in place, which explains "write in
// branches" faster than any paragraph. Mirrors the demo-duo composition in
// Hero3DV2 but is theme-aware (uses the layout.css tokens) because it sits in
// the normal page flow, not the flight's self-lit paper sky.
import posthog from "posthog-js";

const DRAFTS = [
    "The rain found her before the door did.",
    "She stepped out into the waiting rain.",
    "Rain met her at the threshold.",
];

let activeDraft = $state(0);
let interacted = false;

function pick(i: number) {
    activeDraft = i;
    if (!interacted) {
        interacted = true;
        posthog.capture("hero_branch_demo_interacted");
    }
}
</script>

<div class="branch-demo" role="group" aria-label="Interactive revision demo — pick a version">
    <div class="demo-doc">
        <p>The evening had been threatening for hours.</p>
        <p><mark class="demo-highlight">{DRAFTS[activeDraft]}</mark></p>
        <p>She did not reach for the umbrella.</p>
    </div>
    <div class="demo-card">
        <p class="demo-label">Revision</p>
        <div class="demo-pills">
            {#each ["Original", "Take 2", "Take 3"] as label, i (label)}
                <button
                    class="demo-pill"
                    class:demo-pill--active={activeDraft === i}
                    onclick={() => pick(i)}
                >
                    {label}
                </button>
            {/each}
        </div>
        <p class="demo-new" aria-hidden="true">+ New version</p>
    </div>
</div>
<p class="demo-hint">↑ Real feature. Click a take — every version stays.</p>

<style>
    .branch-demo {
        display: flex;
        align-items: flex-start;
        justify-content: center;
    }
    .demo-doc {
        width: min(60vw, 320px);
        padding: 1.05rem 1.15rem;
        border-radius: 10px;
        background: var(--surface);
        border: 1px solid var(--border);
        box-shadow:
            0 18px 44px rgba(var(--shadow-color), 0.14),
            0 3px 10px rgba(var(--shadow-color), 0.08);
        font-family: Georgia, serif;
        font-size: 0.88rem;
        line-height: 1.65;
        color: var(--text);
        text-align: left;
    }
    .demo-doc p {
        margin: 0 0 0.55em;
    }
    .demo-doc p:last-child {
        margin-bottom: 0;
    }
    .demo-highlight {
        background: rgba(168, 85, 247, 0.16);
        border-radius: 3px;
        padding: 0 0.12em;
        color: inherit;
    }
    .demo-card {
        flex-shrink: 0;
        width: min(38vw, 200px);
        margin-left: -1.2rem;
        margin-top: 2.4rem;
        padding: 1rem 1.1rem 1.1rem;
        border-radius: 14px;
        background: var(--surface);
        border: 1px solid var(--border);
        box-shadow:
            0 18px 44px rgba(var(--shadow-color), 0.14),
            0 3px 10px rgba(var(--shadow-color), 0.08);
        text-align: left;
    }
    .demo-label {
        margin: 0 0 0.6rem;
        font-size: 0.62rem;
        font-weight: 600;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--accent-purple);
    }
    .demo-pills {
        display: flex;
        flex-wrap: wrap;
        gap: 0.4rem;
        margin-bottom: 0.75rem;
    }
    .demo-pill {
        padding: 0.25rem 0.7rem;
        border: none;
        border-radius: 9999px;
        font-size: 0.72rem;
        font-weight: 500;
        font-family: "Inter", sans-serif;
        background: rgba(128, 128, 128, 0.14);
        color: var(--text-soft);
        cursor: pointer;
        transition:
            background 200ms ease,
            color 200ms ease;
    }
    .demo-pill:hover {
        background: rgba(128, 128, 128, 0.24);
    }
    .demo-pill--active {
        background: var(--accent-purple);
        color: #fff;
    }
    .demo-pill--active:hover {
        background: var(--accent-purple-deep);
    }
    .demo-new {
        margin: 0.65rem 0 0;
        font-size: 0.68rem;
        font-weight: 500;
        font-family: "Inter", sans-serif;
        color: rgba(168, 85, 247, 0.65);
    }
    .demo-hint {
        margin: 1rem 0 0;
        font-size: 0.75rem;
        color: var(--text-faint);
    }

    /* Narrow phones: stack the card under the doc instead of overlapping */
    @media (max-width: 420px) {
        .branch-demo {
            flex-direction: column;
            align-items: center;
            gap: 0.75rem;
        }
        .demo-doc {
            width: min(88vw, 320px);
        }
        .demo-card {
            width: min(72vw, 240px);
            margin-left: 0;
            margin-top: 0;
        }
    }
</style>
