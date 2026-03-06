<!--
    DebugPanel.svelte — Developer overlay for loading editor scenarios.

    Renders as a floating panel (same z-layer as Tutorial) that lets
    developers instantly set the editor to a named state (single comment,
    nested revision, dense annotations, etc.) without making AI API calls.

    Activation: click the 🐛 button in the StatusBar, or press Escape to close.

    Each scenario:
      1. Replaces the editor document with the scenario's sample text.
      2. Clears all existing annotations (via EditorState.create).
      3. Runs the scenario's setup() function to dispatch annotations.

    Only rendered when the `debugPanelActive` store is true.
    Only available when import.meta.env.DEV is true (hidden in production builds).
-->
<script lang="ts">
    import { editorView } from "$lib/stores";
    import { debugPanelActive } from "$lib/debug/store.svelte";
    import { scenarios, type Scenario } from "$lib/debug/scenarios";
    import { EditorState } from "@codemirror/state";
    import { getExtensions } from "$lib/editor/extensions";

    let loading = $state<string | null>(null);
    let lastLoaded = $state<string | null>(null);
    let error = $state<string | null>(null);

    function close() {
        $debugPanelActive = false;
    }

    async function runScenario(scenario: Scenario) {
        const view = $editorView;
        if (!view) {
            error = "Editor not ready — wait for the editor to initialise.";
            return;
        }

        loading = scenario.id;
        error = null;

        try {
            // Replace the editor state entirely: new doc, no annotations, no history.
            // persist: false prevents the debug state from being written to disk.
            const freshState = EditorState.create({
                doc: scenario.doc,
                extensions: getExtensions({ persist: false }),
            });
            view.setState(freshState);

            // Give the state one tick to settle before dispatching annotations.
            await new Promise((r) => requestAnimationFrame(r));

            scenario.setup(view);
            lastLoaded = scenario.id;
        } catch (e) {
            error = e instanceof Error ? e.message : String(e);
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
        class="relative bg-white/90 backdrop-blur-md border border-white/50 rounded-2xl shadow-2xl w-[520px] max-h-[80vh] flex flex-col overflow-hidden"
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
                <span class="font-semibold text-black/80 text-sm">Debug Scenarios</span>
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
            Loading a scenario <strong>replaces the editor document</strong> and clears all annotations.
            Changes are not saved to disk.
        </div>

        <!-- Error -->
        {#if error}
            <div class="mx-5 mt-3 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-[11px] text-red-700">
                {error}
            </div>
        {/if}

        <!-- Scenario list -->
        <div class="overflow-y-auto flex-1 px-4 py-3 flex flex-col gap-2">
            {#each scenarios as scenario}
                {@const isLoading = loading === scenario.id}
                {@const isLoaded = lastLoaded === scenario.id && loading === null}
                <div
                    class={`flex items-start justify-between gap-3 rounded-xl border px-4 py-3 transition-colors ${
                        isLoaded
                            ? "border-green-200 bg-green-50/70"
                            : "border-black/10 bg-white/60 hover:bg-white/90"
                    }`}
                >
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2">
                            <span class="text-sm font-medium text-black/80">{scenario.label}</span>
                            {#if isLoaded}
                                <span class="text-[10px] text-green-600 font-medium">✓ loaded</span>
                            {/if}
                        </div>
                        <p class="text-[11px] text-black/50 mt-0.5 leading-snug">{scenario.description}</p>
                    </div>
                    <button
                        onclick={() => runScenario(scenario)}
                        disabled={loading !== null}
                        class={`shrink-0 text-[11px] font-medium px-3 py-1.5 rounded-lg transition-colors ${
                            isLoading
                                ? "bg-blue-100 text-blue-400 cursor-wait"
                                : "bg-blue-500 hover:bg-blue-600 text-white disabled:opacity-40 disabled:cursor-not-allowed"
                        }`}
                    >
                        {isLoading ? "Loading…" : "Load"}
                    </button>
                </div>
            {/each}
        </div>

        <!-- Footer -->
        <div class="px-5 py-3 border-t border-black/10 text-[10px] text-black/35 flex items-center justify-between">
            <span>Press <kbd class="font-mono bg-black/10 px-1 rounded">Esc</kbd> to close</span>
            <span>Not visible in production builds</span>
        </div>
    </div>
</div>
