<!--
    DebugPanel.svelte — Developer overlay for loading editor scenarios.

    Uses loadScenario for the DEV reset and persistence cycle shared with screenshots.
    Only available when import.meta.env.DEV is true.
-->
<script lang="ts">
import { ModalResizeHandles, RestoreSizeButton } from "@quillium/share";
import { debugForceAuthOffline } from "$lib/auth/auth.svelte";
import AutoAIFace, { type FaceState, type IdleVariant } from "$lib/autoai/AutoAIFace.svelte";
import { loadScenario } from "$lib/debug/loadScenario";
import { type Scenario, type ScenarioGroup, scenarios } from "$lib/debug/scenarios";
import { debugAuthWaitlistMode, debugForceSurvey, debugPanelActive } from "$lib/debug/store.svelte";
import { getExtensions, savedFields } from "$lib/editor/extensions";
import { saveEmergencyBackup } from "$lib/errorGuard";
import { appEventBus } from "$lib/events/appEventBus";
import { editorView, errorBanner } from "$lib/stores";
import { EditorState } from "@codemirror/state";

// Face preview state
const FACE_STATES: FaceState[] = [
    "idle",
    "tracking",
    "thinking",
    "reviewing",
    "sleeping",
    "waking",
    "disabled",
];
const IDLE_VARIANTS: IdleVariant[] = [
    "blink",
    "double-blink",
    "look-around",
    "squint",
    "wide-eyed",
    "drowsy",
];
type IdlePreviewMode = IdleVariant | "auto";
let previewFaceState = $state<FaceState>("idle");
let previewIdleMode = $state<IdlePreviewMode>("auto");

const {
    reloadEditor,
}: {
    reloadEditor: () => Promise<void> | void;
} = $props();

let loading = $state<string | null>(null);
let lastLoaded = $state<string | null>(null);
let error = $state<string | null>(null);
let historyCleared = $state(false);
let historyClearTimer: ReturnType<typeof setTimeout> | undefined;
let pendingSimulation = $state<string | null>(null);
let countdownSeconds = $state(5);
let countdownInterval: ReturnType<typeof setInterval> | undefined;

function startCountdown(type: string, callback: () => void) {
    pendingSimulation = type;
    countdownSeconds = 5;
    clearInterval(countdownInterval);
    countdownInterval = setInterval(() => {
        countdownSeconds--;
        if (countdownSeconds <= 0) {
            clearInterval(countdownInterval);
            callback();
            pendingSimulation = null;
        }
    }, 1000);
}

// Fixed display order for accordion sections — only groups with at least
// one matching scenario are rendered (see groupScenarios below).
const DEBUG_GROUP_ORDER: ScenarioGroup[] = [
    "Showcase",
    "Comments",
    "Suggestions",
    "Revisions",
    "Combinations & edge cases",
    "Provenance & authorship",
    "Privacy & safety",
    "Screenshot & video fixtures",
];
const DEMO_GROUP_ORDER: ScenarioGroup[] = ["Editorial sessions", "Linked versions"];

function groupScenarios(list: Scenario[], order: ScenarioGroup[]) {
    return order
        .map((name) => ({ name, scenarios: list.filter((s) => s.group === name) }))
        .filter((g) => g.scenarios.length > 0);
}

const debugScenarios = scenarios.filter((s) => s.category === "debug");
const demoScenarios = scenarios.filter((s) => s.category === "demo");
const groupedDebugScenarios = groupScenarios(debugScenarios, DEBUG_GROUP_ORDER);
const groupedDemoScenarios = groupScenarios(demoScenarios, DEMO_GROUP_ORDER);

function close() {
    $debugPanelActive = false;
}

// ── Scenario runner ───────────────────────────────────────────────

async function runScenario(scenario: Scenario) {
    if (!$editorView) {
        error = "Editor not ready — wait for the editor to initialise.";
        return;
    }

    loading = scenario.id;
    error = null;

    try {
        await loadScenario(scenario, reloadEditor);

        lastLoaded = scenario.id;
    } catch (e) {
        error = e instanceof Error ? e.message : String(e);
        console.error("[DebugPanel] scenario load failed:", e);
    } finally {
        loading = null;
    }
}

