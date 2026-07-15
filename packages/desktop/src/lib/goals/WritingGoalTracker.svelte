<!--
    WritingGoalTracker.svelte — Live goal progress pill and tracking host.

    Mounted for the lifetime of the editor route so goals continue tracking even
    while the statistics modal is closed. Clicking opens the modal to edit goals.
-->
<script lang="ts">
import {
    activateWritingGoals,
    goalPercent,
    recordWritingGoalWords,
    writingGoals,
} from "$lib/goals/writingGoals";
import { currentDocumentId, statsOpen, writingStats } from "$lib/stores";
import { Target } from "lucide-svelte";
import { toast } from "svelte-sonner";

let activeDocumentId: string | null = null;

const activeGoal = $derived.by(() => {
    const goals = $writingGoals;
    const candidates = [
        { kind: "daily", label: "Today", goal: goals.daily },
        { kind: "weekly", label: "This week", goal: goals.weekly },
        { kind: "total", label: "Document", goal: goals.total },
    ] as const;
    const configured = candidates.filter(({ goal }) => goal.target > 0);
    return (
        configured.find(({ goal }) => goal.progress < goal.target) ??
        configured[configured.length - 1]
    );
});

$effect(() => {
    const documentId = $currentDocumentId;
    const wordCount = $writingStats.words;
    if (documentId !== activeDocumentId) {
        activeDocumentId = documentId;
        activateWritingGoals(documentId, wordCount);
        return;
    }

    for (const kind of recordWritingGoalWords(wordCount)) {
        const label = kind === "daily" ? "Daily" : kind === "weekly" ? "Weekly" : "Document";
        toast.success(`${label} writing goal reached!`, {
            description: "A fine moment to enjoy the words you made.",
        });
    }
});
</script>

{#if activeGoal}
    {@const percent = goalPercent(activeGoal.goal)}
    <button
        type="button"
        onclick={() => ($statsOpen = true)}
        aria-label={`${activeGoal.label} writing goal: ${activeGoal.goal.progress} of ${activeGoal.goal.target} words, ${percent}%`}
        title="Open writing goals"
        class="goal-pill rounded-[2rem] shadow-lg cursor-pointer select-none"
        class:goal-complete={percent >= 100}
    >
        <div
            class="relative min-w-44 overflow-hidden backdrop-blur-md rounded-[2rem] bg-amber-50/80 border border-white/50 px-4 py-2"
        >
            <div
                class="absolute inset-y-0 left-0 bg-amber-300/25 transition-[width] duration-500 ease-out"
                style={`width: ${percent}%`}
                aria-hidden="true"
            ></div>
            <div class="relative flex items-center gap-2 text-xs text-amber-950/75 tabular-nums">
                <Target size={14} class="text-amber-600 shrink-0" />
                <span class="font-medium">{activeGoal.label}</span>
                <span class="ml-auto">
                    {activeGoal.goal.progress.toLocaleString()} / {activeGoal.goal.target.toLocaleString()}
                </span>
                <span class="font-semibold">{percent}%</span>
            </div>
        </div>
    </button>
{/if}

<style>
    .goal-complete {
        animation: goal-glow 1.8s ease-in-out 2;
    }

    @keyframes goal-glow {
        50% {
            transform: translateY(-2px) scale(1.02);
            box-shadow: 0 0 0 5px rgb(251 191 36 / 20%), 0 10px 25px rgb(146 64 14 / 20%);
        }
    }

    @media (prefers-reduced-motion: reduce) {
        .goal-complete {
            animation: none;
        }
    }
</style>
