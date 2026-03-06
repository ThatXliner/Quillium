<!--
    +page.svelte — Three-panel layout orchestrator and overlay host.

    This is the sole route in the SvelteKit app (static SPA for Tauri).
    It assembles the three main panels:
      1. <AiSidebar />    — left panel (AI writing assistant)
      2. <Editor />        — center panel (CodeMirror document)
      3. Annotations panel — rendered inside Editor.svelte

    It also hosts two overlay layers:
      - The tutorial overlay (shown on first visit or via "?" button)
      - The modal stack (nested revision/diff modals, rendered from
        the global `modalStack` store)

    State interactions:
      - Reads `tutorialActive` to conditionally show <Tutorial>.
      - Reads `modalStack` to render the stack of revision/diff modals.
      - Writes `tutorialActive = true` on mount if the user hasn't
        completed the tutorial (checked via localStorage).
-->
<script lang="ts">
    import { onMount } from "svelte";
    import Editor from "$lib/editor/Editor.svelte";
    import AiSidebar from "$lib/ai/AISidebar.svelte";
    import Tutorial from "$lib/tutorial/Tutorial.svelte";
    import { tutorialActive, modalStack, editorView } from "$lib/stores";
    import DiffModal from "$lib/editor/plugins/annotations/DiffModal.svelte";
    import RevisionModal from "$lib/editor/plugins/annotations/RevisionModal.svelte";
    import { debugPanelActive } from "$lib/debug/store.svelte";
    import DebugPanel from "$lib/debug/DebugPanel.svelte";

    /** Show the tutorial on first visit if the user hasn't seen it. */
    function showTutorialOnFirstVisit() {
        if (!localStorage.getItem("quillium_tutorial_seen")) {
            $tutorialActive = true;
        }
    }

    onMount(showTutorialOnFirstVisit);
</script>

<AiSidebar />

<div class="h-screen w-full">
    <Editor />
</div>

<!-- Tutorial overlay — rendered when tutorialActive store is true -->
{#if $tutorialActive}
    <Tutorial onComplete={() => {}} />
{/if}

<!-- Debug panel — DEV only, never rendered in production builds -->
{#if import.meta.env.DEV && $debugPanelActive}
    <DebugPanel />
{/if}

<!--
    Modal stack — renders nested revision/diff overlays.
    Each entry in the modalStack store becomes a DiffModal or
    RevisionModal. The stack supports arbitrary nesting depth
    (revisions inside revisions).
-->
{#each $modalStack as entry, i (entry)}
    {#if entry.type === "diff"}
        <DiffModal suggestionId={entry.suggestionId} parentView={entry.parentView} stackIndex={i} />
    {:else if entry.type === "revision"}
        <RevisionModal revisionId={entry.revisionId} view={entry.parentView} stackIndex={i} />
    {/if}
{/each}

<style>
    :global(html) {
        background-color: #e5e7eb; /* gray-200 */
    }
</style>