function clearUndoHistory() {
    const view = $editorView;
    if (!view) return;
    const json = view.state.toJSON(savedFields);
    json.historyField = { done: [], undone: [] };
    const extensions = getExtensions({ persist: false });
    view.setState(EditorState.fromJSON(json, { extensions }, savedFields));
    historyCleared = true;
    clearTimeout(historyClearTimer);
    historyClearTimer = setTimeout(() => {
        historyCleared = false;
    }, 2000);
}

// ── App-level simulations ─────────────────────────────────────────

function triggerChangelog() {
    startCountdown("changelog", () => {
        close();
        appEventBus.emit({ type: "show-changelog" });
    });
}

function triggerUpdateBanner(mas: boolean) {
    startCountdown(mas ? "update-mas" : "update", () => {
        close();
        appEventBus.emit({ type: "show-update-banner", version: "99.0.0", mas });
    });
}

function triggerCrashBanner() {
    startCountdown("crash", () => {
        close();
        saveEmergencyBackup("Simulated crash from debug panel");
        errorBanner.set({
            message: "Something went wrong. Your work has been backed up.",
            hasBackup: true,
            backupType: "crash",
            details:
                "Error: Simulated crash from debug panel\n    at DebugPanel.triggerCrashBanner",
        });
    });
}

function triggerSuspiciousRemoval() {
    startCountdown("removal", () => {
        close();
        errorBanner.set({
            message:
                "A large number of annotations were removed. A recovery snapshot has been saved to your version history.",
            hasBackup: false,
            backupType: "auto",
        });
    });
}

function triggerAuthModal() {
    close();
    appEventBus.emit({ type: "show-auth-modal" });
}

function triggerAuthOffline() {
    debugForceAuthOffline();
    close();
}

function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") close();
}

let restoreSize = $state<(() => void) | undefined>();
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- Backdrop -->
<div
    class="fixed inset-0 z-[100] bg-black/20 backdrop-blur-sm flex items-center justify-center"
    onclick={close}
    role="presentation"
