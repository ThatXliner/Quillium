<!-- WritingGoalsPanel.svelte — Goal controls embedded in writing statistics. -->
<script lang="ts">
import {
    type WritingGoalKind,
    goalPercent,
    setWritingGoalTarget,
    writingGoals,
} from "$lib/goals/writingGoals";
import { Target } from "lucide-svelte";

const rows = [
    { kind: "daily", label: "Daily", description: "Words added today" },
    { kind: "weekly", label: "Weekly", description: "Words added since Monday" },
    { kind: "total", label: "Document", description: "Total words in this document" },
] as const;

function updateTarget(kind: WritingGoalKind, event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    setWritingGoalTarget(kind, Number(input.value));
}
</script>

<section aria-labelledby="writing-goals-heading" class="flex flex-col gap-3">
    <div class="flex items-center gap-2">
        <Target size={14} class="text-amber-500" />
        <div>
            <h3 id="writing-goals-heading" class="text-[11px] font-semibold text-black/45 uppercase tracking-wider">
                Writing goals
            </h3>
            <p class="text-[11px] text-black/30">Saved separately for this document</p>
        </div>
    </div>

    <div class="grid gap-2.5">
        {#each rows as row}
            {@const goal = $writingGoals[row.kind]}
            {@const percent = goalPercent(goal)}
            <div class="rounded-xl border border-black/[0.06] bg-black/[0.02] px-3.5 py-3">
                <div class="flex items-center gap-3">
                    <div class="min-w-0 flex-1">
                        <div class="flex items-baseline gap-2">
                            <span class="text-xs font-semibold text-black/65">{row.label}</span>
                            <span class="text-[10px] text-black/30">{row.description}</span>
                        </div>
                        <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-black/[0.07]">
                            <div
                                class="h-full rounded-full bg-amber-400 transition-[width] duration-500 ease-out"
                                class:bg-emerald-400={percent >= 100}
                                style={`width: ${percent}%`}
                            ></div>
                        </div>
                        <div class="mt-1 flex justify-between text-[10px] text-black/35 tabular-nums">
                            <span>{goal.progress.toLocaleString()} words</span>
                            <span>{goal.target > 0 ? `${percent}%` : "No goal set"}</span>
                        </div>
                    </div>
                    <label class="shrink-0 text-right">
                        <span class="sr-only">{row.label} word goal</span>
                        <input
                            type="number"
                            min="0"
                            step="100"
                            value={goal.target || ""}
                            placeholder="Set goal"
                            onchange={(event) => updateTarget(row.kind, event)}
                            class="w-24 rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-right text-xs text-black/65 tabular-nums outline-none transition focus:border-amber-400 focus:ring-2 focus:ring-amber-200/60"
                        />
                    </label>
                </div>
            </div>
        {/each}
    </div>
</section>
