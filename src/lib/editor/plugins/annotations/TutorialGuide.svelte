<script lang="ts">
import { tutorialModalGuide, tutorialNavCommand } from "$lib/stores";
</script>

{#if $tutorialModalGuide.visible}
    <div class="tutorial-inline-guide">
        <div class="tutorial-inline-guide-title">{$tutorialModalGuide.title}</div>
        <p class="tutorial-inline-guide-body">{$tutorialModalGuide.body}</p>
        {#if $tutorialModalGuide.hint}
            <div class="tutorial-inline-guide-hint">{$tutorialModalGuide.hint}</div>
        {/if}
        <div class="tutorial-inline-guide-actions">
            <button
                class="tutorial-inline-guide-skip"
                onclick={() => tutorialNavCommand.set("skip")}
            >
                Skip tour
            </button>
            <div class="tutorial-inline-guide-main-actions">
                {#if $tutorialModalGuide.canBack}
                    <button
                        class="tutorial-inline-guide-back"
                        onclick={() => tutorialNavCommand.set("back")}
                    >
                        Back
                    </button>
                {/if}
                <button
                    class="tutorial-inline-guide-next"
                    disabled={$tutorialModalGuide.nextDisabled}
                    onclick={() => tutorialNavCommand.set("next")}
                >
                    {$tutorialModalGuide.isLast ? "Done" : "Next"}
                </button>
            </div>
        </div>
    </div>
{/if}

<style>
    .tutorial-inline-guide {
        position: absolute;
        right: 12px;
        bottom: 12px;
        width: 320px;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 14px;
        box-shadow: 0 14px 28px -10px rgba(var(--shadow-color), 0.25);
        backdrop-filter: blur(8px);
        padding: 12px;
        z-index: 40;
    }

    .tutorial-inline-guide-title {
        font-size: 13px;
        font-weight: 600;
        color: var(--text-strong);
    }

    .tutorial-inline-guide-body {
        margin-top: 4px;
        font-size: 12px;
        line-height: 1.45;
        color: var(--text-soft);
    }

    .tutorial-inline-guide-hint {
        margin-top: 8px;
        font-size: 11px;
        line-height: 1.35;
        color: var(--accent-amber-text);
        background: var(--chip-amber);
        border: 1px solid var(--chip-amber-border);
        border-radius: 8px;
        padding: 6px 8px;
    }

    .tutorial-inline-guide-actions {
        margin-top: 10px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
    }

    .tutorial-inline-guide-main-actions {
        display: flex;
        gap: 8px;
    }

    .tutorial-inline-guide-skip {
        font-size: 11px;
        color: var(--text-faint);
    }

    .tutorial-inline-guide-skip:hover {
        color: var(--text-soft);
    }

    .tutorial-inline-guide-back {
        font-size: 12px;
        border-radius: 9999px;
        padding: 6px 12px;
        color: var(--text-soft);
        background: var(--surface-2);
        border: 1px solid var(--border);
    }

    .tutorial-inline-guide-back:hover {
        background: var(--surface-3);
    }

    .tutorial-inline-guide-next {
        font-size: 12px;
        border-radius: 9999px;
        padding: 6px 12px;
        color: white;
        background: rgb(59, 130, 246);
    }

    .tutorial-inline-guide-next:hover {
        background: rgb(37, 99, 235);
    }

    .tutorial-inline-guide-next:disabled {
        background: rgb(147, 197, 253);
        cursor: not-allowed;
    }
</style>