>
    <!-- Panel -->
    <div
        class="relative bg-white/90 backdrop-blur-md border border-white/50 rounded-2xl shadow-2xl w-[860px] max-h-[82vh] flex flex-col overflow-hidden"
        onclick={(e) => e.stopPropagation()}
        onkeydown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Debug panel"
        tabindex="-1"
    >
        <!-- Header -->
        <div class="shrink-0 flex items-center justify-between px-5 py-4 border-b border-black/10">
            <div class="flex items-center gap-2.5">
                <span class="text-lg">🐛</span>
                <span class="font-semibold text-black/80 text-sm">Scenarios</span>
                <span class="text-[10px] font-mono bg-amber-100 text-amber-700 border border-amber-200 rounded px-1.5 py-0.5">DEV</span>
            </div>
            <div class="flex items-center gap-1 shrink-0">
                <RestoreSizeButton {restoreSize} />
                <button
                    onclick={close}
                    class="w-6 h-6 rounded-full bg-black/10 hover:bg-black/20 text-black/40 hover:text-black/70 transition-colors text-xs font-bold flex items-center justify-center"
                    aria-label="Close debug panel"
                >✕</button>
            </div>
        </div>

        <!-- Info bar -->
        <div class="shrink-0 px-5 py-2.5 bg-amber-50/80 border-b border-amber-100 text-[11px] text-amber-700">
            Saves the scenario to disk and reloads the editor. <strong>Overwrites your current draft.</strong>
        </div>

        <!-- Error -->
        {#if error}
            <div class="mx-5 mt-3 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-[11px] text-red-700">
                {error}
            </div>
        {/if}

        <!-- Two-column body -->
        <div class="flex flex-1 overflow-hidden min-h-0">

            <!-- Debug column -->
            <div class="flex flex-col flex-1 min-w-0 overflow-hidden">
                <div class="px-4 pt-3 pb-2 flex items-center gap-2">
                    <span class="text-[11px] font-semibold text-black/40 uppercase tracking-widest">Debug</span>
                </div>
                <div class="overflow-y-auto flex-1 px-3 pb-3 flex flex-col gap-2">
                    {#each groupedDebugScenarios as group}
                        <details
                            class="group rounded-xl border border-black/8 bg-white/40"
                            open={group.name !== "Screenshot & video fixtures"}
                        >
                            <summary
                                class="flex items-center justify-between gap-2 px-3 py-2 cursor-pointer select-none list-none marker:content-none"
                            >
                                <span class="flex items-center gap-1.5 text-[11px] font-semibold text-black/55">
                                    <svg
                                        class="w-2 h-2 shrink-0 text-black/30 transition-transform group-open:rotate-90"
                                        viewBox="0 0 8 8"
                                        fill="currentColor"
                                    ><path d="M1 0l6 4-6 4z" /></svg>
                                    {group.name}
                                </span>
                                <span class="text-[10px] text-black/30">{group.scenarios.length}</span>
                            </summary>
                            <div class="flex flex-col gap-1.5 px-3 pb-3 pt-1">
                                {#each group.scenarios as scenario}
                                    {@const isLoading = loading === scenario.id}
                                    {@const isLoaded = lastLoaded === scenario.id && loading === null}
                                    <div
                                        class={`flex items-start justify-between gap-3 rounded-xl border px-3.5 py-2.5 transition-colors ${
                                            isLoaded
                                                ? "border-green-200 bg-green-50/70"
                                                : "border-black/8 bg-white/50 hover:bg-white/80"
                                        }`}
                                    >
                                        <div class="flex-1 min-w-0">
                                            <div class="flex items-center gap-2">
                                                <span class="text-[12px] font-medium text-black/75">{scenario.label}</span>
                                                {#if isLoaded}
                                                    <span class="text-[10px] text-green-600 font-medium">✓ loaded</span>
                                                {/if}
                                            </div>
                                            <p class="text-[10.5px] text-black/45 mt-0.5 leading-snug">{scenario.description}</p>
                                        </div>
                                        <button
                                            onclick={() => runScenario(scenario)}
                                            disabled={loading !== null}
                                            class={`shrink-0 text-[11px] font-medium px-2.5 py-1 rounded-lg transition-colors ${
                                                isLoading
                                                    ? "bg-blue-100 text-blue-400 cursor-wait"
                                                    : "bg-black/8 hover:bg-black/14 text-black/60 disabled:opacity-40 disabled:cursor-not-allowed"
                                            }`}
                                        >
                                            {isLoading ? "Saving…" : "Load"}
                                        </button>
                                    </div>
                                {/each}
                            </div>
                        </details>
                    {/each}
                </div>
            </div>

            <!-- Divider -->
            <div class="w-px bg-black/8 self-stretch my-3"></div>

            <!-- Demo column -->
            <div class="flex flex-col flex-1 min-w-0 overflow-hidden">
                <div class="px-4 pt-3 pb-2 flex items-center gap-2">
                    <span class="text-[11px] font-semibold text-black/40 uppercase tracking-widest">Demo</span>
                    <span class="text-[10px] text-black/30">polished · show-ready</span>
                </div>
                <div class="overflow-y-auto flex-1 px-3 pb-3 flex flex-col gap-2">
                    {#each groupedDemoScenarios as group}
                        <details class="group rounded-xl border border-black/8 bg-white/40" open>
                            <summary
                                class="flex items-center justify-between gap-2 px-3 py-2 cursor-pointer select-none list-none marker:content-none"
                            >
                                <span class="flex items-center gap-1.5 text-[11px] font-semibold text-black/55">
                                    <svg
                                        class="w-2 h-2 shrink-0 text-black/30 transition-transform group-open:rotate-90"
                                        viewBox="0 0 8 8"
                                        fill="currentColor"
                                    ><path d="M1 0l6 4-6 4z" /></svg>
                                    {group.name}
                                </span>
                                <span class="text-[10px] text-black/30">{group.scenarios.length}</span>
                            </summary>
                            <div class="flex flex-col gap-1.5 px-3 pb-3 pt-1">
                                {#each group.scenarios as scenario}
                                    {@const isLoading = loading === scenario.id}
                                    {@const isLoaded = lastLoaded === scenario.id && loading === null}
                                    <div
                                        class={`flex items-start justify-between gap-3 rounded-xl border px-3.5 py-2.5 transition-colors ${
                                            isLoaded
                                                ? "border-blue-200 bg-blue-50/60"
                                                : "border-black/8 bg-white/50 hover:bg-white/80"
                                        }`}
                                    >
                                        <div class="flex-1 min-w-0">
                                            <div class="flex items-center gap-2">
                                                <span class="text-[12px] font-medium text-black/75">{scenario.label}</span>
                                                {#if isLoaded}
                                                    <span class="text-[10px] text-blue-500 font-medium">✓ loaded</span>
                                                {/if}
                                            </div>
                                            <p class="text-[10.5px] text-black/45 mt-0.5 leading-snug">{scenario.description}</p>
                                        </div>
                                        <button
                                            onclick={() => runScenario(scenario)}
                                            disabled={loading !== null}
                                            class={`shrink-0 text-[11px] font-medium px-2.5 py-1 rounded-lg transition-colors ${
                                                isLoading
                                                    ? "bg-blue-100 text-blue-400 cursor-wait"
                                                    : "bg-blue-500 hover:bg-blue-600 text-white disabled:opacity-40 disabled:cursor-not-allowed"
                                            }`}
                                        >
                                            {isLoading ? "Saving…" : "Load"}
                                        </button>
                                    </div>
                                {/each}
                            </div>
                        </details>
                    {/each}
                </div>
            </div>

        </div>

        <!-- AutoAI Face Preview -->
        <div class="px-5 py-3 border-t border-black/10 flex items-center gap-3">
            <span class="text-[11px] font-semibold text-black/40 uppercase tracking-widest">Face</span>
            <div class="w-[67px] h-[67px] rounded-full bg-[#faf8f5] border-2 border-[#d6b87a] flex items-center justify-center shrink-0">
                <AutoAIFace
                    faceState={previewFaceState}
                    eyeOffsetX={0}
                    eyeOffsetY={0}
                    forceIdleVariant={
                        previewFaceState === "idle" && previewIdleMode !== "auto" ? previewIdleMode : undefined
                    }
                />
            </div>
            <div class="flex flex-col gap-1.5">
                <div class="flex items-center gap-1">
                    <span class="text-[10px] text-black/40 w-10">State</span>
                    <div class="flex flex-wrap gap-1">
                        {#each FACE_STATES as fs}
                            <button
                                onclick={() => previewFaceState = fs}
                                class="text-[10px] px-1.5 py-0.5 rounded transition-colors
                                    {previewFaceState === fs
                                        ? 'bg-amber-100 text-amber-700 border border-amber-200'
                                        : 'bg-black/5 text-black/50 hover:bg-black/10 border border-transparent'}"
                            >{fs}</button>
                        {/each}
                    </div>
                </div>
                <div class="flex items-center gap-1">
                    <span class="text-[10px] text-black/40 w-10">Idle</span>
                    <div class="flex flex-wrap gap-1">
                        <button
                            onclick={() => { previewFaceState = "idle"; previewIdleMode = "auto"; }}
                            class="text-[10px] px-1.5 py-0.5 rounded transition-colors
                                {previewFaceState === 'idle' && previewIdleMode === 'auto'
                                    ? 'bg-blue-100 text-blue-700 border border-blue-200'
                                    : 'bg-black/5 text-black/50 hover:bg-black/10 border border-transparent'}"
                        >auto</button>
                        {#each IDLE_VARIANTS as iv}
                            <button
                                onclick={() => { previewFaceState = "idle"; previewIdleMode = iv; }}
                                class="text-[10px] px-1.5 py-0.5 rounded transition-colors
                                    {previewFaceState === 'idle' && previewIdleMode === iv
                                        ? 'bg-blue-100 text-blue-700 border border-blue-200'
                                        : 'bg-black/5 text-black/50 hover:bg-black/10 border border-transparent'}"
                            >{iv}</button>
                        {/each}
                    </div>
                </div>
            </div>
        </div>

        <!-- Simulate section -->
        <div class="px-5 py-3 border-t border-black/10 flex items-center gap-2">
            <span class="text-[11px] font-semibold text-black/40 uppercase tracking-widest mr-1">Simulate</span>
            <button
                onclick={triggerCrashBanner}
                disabled={pendingSimulation !== null}
                class="text-[11px] font-medium px-2.5 py-1 rounded-lg border border-black/8 bg-white/50 hover:bg-red-50 hover:border-red-200 hover:text-red-600 transition-colors disabled:opacity-40"
            >{pendingSimulation === "crash" ? `Firing in ${countdownSeconds}s…` : "Crash"}</button>
            <button
                onclick={triggerSuspiciousRemoval}
                disabled={pendingSimulation !== null}
                class="text-[11px] font-medium px-2.5 py-1 rounded-lg border border-black/8 bg-white/50 hover:bg-amber-50 hover:border-amber-200 hover:text-amber-600 transition-colors disabled:opacity-40"
            >{pendingSimulation === "removal" ? `Firing in ${countdownSeconds}s…` : "Mass annotation removal"}</button>
            <button
                onclick={triggerChangelog}
                disabled={pendingSimulation !== null}
                class="text-[11px] font-medium px-2.5 py-1 rounded-lg border border-black/8 bg-white/50 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-600 transition-colors disabled:opacity-40"
            >{pendingSimulation === "changelog" ? `Firing in ${countdownSeconds}s…` : "Changelog"}</button>
            <button
                onclick={() => triggerUpdateBanner(false)}
                disabled={pendingSimulation !== null}
                class="text-[11px] font-medium px-2.5 py-1 rounded-lg border border-black/8 bg-white/50 hover:bg-green-50 hover:border-green-200 hover:text-green-600 transition-colors disabled:opacity-40"
            >{pendingSimulation === "update" ? `Firing in ${countdownSeconds}s…` : "Update banner"}</button>
            <button
                onclick={() => triggerUpdateBanner(true)}
                disabled={pendingSimulation !== null}
                class="text-[11px] font-medium px-2.5 py-1 rounded-lg border border-black/8 bg-white/50 hover:bg-green-50 hover:border-green-200 hover:text-green-600 transition-colors disabled:opacity-40"
            >{pendingSimulation === "update-mas" ? `Firing in ${countdownSeconds}s…` : "Update banner (MAS)"}</button>
            <label
                class="ml-auto flex items-center gap-2 text-[11px] font-medium px-2.5 py-1 rounded-lg border border-black/8 bg-white/50 hover:bg-amber-50 hover:border-amber-200 transition-colors"
                title="Initialise PostHog in dev so 'Send Feedback' shows the survey instead of falling back to the bug form"
            >
                <input
                    type="checkbox"
                    bind:checked={$debugForceSurvey}
                    class="h-3.5 w-3.5 accent-amber-500"
                />
                Force survey
            </label>
            <label
                class="flex items-center gap-2 text-[11px] font-medium px-2.5 py-1 rounded-lg border border-black/8 bg-white/50 hover:bg-blue-50 hover:border-blue-200 transition-colors"
                title="Make the auth modal behave like production waitlist gating"
            >
                <input
                    type="checkbox"
                    bind:checked={$debugAuthWaitlistMode}
                    class="h-3.5 w-3.5 accent-blue-500"
                />
                Auth waitlist
            </label>
            <button
                onclick={triggerAuthModal}
                class="text-[11px] font-medium px-2.5 py-1 rounded-lg border border-black/8 bg-white/50 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-600 transition-colors"
            >Auth modal</button>
            <button
                onclick={triggerAuthOffline}
                class="text-[11px] font-medium px-2.5 py-1 rounded-lg border border-black/8 bg-white/50 hover:bg-red-50 hover:border-red-200 hover:text-red-600 transition-colors"
            >Auth offline</button>
        </div>

        <!-- Footer -->
        <div class="px-5 py-3 border-t border-black/10 text-[10px] text-black/35 flex items-center justify-between">
            <span>Press <kbd class="font-mono bg-black/10 px-1 rounded">Esc</kbd> to close</span>
            <div class="flex items-center gap-3">
                <button
                    onclick={clearUndoHistory}
                    class="text-[10px] font-medium px-2 py-1 rounded-md transition-colors
                        {historyCleared ? 'bg-green-50 text-green-600' : 'bg-black/6 hover:bg-red-50 hover:text-red-600'}"
                >
                    {historyCleared ? "✓ history cleared" : "Clear undo history"}
                </button>
                <span>DEV only — stripped from production builds</span>
            </div>
        </div>
        <ModalResizeHandles bind:restoreSize />
    </div>
</div>
