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
        background: rgba(229, 231, 235, 0.95);
        border: 1px solid rgba(255, 255, 255, 0.7);
        border-radius: 14px;
        box-shadow: 0 14px 28px -10px rgba(0, 0, 0, 0.25);
        backdrop-filter: blur(8px);
        padding: 12px;
        z-index: 40;
    }

    .tutorial-inline-guide-title {
        font-size: 13px;
        font-weight: 600;
        color: rgba(0, 0, 0, 0.82);
    }

    .tutorial-inline-guide-body {
        margin-top: 4px;
        font-size: 12px;
        line-height: 1.45;
        color: rgba(0, 0, 0, 0.62);
    }

    .tutorial-inline-guide-hint {
        margin-top: 8px;
        font-size: 11px;
        line-height: 1.35;
        color: rgba(146, 64, 14, 1);
        background: rgba(255, 251, 235, 0.95);
        border: 1px solid rgba(253, 230, 138, 0.9);
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
        color: rgba(0, 0, 0, 0.42);
    }

    .tutorial-inline-guide-skip:hover {
        color: rgba(0, 0, 0, 0.58);
    }

    .tutorial-inline-guide-back {
        font-size: 12px;
        border-radius: 9999px;
        padding: 6px 12px;
        color: rgba(0, 0, 0, 0.65);
        background: rgba(255, 255, 255, 0.7);
        border: 1px solid rgba(255, 255, 255, 0.8);
    }

    .tutorial-inline-guide-back:hover {
        background: rgba(255, 255, 255, 0.9);
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
