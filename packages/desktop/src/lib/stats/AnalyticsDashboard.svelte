<!--
    AnalyticsDashboard.svelte — Feature-flagged history, goals, and export dashboard.

    Receives already-aggregated local history. It never sends document content or statistics
    off-device; export uses the same native save path as document export.
-->
<script lang="ts">
import { sanitizeFilename, saveWithDialog } from "$lib/export";
import { type DailyWriting, type WritingAnalytics, analyticsCsv } from "$lib/stats/analytics";
import { Download, Flame, Goal, Sunrise } from "lucide-svelte";
import { toast } from "svelte-sonner";

let {
    analytics,
    currentWords,
    draftId,
    documentTitle,
    loading,
    loadError,
}: {
    analytics: WritingAnalytics | null;
    currentWords: number;
    draftId: string;
    documentTitle: string;
    loading: boolean;
    loadError: string | null;
} = $props();

type Period = "daily" | "weekly";
type Range = 7 | 30 | 90;
type GoalRecord = { target: number };

let period = $state<Period>("daily");
let range = $state<Range>(30);
let goalTarget = $state(0);
let goalInput = $state("");

const goalKey = $derived(`quillium:writing-goal:${draftId}`);

$effect(() => {
    const key = goalKey;
    try {
        const stored = JSON.parse(localStorage.getItem(key) ?? "null") as GoalRecord | null;
        goalTarget = stored?.target ?? 0;
        goalInput = goalTarget > 0 ? String(goalTarget) : "";
    } catch {
        goalTarget = 0;
        goalInput = "";
    }
});

function dateKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function filledDays(source: DailyWriting[], days: number): DailyWriting[] {
    const byDate = new Map(source.map((day) => [day.date, day]));
    const result: DailyWriting[] = [];
    const cursor = new Date();
    cursor.setHours(12, 0, 0, 0);
    cursor.setDate(cursor.getDate() - days + 1);
    for (let index = 0; index < days; index++) {
        const key = dateKey(cursor);
        result.push(byDate.get(key) ?? { date: key, words: 0, sessions: 0 });
        cursor.setDate(cursor.getDate() + 1);
    }
    return result;
}

function weekLabel(date: string): string {
    const value = new Date(`${date}T12:00:00`);
    value.setDate(value.getDate() - ((value.getDay() + 6) % 7));
    return dateKey(value);
}

function chartSeries(source: DailyWriting[], days: number, chartPeriod: Period): DailyWriting[] {
    const filled = filledDays(source, days);
    if (chartPeriod === "daily") return filled;
    const weeks = new Map<string, DailyWriting>();
    for (const day of filled) {
        const key = weekLabel(day.date);
        const week = weeks.get(key) ?? { date: key, words: 0, sessions: 0 };
        week.words += day.words;
        week.sessions += day.sessions;
        weeks.set(key, week);
    }
    return [...weeks.values()];
}

let series = $derived(chartSeries(analytics?.daily ?? [], range, period));
let maxWords = $derived(Math.max(1, ...series.map((day) => day.words)));
let goalProgress = $derived(goalTarget > 0 ? Math.min(100, (currentWords / goalTarget) * 100) : 0);
let goalTrendPoints = $derived(buildGoalTrendPoints(series, currentWords, goalTarget));

