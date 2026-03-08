<!--
    DebugPanel.svelte — Developer overlay for loading editor scenarios.

    How it works:
      1. Creates a temporary EditorState with full extensions (including
         annotationField and annotation decorations).
      2. Runs scenario.setup() to dispatch annotations onto that state.
      3. Serializes the resulting state via toJSON(savedFields) and writes
         it to disk via invoke("save") — the same path as normal auto-save.
      4. Calls reloadEditor() (exported from Editor.svelte) which re-runs
         invoke("load") → EditorState.fromJSON → view.setState, so the
         live view gets the complete extension stack including its update
         listener and annotation decoration plugins.

    Activation: click the 🐛 button in the StatusBar, or press Escape to close.
    Only available when import.meta.env.DEV is true (stripped from production).
-->
<script lang="ts">
import { editorView } from "$lib/stores";
import { debugPanelActive } from "$lib/debug/store.svelte";
import { scenarios, type Scenario } from "$lib/debug/scenarios";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { getExtensions, savedFields } from "$lib/editor/extensions";
import { invoke } from "@tauri-apps/api/core";

const { reloadEditor }: { reloadEditor: () => Promise<void> | void } = $props();

let loading = $state<string | null>(null);
let lastLoaded = $state<string | null>(null);
let error = $state<string | null>(null);

const debugScenarios = scenarios.filter((s) => s.category === "debug");
const demoScenarios = scenarios.filter((s) => s.category === "demo");

function close() {
    $debugPanelActive = false;
}

async function runScenario(scenario: Scenario) {
    if (!$editorView) {
        error = "Editor not ready — wait for the editor to initialise.";
        return;
    }

    loading = scenario.id;
    error = null;

    try {
        // 1. Build a temporary EditorState with the full extension stack
        //    (annotationField included) but no persist listener, so our
        //    intermediate dispatches don't trigger spurious auto-saves.
        const tempState = EditorState.create({
            doc: scenario.doc,
            extensions: getExtensions({ persist: false }),
        });

        // 2. Mount a headless EditorView so we can dispatch transactions
        //    through the full extension pipeline (annotation decorations,
        //    StateField reducer, etc.).
        const tempParent = document.createElement("div");
        const tempView = new EditorView({ state: tempState, parent: tempParent });

        // 3. Run the scenario setup — dispatches addAnnotation effects.
        scenario.setup(tempView);

        // 4. Serialize the resulting state (doc + annotationField) to JSON.
        const json = tempView.state.toJSON(savedFields);

        tempView.destroy();

        // 5. Write to disk via the same Tauri "save" command the auto-save
        //    listener uses, so the next load sees the scenario state.
        await invoke("save", { state: JSON.stringify(json) });

        // 6. Reload the live editor from disk — re-runs the full
        //    EditorState.fromJSON path with all extensions wired up.
        await reloadEditor();

        lastLoaded = scenario.id;
    } catch (e) {
        error = e instanceof Error ? e.message : String(e);
        console.error("[DebugPanel] scenario load failed:", e);
    } finally {
        loading = null;
    }
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

        <!-- Footer -->
        <div class="px-5 py-3 border-t border-black/10 text-[10px] text-black/35 flex items-center justify-between">
            <span>Press <kbd class="font-mono bg-black/10 px-1 rounded">Esc</kbd> to close</span>
            <span>DEV only — stripped from production builds</span>
        </div>
    </div>
</div>
