<!--
    WritingSprint.svelte — Sprint setup, live countdown, completion summary,
    and persistent history for issue #232.

    The compact countdown is rendered in BottomLeftStack while a sprint runs.
    The status bar controls the shared sprintOpen store to launch this dialog.
-->
<script lang="ts">
import { ModalResizeHandles, RestoreSizeButton } from "@quillium/share";
import { writingStats } from "$lib/stores";
import { Check, Flag, History, Timer, X } from "lucide-svelte";
import { onMount } from "svelte";
import { toast } from "svelte-sonner";
import { formatCountdown } from "./model";
import {
    activeSprint,
    cancelActiveSprint,
    clearSprintHistory,
    completeActiveSprint,
    sprintHistory,
    sprintOpen,
    sprintSummary,
    startSprint,
} from "./state";

const PRESET_MINUTES = [5, 10, 15, 20, 30];

let dialogEl = $state<HTMLDialogElement>();
let selectedDuration = $state(20);
let customDuration = $state(45);
let useCustomDuration = $state(false);
let wordGoal = $state<number | null>(null);
let now = $state(Date.now());
let showHistory = $state(false);

const durationMinutes = $derived(useCustomDuration ? customDuration : selectedDuration);
const remainingMs = $derived($activeSprint ? $activeSprint.endsAt - now : 0);
const wordsWritten = $derived(
    $activeSprint ? Math.max(0, $writingStats.words - $activeSprint.startingWords) : 0,
);
const goalProgress = $derived(
    $activeSprint?.wordGoal
        ? Math.min(100, Math.round((wordsWritten / $activeSprint.wordGoal) * 100))
        : 0,
);
const totalHistoryWords = $derived(
    $sprintHistory.reduce((total, sprint) => total + sprint.wordsWritten, 0),
);

onMount(() => {
    const timer = window.setInterval(() => {
        now = Date.now();
        if ($activeSprint && now >= $activeSprint.endsAt) finishSprint();
    }, 250);
    return () => window.clearInterval(timer);
});

$effect(() => {
    if ($sprintOpen && dialogEl && !dialogEl.open) dialogEl.showModal();
    if (!$sprintOpen && dialogEl?.open) dialogEl.close();
});

function beginSprint(): void {
    const goal = wordGoal;
    if (!Number.isFinite(durationMinutes) || durationMinutes < 1 || durationMinutes > 480) {
        toast.error("Choose a sprint between 1 minute and 8 hours.");
        return;
    }
    if (goal !== null && (!Number.isFinite(goal) || goal < 1)) {
        toast.error("Word goal must be at least 1.");
        return;
    }
    startSprint(durationMinutes, goal, $writingStats.words);
    now = Date.now();
    $sprintOpen = false;
    toast.success("Sprint started — happy writing!");
}

function finishSprint(): void {
    const record = completeActiveSprint($writingStats.words);
    if (!record) return;
    playCompletionSound();
    toast.success(
        `Sprint complete — ${record.wordsWritten} words at ${record.wordsPerMinute} WPM.`,
    );
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        new Notification("Writing sprint complete", {
            body: `${record.wordsWritten} words · ${record.wordsPerMinute} WPM`,
        });
    }
    $sprintOpen = true;
}

function stopEarly(): void {
    completeActiveSprint($writingStats.words, Date.now(), false);
}

function discardSprint(): void {
    cancelActiveSprint();
    $sprintOpen = false;
}

function playCompletionSound(): void {
    try {
        const AudioContextClass = window.AudioContext;
        const context = new AudioContextClass();
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(660, context.currentTime);
        oscillator.frequency.setValueAtTime(880, context.currentTime + 0.12);
        gain.gain.setValueAtTime(0.0001, context.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.14, context.currentTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.35);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start();
        oscillator.stop(context.currentTime + 0.36);
        oscillator.addEventListener("ended", () => void context.close());
    } catch {
        // The in-app toast still provides a completion notification if audio is unavailable.
    }
}

function closeDialog(): void {
    $sprintOpen = false;
    $sprintSummary = null;
}

function handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape" && $sprintOpen) {
        event.preventDefault();
        closeDialog();
    }
}

function formatHistoryDate(timestamp: number): string {
    return new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
    }).format(timestamp);
}

let restoreSize = $state<(() => void) | undefined>();
</script>

<svelte:window onkeydown={handleKeydown} />