function buildGoalTrendPoints(points: DailyWriting[], wordsNow: number, target: number): string {
    if (points.length === 0 || target <= 0) return "";
    const wordsInRange = points.reduce((sum, point) => sum + point.words, 0);
    let cumulative = Math.max(0, wordsNow - wordsInRange);
    return points
        .map((point, index) => {
            cumulative += point.words;
            const x = points.length === 1 ? 240 : (index / (points.length - 1)) * 240;
            const y = 48 - Math.min(1, cumulative / target) * 44;
            return `${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(" ");
}

function formatHour(hour: number | null): string {
    if (hour === null) return "—";
    const start = new Date(2026, 0, 1, hour);
    const end = new Date(2026, 0, 1, (hour + 1) % 24);
    const format = new Intl.DateTimeFormat(undefined, { hour: "numeric" });
    return `${format.format(start)}–${format.format(end)}`;
}

function formatChartDate(date: string): string {
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(
        new Date(`${date}T12:00:00`),
    );
}

function saveGoal(): void {
    const parsed = Number.parseInt(goalInput, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        goalTarget = 0;
        goalInput = "";
        localStorage.removeItem(goalKey);
        return;
    }
    goalTarget = parsed;
    localStorage.setItem(goalKey, JSON.stringify({ target: parsed } satisfies GoalRecord));
}

async function exportAnalytics(format: "csv" | "json"): Promise<void> {
    if (!analytics) return;
    const content =
        format === "csv"
            ? analyticsCsv(analytics)
            : JSON.stringify(
                  {
                      exportedAt: new Date().toISOString(),
                      documentTitle,
                      currentWords,
                      goal: goalTarget || null,
                      ...analytics,
                  },
                  null,
                  2,
              );
    try {
        const saved = await saveWithDialog(
            content,
            `${sanitizeFilename(documentTitle)}-writing-analytics.${format}`,
            format,
        );
        if (saved) toast.success("Writing analytics exported");
    } catch (error) {
        console.error("[stats] analytics export failed", error);
        toast.error("Analytics export failed");
    }
}
</script>

{#if loading}
    <div class="py-16 text-center text-sm text-black/35 animate-pulse">Reading writing history…</div>
{:else if loadError}
    <div class="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700/70">{loadError}</div>
{:else if analytics}
    <div class="grid grid-cols-4 gap-2.5 max-[620px]:grid-cols-2">
        <div class="metric-card">
            <Flame size={16} class="text-orange-400" />
            <strong>{analytics.currentStreak} days</strong>
            <span>Current streak</span>
        </div>
        <div class="metric-card">
            <Flame size={16} class="text-amber-400" />
            <strong>{analytics.longestStreak} days</strong>
            <span>Longest streak</span>
        </div>
        <div class="metric-card">
            <Goal size={16} class="text-emerald-400" />
            <strong>{analytics.averageWordsPerSession.toLocaleString()}</strong>
            <span>Words / session</span>
        </div>
        <div class="metric-card">
            <Sunrise size={16} class="text-blue-400" />
            <strong>{formatHour(analytics.mostProductiveHour)}</strong>
            <span>Most productive</span>
        </div>
    </div>

    <section class="dashboard-card">
        <div class="flex items-center justify-between gap-3 flex-wrap">
            <div>
                <h3>Words written</h3>
                <p>{analytics.totalWordsWritten.toLocaleString()} words recorded in this draft</p>
            </div>
            <div class="flex items-center gap-2">
                <div class="segmented" aria-label="Chart period">
                    <button class:active={period === "daily"} onclick={() => (period = "daily")}>Day</button>
                    <button class:active={period === "weekly"} onclick={() => (period = "weekly")}>Week</button>
                </div>
                <select bind:value={range} aria-label="Chart range">
                    <option value={7}>7 days</option>
                    <option value={30}>30 days</option>
                    <option value={90}>90 days</option>
                </select>
            </div>
        </div>

        <div class="bar-chart" aria-label="Words written chart">
            {#each series as day, index (day.date)}
                <div class="bar-column" title={`${formatChartDate(day.date)}: ${day.words} words`}>
                    <div class="bar" style={`height: ${Math.max(day.words > 0 ? 4 : 1, (day.words / maxWords) * 100)}%`}></div>
                    {#if index === 0 || index === series.length - 1 || series.length <= 8}
                        <span>{formatChartDate(day.date)}</span>
                    {/if}
                </div>
            {/each}
        </div>
    </section>

    <div class="grid grid-cols-2 gap-3 max-[620px]:grid-cols-1">
        <section class="dashboard-card">
            <h3>Draft goal</h3>
            <p>{currentWords.toLocaleString()}{goalTarget ? ` of ${goalTarget.toLocaleString()}` : " words now"}</p>
            {#if goalTarget > 0}
                <div class="goal-track"><div style={`width: ${goalProgress}%`}></div></div>
                <span class="goal-caption">{Math.round(goalProgress)}% complete</span>
                <svg
                    class="goal-trend"
                    viewBox="0 0 240 52"
                    preserveAspectRatio="none"
                    role="img"
                    aria-label="Goal progress over the selected period"
                >
                    <line x1="0" y1="4" x2="240" y2="4" class="goal-line"></line>
                    <polyline points={goalTrendPoints} class="progress-line"></polyline>
                </svg>
                <span class="goal-caption">Progress over the selected period</span>
            {/if}
            <div class="goal-input">
                <input bind:value={goalInput} inputmode="numeric" placeholder="Set a word goal" aria-label="Draft word goal" />
                <button onclick={saveGoal}>{goalTarget ? "Update" : "Set goal"}</button>
            </div>
        </section>

        <section class="dashboard-card">
            <h3>Export statistics</h3>
            <p>Save daily history and summary metrics for your records.</p>
            <div class="flex gap-2 mt-auto pt-5">
                <button class="export-button" onclick={() => exportAnalytics("csv")}>
                    <Download size={14} /> CSV
                </button>
                <button class="export-button" onclick={() => exportAnalytics("json")}>
                    <Download size={14} /> JSON
                </button>
            </div>
        </section>
    </div>
{:else}
    <div class="py-16 text-center">
        <p class="text-sm font-medium text-black/50">No writing history yet</p>
        <p class="text-xs text-black/30 mt-1">Your trends will appear after you start writing.</p>
    </div>
{/if}

<style>
    .metric-card {
        min-width: 0;
        border-radius: 0.75rem;
        background: rgba(0, 0, 0, 0.03);
        padding: 0.8rem;
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
    }
    .metric-card strong { font-size: 1rem; color: rgba(0, 0, 0, 0.72); }
    .metric-card span { font-size: 0.68rem; color: rgba(0, 0, 0, 0.38); }
    .dashboard-card {
        border: 1px solid rgba(0, 0, 0, 0.06);
        border-radius: 0.85rem;
        padding: 1rem;
        display: flex;
        flex-direction: column;
    }
    .dashboard-card h3 { font-size: 0.78rem; font-weight: 650; color: rgba(0, 0, 0, 0.62); }
    .dashboard-card p { margin-top: 0.15rem; font-size: 0.7rem; color: rgba(0, 0, 0, 0.36); }
    .segmented { display: flex; padding: 0.15rem; border-radius: 0.45rem; background: rgba(0, 0, 0, 0.04); }
    .segmented button { padding: 0.25rem 0.5rem; border-radius: 0.35rem; font-size: 0.65rem; color: rgba(0, 0, 0, 0.38); }
    .segmented button.active { background: white; color: rgba(0, 0, 0, 0.65); box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08); }
    select { border-radius: 0.45rem; background: rgba(0, 0, 0, 0.04); padding: 0.35rem 0.5rem; font-size: 0.65rem; color: rgba(0, 0, 0, 0.5); }
    .bar-chart { height: 9rem; display: flex; align-items: end; gap: 0.22rem; margin-top: 1rem; padding-top: 0.5rem; border-bottom: 1px solid rgba(0, 0, 0, 0.06); }
    .bar-column { position: relative; flex: 1; height: 100%; display: flex; align-items: end; min-width: 2px; }
    .bar { width: 100%; min-height: 1px; border-radius: 3px 3px 0 0; background: rgba(16, 185, 129, 0.55); transition: height 180ms ease; }
    .bar-column span { position: absolute; top: calc(100% + 0.35rem); font-size: 0.52rem; color: rgba(0, 0, 0, 0.28); white-space: nowrap; }
    .bar-column:last-child span { right: 0; }
    .goal-track { height: 0.4rem; overflow: hidden; border-radius: 999px; background: rgba(0, 0, 0, 0.06); margin-top: 0.8rem; }
    .goal-track div { height: 100%; border-radius: inherit; background: rgba(16, 185, 129, 0.58); }
    .goal-caption { margin-top: 0.3rem; font-size: 0.62rem; color: rgba(0, 0, 0, 0.36); }
    .goal-trend { width: 100%; height: 3.25rem; margin-top: 0.65rem; overflow: visible; }
    .goal-line { stroke: rgba(0, 0, 0, 0.12); stroke-width: 1; stroke-dasharray: 4 4; }
    .progress-line { fill: none; stroke: rgba(16, 185, 129, 0.68); stroke-width: 2; vector-effect: non-scaling-stroke; }
    .goal-input { display: flex; gap: 0.4rem; margin-top: auto; padding-top: 0.8rem; }
    .goal-input input { min-width: 0; flex: 1; border-radius: 0.5rem; background: rgba(0, 0, 0, 0.035); padding: 0.45rem 0.55rem; font-size: 0.7rem; outline: none; }
    .goal-input button, .export-button { border-radius: 0.5rem; background: rgba(0, 0, 0, 0.055); padding: 0.45rem 0.65rem; font-size: 0.68rem; color: rgba(0, 0, 0, 0.55); }
    .goal-input button:hover, .export-button:hover { background: rgba(0, 0, 0, 0.09); }
    .export-button { display: inline-flex; align-items: center; gap: 0.3rem; }
</style>
