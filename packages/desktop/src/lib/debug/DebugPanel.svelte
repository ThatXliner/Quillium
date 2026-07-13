<!--
    DebugPanel.svelte — Developer overlay for loading editor scenarios.

    How it works:
      1. Creates a temporary EditorState with full extensions (including
         annotationField and annotation decorations) but no persist listener.
      2. Mounts a headless EditorView and intercepts every transaction
         dispatched during scenario.setup(), converting each to an
         EventPayload (same format as the live persistence layer).
      3. Wipes the DB and creates a fresh document + draft.
      4. Appends each collected EventPayload to the event log via
         appendEvent(), so the document has a real replay-able history.
      5. Takes a final snapshot of the temp state for fast initial load,
         and calls updateDocumentMeta() so the library shows a preview.
      6. Calls reloadEditor() — the editor restores state via the normal
         snapshot + replayEvents path, identical to a real session restore.

    Activation: click the 🐛 button in the StatusBar, or press Escape to close.
    Only available when import.meta.env.DEV is true (stripped from production).
-->
<script lang="ts">
import { debugForceAuthOffline } from "$lib/auth/auth.svelte";
import AutoAIFace, { type FaceState, type IdleVariant } from "$lib/autoai/AutoAIFace.svelte";
import {
    appendEvent,
    createDocument,
    createDraft,
    createSnapshot,
    resetDb,
    updateDocumentMeta,
} from "$lib/db";
import type { EventPayload } from "$lib/db/events";
import { type Scenario, scenarios } from "$lib/debug/scenarios";
import { debugAuthWaitlistMode, debugForceSurvey, debugPanelActive } from "$lib/debug/store.svelte";
import { getExtensions, savedFields } from "$lib/editor/extensions";
import { buildEventPayload } from "$lib/editor/listeners";
import { saveEmergencyBackup } from "$lib/errorGuard";
import { appEventBus } from "$lib/events/appEventBus";
import { getPersistUndoHistoryForNewDocuments } from "$lib/settings.svelte";
import {
    currentDocumentId,
    currentDocumentTitle,
    currentDraftId,
    editorView,
    errorBanner,
} from "$lib/stores";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

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

const debugScenarios = scenarios.filter((s) => s.category === "debug");
const demoScenarios = scenarios.filter((s) => s.category === "demo");

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
        // 1. Collect EventPayloads from the scenario's transactions.
        const collectedPayloads: EventPayload[] = [];
        const persistHistory = getPersistUndoHistoryForNewDocuments();

        const tempState = EditorState.create({
            doc: scenario.doc,
            extensions: getExtensions({
                persist: false,
                persistHistory,
                updateListener(update) {
                    const payload = buildEventPayload(update);
                    if (payload) collectedPayloads.push(payload);
                },
            }),
        });

        const tempParent = document.createElement("div");
        const tempView = new EditorView({ state: tempState, parent: tempParent });

        // 2. Run the scenario — each dispatch fires the updateListener above.
        scenario.setup(tempView);

        const finalState = tempView.state;
        tempView.destroy();

        // 3. Fresh DB: new document + draft.
        await resetDb();
        const docId = await createDocument(scenario.label, persistHistory);
        const draftId = await createDraft(docId, "Draft");

        // 4. Replay events into the event log — this is the "real history".
        let lastEventId = -1;
        for (const payload of collectedPayloads) {
            const result = await appendEvent(draftId, JSON.stringify(payload));
            lastEventId = result.eventId;
        }

        // 5. Write a snapshot of the final state so the editor loads fast,
        //    and update document metadata so the library shows a preview.
        const stateJson = JSON.stringify(finalState.toJSON(savedFields));
        await createSnapshot(draftId, stateJson, lastEventId);

        const docText = finalState.doc.toString();
        const title = scenario.label;
        const wordCount = docText.trim().split(/\s+/).filter(Boolean).length;
        const previewText = docText.slice(0, 200);
        await updateDocumentMeta(docId, title, wordCount, previewText, "[]", docText);

        // 6. Set stores AFTER snapshot is written. Setting currentDocumentId
        //    triggers Editor.svelte's subscription which calls loadDocument —
        //    if set too early (before the snapshot exists), it would load an
        //    empty state and cause a RangeError when annotations are mapped
        //    through a zero-length changeset.
        currentDocumentId.set(docId);
        currentDocumentTitle.set(scenario.label);
        currentDraftId.set(draftId);

        // 7. Reload the editor via the normal snapshot + replay path.
        await reloadEditor();

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
        <div class="flex items-center justify-between px-5 py-4 border-b border-black/10">
            <div class="flex items-center gap-2.5">
                <span class="text-lg">🐛</span>
                <span class="font-semibold text-black/80 text-sm">Scenarios</span>
                <span class="text-[10px] font-mono bg-amber-100 text-amber-700 border border-amber-200 rounded px-1.5 py-0.5">DEV</span>
            </div>
            <button
                onclick={close}
                class="w-6 h-6 rounded-full bg-black/10 hover:bg-black/20 text-black/40 hover:text-black/70 transition-colors text-xs font-bold flex items-center justify-center"
                aria-label="Close debug panel"
            >✕</button>
        </div>

        <!-- Info bar -->
        <div class="px-5 py-2.5 bg-amber-50/80 border-b border-amber-100 text-[11px] text-amber-700">
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
                <div class="overflow-y-auto flex-1 px-3 pb-3 flex flex-col gap-1.5">
                    {#each debugScenarios as scenario}
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
            </div>

            <!-- Divider -->
            <div class="w-px bg-black/8 self-stretch my-3"></div>

            <!-- Demo column -->
            <div class="flex flex-col flex-1 min-w-0 overflow-hidden">
                <div class="px-4 pt-3 pb-2 flex items-center gap-2">
                    <span class="text-[11px] font-semibold text-black/40 uppercase tracking-widest">Demo</span>
                    <span class="text-[10px] text-black/30">polished · show-ready</span>
                </div>
                <div class="overflow-y-auto flex-1 px-3 pb-3 flex flex-col gap-1.5">
                    {#each demoScenarios as scenario}
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
    </div>
</div>