{#if $activeSprint}
    <button
        type="button"
        onclick={() => ($sprintOpen = true)}
        class="rounded-[2rem] shadow-lg select-none"
        aria-label={`Writing sprint — ${formatCountdown(remainingMs)} remaining`}
        title="Open writing sprint"
    >
        <div
            class="flex items-center gap-2 backdrop-blur-md rounded-[2rem] overflow-hidden bg-violet-100/80 border border-violet-200/60 px-4 py-2 text-sm text-violet-900 tabular-nums hover:bg-violet-100 transition-colors"
        >
            <Timer size={15} class="text-violet-500" />
            <span class="font-semibold">{formatCountdown(remainingMs)}</span>
            <span class="text-violet-700/65">· {wordsWritten} words</span>
            {#if $activeSprint.wordGoal}
                <span class="text-violet-700/65">· {goalProgress}%</span>
            {/if}
        </div>
    </button>
{/if}

{#if $sprintOpen}
    <dialog
        bind:this={dialogEl}
        class="open:flex flex-col overflow-hidden m-auto w-[30rem] max-w-[calc(100vw-2rem)] max-h-[calc(100vh-2rem)] rounded-2xl p-0 bg-white text-black shadow-2xl border border-black/[0.06] backdrop:bg-black/45"
        aria-label="Writing sprint"
        oncancel={(event) => {
            event.preventDefault();
            closeDialog();
        }}
        onclick={(event) => {
            if (event.target === dialogEl) closeDialog();
        }}
    >
        <div class="shrink-0 flex items-center justify-between px-6 py-4 border-b border-black/[0.06]">
            <div class="flex items-center gap-2.5">
                <Timer size={17} class="text-violet-500" />
                <h2 class="text-sm font-semibold text-black/70">Writing Sprint</h2>
            </div>
            <div class="flex items-center gap-1 shrink-0">
                <RestoreSizeButton {restoreSize} />
                <button
                    type="button"
                    onclick={closeDialog}
                    aria-label="Close writing sprint"
                    class="p-1.5 rounded-lg text-black/30 hover:text-black/60 hover:bg-black/5 transition-colors"
                ><X size={17} /></button>
            </div>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            {#if $sprintSummary}
                <div class="text-center py-2">
                    <div class="mx-auto mb-4 w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center">
                        <Check size={24} />
                    </div>
                    <h3 class="text-xl font-semibold text-black/80">
                        {$sprintSummary.completed ? "Sprint complete" : "Sprint ended"}
                    </h3>
                    <p class="text-sm text-black/40 mt-1">A focused session in the books.</p>
                    <div class="grid grid-cols-2 gap-3 mt-6">
                        <div class="rounded-xl bg-violet-50 px-4 py-4">
                            <div class="text-2xl font-semibold text-violet-700">{$sprintSummary.wordsWritten}</div>
                            <div class="text-xs text-violet-600/60 mt-1">Words written</div>
                        </div>
                        <div class="rounded-xl bg-emerald-50 px-4 py-4">
                            <div class="text-2xl font-semibold text-emerald-700">{$sprintSummary.wordsPerMinute}</div>
                            <div class="text-xs text-emerald-600/60 mt-1">Words per minute</div>
                        </div>
                    </div>
                    {#if $sprintSummary.wordGoal}
                        <p class="mt-4 text-sm text-black/45">
                            Goal: {$sprintSummary.wordsWritten.toLocaleString()} / {$sprintSummary.wordGoal.toLocaleString()} words
                        </p>
                    {/if}
                    <button
                        type="button"
                        onclick={() => ($sprintSummary = null)}
                        class="mt-6 px-5 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 transition-colors"
                    >Start another sprint</button>
                </div>
            {:else if $activeSprint}
                <div class="text-center py-2">
                    <div class="text-5xl font-semibold tracking-tight tabular-nums text-black/80">
                        {formatCountdown(remainingMs)}
                    </div>
                    <p class="mt-2 text-sm text-black/40">{$activeSprint.durationMinutes}-minute sprint</p>
                    <div class="mt-6 h-2 rounded-full bg-black/[0.06] overflow-hidden">
                        <div
                            class="h-full rounded-full bg-violet-500 transition-[width] duration-300"
                            style={`width: ${$activeSprint.wordGoal ? goalProgress : Math.min(100, Math.max(0, ((now - $activeSprint.startedAt) / ($activeSprint.endsAt - $activeSprint.startedAt)) * 100))}%`}
                        ></div>
                    </div>
                    <div class="mt-4 flex justify-center gap-6 text-sm">
                        <span><strong class="text-black/70">{wordsWritten}</strong> <span class="text-black/35">words</span></span>
                        {#if $activeSprint.wordGoal}
                            <span><strong class="text-black/70">{$activeSprint.wordGoal}</strong> <span class="text-black/35">goal</span></span>
                        {/if}
                    </div>
                    <div class="flex justify-center gap-3 mt-7">
                        <button
                            type="button"
                            onclick={stopEarly}
                            class="px-4 py-2 rounded-xl bg-black/[0.06] text-sm text-black/55 hover:bg-black/10 transition-colors"
                        >End & save</button>
                        <button
                            type="button"
                            onclick={discardSprint}
                            class="px-4 py-2 rounded-xl text-sm text-red-500/70 hover:bg-red-50 transition-colors"
                        >Discard</button>
                    </div>
                </div>
            {:else}
                <div class="flex items-center justify-between mb-4">
                    <div>
                        <h3 class="text-sm font-semibold text-black/65">Set your focus window</h3>
                        <p class="text-xs text-black/35 mt-0.5">The timer keeps running if you close this panel.</p>
                    </div>
                    <button
                        type="button"
                        onclick={() => (showHistory = !showHistory)}
                        aria-label="Sprint history"
                        class:!bg-violet-100={showHistory}
                        class:!text-violet-700={showHistory}
                        class="p-2 rounded-lg bg-black/[0.04] text-black/35 hover:text-black/60 transition-colors"
                    ><History size={17} /></button>
                </div>

                {#if showHistory}
                    <div>
                        <div class="grid grid-cols-2 gap-3 mb-4">
                            <div class="rounded-xl bg-black/[0.025] p-3.5">
                                <div class="text-xl font-semibold text-black/70">{$sprintHistory.length}</div>
                                <div class="text-xs text-black/35">Sprints</div>
                            </div>
                            <div class="rounded-xl bg-black/[0.025] p-3.5">
                                <div class="text-xl font-semibold text-black/70">{totalHistoryWords.toLocaleString()}</div>
                                <div class="text-xs text-black/35">Words written</div>
                            </div>
                        </div>
                        {#if $sprintHistory.length === 0}
                            <p class="py-8 text-center text-sm text-black/30">Your completed sprints will appear here.</p>
                        {:else}
                            <div class="divide-y divide-black/[0.05]">
                                {#each $sprintHistory as sprint (sprint.id)}
                                    <div class="flex items-center justify-between py-3">
                                        <div>
                                            <div class="text-sm font-medium text-black/65">{sprint.wordsWritten} words · {sprint.wordsPerMinute} WPM</div>
                                            <div class="text-xs text-black/30 mt-0.5">{formatHistoryDate(sprint.startedAt)} · {sprint.durationMinutes} min</div>
                                        </div>
                                        {#if sprint.wordGoal && sprint.wordsWritten >= sprint.wordGoal}
                                            <Flag size={14} class="text-emerald-500" aria-label="Goal reached" />
                                        {/if}
                                    </div>
                                {/each}
                            </div>
                            <button
                                type="button"
                                onclick={clearSprintHistory}
                                class="mt-4 text-xs text-black/30 hover:text-red-500 transition-colors"
                            >Clear history</button>
                        {/if}
                    </div>
                {:else}
                    <div class="grid grid-cols-5 gap-2" aria-label="Sprint duration">
                        {#each PRESET_MINUTES as minutes}
                            <button
                                type="button"
                                onclick={() => {
                                    selectedDuration = minutes;
                                    useCustomDuration = false;
                                }}
                                class:bg-violet-100={!useCustomDuration && selectedDuration === minutes}
                                class:text-violet-700={!useCustomDuration && selectedDuration === minutes}
                                class:border-violet-200={!useCustomDuration && selectedDuration === minutes}
                                class="py-2.5 rounded-xl border border-black/[0.06] bg-black/[0.02] text-sm text-black/50 hover:bg-violet-50 transition-colors"
                            >{minutes}</button>
                        {/each}
                    </div>
                    <label class="flex items-center gap-3 mt-3 p-3 rounded-xl border border-black/[0.06]">
                        <input type="radio" name="duration" checked={useCustomDuration} onchange={() => (useCustomDuration = true)} />
                        <span class="text-sm text-black/55">Custom</span>
                        <input
                            type="number"
                            min="1"
                            max="480"
                            bind:value={customDuration}
                            onfocus={() => (useCustomDuration = true)}
                            class="ml-auto w-20 px-2.5 py-1.5 rounded-lg bg-black/[0.04] text-sm text-right outline-none focus:ring-2 focus:ring-violet-200"
                        />
                        <span class="text-xs text-black/30">minutes</span>
                    </label>

                    <label class="block mt-5">
                        <span class="text-sm font-semibold text-black/60">Word challenge <span class="font-normal text-black/30">(optional)</span></span>
                        <div class="flex items-center gap-2 mt-2 px-3 rounded-xl bg-black/[0.035] border border-black/[0.05] focus-within:ring-2 focus-within:ring-violet-200">
                            <Flag size={15} class="text-black/25" />
                            <input
                                type="number"
                                min="1"
                                placeholder="e.g. 500"
                                bind:value={wordGoal}
                                class="w-full py-2.5 bg-transparent text-sm outline-none placeholder:text-black/25"
                            />
                            <span class="text-xs text-black/30">words</span>
                        </div>
                    </label>

                    <button
                        type="button"
                        onclick={beginSprint}
                        class="w-full mt-6 py-3 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 shadow-md shadow-violet-200 transition-colors"
                    >Start {durationMinutes}-minute sprint</button>
                {/if}
            {/if}
        </div>
        <ModalResizeHandles bind:restoreSize minHeight={280} />
    </dialog>
{/if}
