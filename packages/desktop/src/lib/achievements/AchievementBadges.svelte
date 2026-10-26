<!--
    AchievementBadges.svelte — Persistent milestone badge gallery.

    Rendered in Writing Statistics so achievements are discoverable without
    adding another permanent toolbar control.
-->
<script lang="ts">
import { ACHIEVEMENTS, type AchievementCategory } from "$lib/achievements/definitions";
import { achievementState } from "$lib/achievements/store";
import { currentWritingStreak } from "$lib/achievements/tracker";
import { Award } from "lucide-svelte";

const sections: Array<{ category: AchievementCategory; label: string }> = [
    { category: "words", label: "Word milestones" },
    { category: "streak", label: "Writing streaks" },
    { category: "sprints", label: "Writing sprints" },
];

const unlockedCount = $derived(Object.keys($achievementState.unlockedAt).length);
const streak = $derived(currentWritingStreak($achievementState));

function progress(category: AchievementCategory): number {
    if (category === "words") return $achievementState.maxDraftWordCount;
    if (category === "streak") return streak;
    return $achievementState.completedSprints;
}
</script>

<section aria-labelledby="achievement-heading" class="flex flex-col gap-3">
    <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
            <Award size={15} class="text-amber-500/70" />
            <h3 id="achievement-heading" class="text-[11px] font-semibold text-black/40 uppercase tracking-wider">
                Achievements
            </h3>
        </div>
        <span class="text-[11px] tabular-nums text-black/30">{unlockedCount}/{ACHIEVEMENTS.length} unlocked</span>
    </div>

    {#each sections as section}
        <div>
            <div class="mb-1.5 flex items-center justify-between">
                <span class="text-xs font-medium text-black/45">{section.label}</span>
                <span class="text-[10px] tabular-nums text-black/25">
                    {progress(section.category).toLocaleString()}
                    {section.category === "streak" ? " days" : section.category === "sprints" ? " completed" : " words"}
                </span>
            </div>
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {#each ACHIEVEMENTS.filter((achievement) => achievement.category === section.category) as achievement}
                    {@const unlocked = Boolean($achievementState.unlockedAt[achievement.id])}
                    <div
                        class="badge-card"
                        class:badge-unlocked={unlocked}
                        aria-label={`${achievement.title}: ${unlocked ? "unlocked" : "locked"}`}
                    >
                        <div class="badge-symbol" aria-hidden="true">{achievement.symbol}</div>
                        <div class="min-w-0">
                            <div class="truncate text-[11px] font-semibold text-black/60">{achievement.title}</div>
                            <div class="mt-0.5 text-[9px] leading-tight text-black/35">{achievement.description}</div>
                        </div>
                    </div>
                {/each}
            </div>
        </div>
    {/each}
</section>

<style>
    .badge-card {
        display: flex;
        min-height: 3.5rem;
        align-items: center;
        gap: 0.5rem;
        border: 1px solid rgba(0, 0, 0, 0.05);
        border-radius: 0.65rem;
        background: rgba(0, 0, 0, 0.018);
        padding: 0.55rem;
        filter: grayscale(1);
        opacity: 0.48;
    }

    .badge-card.badge-unlocked {
        border-color: rgba(245, 158, 11, 0.2);
        background: linear-gradient(145deg, rgba(251, 191, 36, 0.13), rgba(249, 115, 22, 0.05));
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.75);
        filter: none;
        opacity: 1;
    }

    .badge-symbol {
        display: flex;
        width: 1.75rem;
        height: 1.75rem;
        flex: 0 0 auto;
        align-items: center;
        justify-content: center;
        border-radius: 9999px;
        background: rgba(0, 0, 0, 0.06);
        color: rgba(0, 0, 0, 0.35);
        font-size: 0.8rem;
    }

    .badge-unlocked .badge-symbol {
        background: linear-gradient(145deg, #fbbf24, #f97316);
        color: white;
        box-shadow: 0 3px 8px rgba(249, 115, 22, 0.2);
    }
</style>
