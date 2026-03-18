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
import { goToLibrary } from "$lib/navigation";
import type { EventPayload } from "$lib/db/events";
import type { BackupEntry } from "$lib/errorGuard";
import { restoreBackup } from "$lib/editor/restore";
import { appSettings, applySettings, persistSettings } from "$lib/settings.svelte";

let editorComponent = $state<{ reload: () => Promise<void>; startEditingTitle: () => void }>();

/** Show the tutorial on first visit if the user hasn't seen it. */
function showTutorialOnFirstVisit() {
    if (!localStorage.getItem("quillium_tutorial_seen")) {
        $tutorialActive = true;
    }
}

function handleKeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === "o") {
        e.preventDefault();
        goToLibrary();
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "l") {
        e.preventDefault();
        editorComponent?.startEditingTitle();
    }
    if (e.metaKey || e.ctrlKey) {
        if (e.key === "=" || e.key === "+") {
            e.preventDefault();
            appSettings.uiZoom = Math.round(Math.min(2, appSettings.uiZoom + 0.1) * 10) / 10;
            applySettings(appSettings);
            persistSettings();
        } else if (e.key === "-") {
            e.preventDefault();
            appSettings.uiZoom = Math.round(Math.max(0.5, appSettings.uiZoom - 0.1) * 10) / 10;
            applySettings(appSettings);
            persistSettings();
        } else if (e.key === "0") {
            e.preventDefault();
            appSettings.uiZoom = 1;
            applySettings(appSettings);
            persistSettings();
        }
    }
}

onMount(() => {
    showTutorialOnFirstVisit();

    // Handle restore-backup events dispatched by ErrorBanner.svelte.
    function handleRestoreBackup(e: Event) {
        const view = $editorView;
        if (!view) return;
        const { documentText } = (e as CustomEvent<BackupEntry>).detail;
        restoreBackup(view, documentText);
    }

    window.addEventListener("quillium:restore-backup", handleRestoreBackup);
    return () => window.removeEventListener("quillium:restore-backup", handleRestoreBackup);
});

// DEV only: expose window.__runScenario__(id) for the screenshot script.
// Runs the same save+reload cycle as DebugPanel without opening the panel UI.
if (import.meta.env.DEV) {
    onMount(async () => {
        const { scenarios } = await import("$lib/debug/scenarios");
        const { EditorState } = await import("@codemirror/state");
        const { EditorView } = await import("@codemirror/view");
        const { getExtensions, savedFields } = await import("$lib/editor/extensions");
        const {
            resetDb,
            createDocument,
            createDraft,
            appendEvent,
            createSnapshot,
            updateDocumentMeta,
        } = await import("$lib/db");
        const { buildEventPayload } = await import("$lib/editor/listeners");
        const { currentDocumentId, currentDocumentTitle, currentDraftId } = await import(
            "$lib/stores"
        );

        (window as unknown as Record<string, unknown>).__modalStack__ = modalStack;
        (window as unknown as Record<string, unknown>).__editorView__ = editorView;

        (window as unknown as Record<string, unknown>).__runScenario__ = async (id: string) => {
            const scenario = scenarios.find((s) => s.id === id);
            if (!scenario) {
                console.warn(`[screenshot] unknown scenario: ${id}`);
                return false;
            }
            try {
                const collectedPayloads: EventPayload[] = [];

                const tempState = EditorState.create({
                    doc: scenario.doc,
                    extensions: getExtensions({
                        persist: false,
                        updateListener(update) {
                            const payload = buildEventPayload(update);
                            if (payload) collectedPayloads.push(payload);
                        },
                    }),
                });
                const tempParent = document.createElement("div");
                const tempView = new EditorView({ state: tempState, parent: tempParent });
                scenario.setup(tempView);
                const finalState = tempView.state;
                tempView.destroy();

                await resetDb();
                const docId = await createDocument(scenario.label);
                const draftId = await createDraft(docId, "Draft");
                currentDocumentId.set(docId);
                currentDocumentTitle.set(scenario.label);
                currentDraftId.set(draftId);

                let lastEventId = -1;
                for (const payload of collectedPayloads) {
                    const result = await appendEvent(draftId, JSON.stringify(payload));
                    lastEventId = result.eventId;
                }

                const stateJson = JSON.stringify(finalState.toJSON(savedFields));
                await createSnapshot(draftId, stateJson, lastEventId);

                const docText = finalState.doc.toString();
                const wordCount = docText.trim().split(/\s+/).filter(Boolean).length;
                await updateDocumentMeta(
                    docId,
                    scenario.label,
                    wordCount,
                    docText.slice(0, 200),
                    "[]",
                );

                await editorComponent?.reload();
                return true;
            } catch (e) {
                console.error("[screenshot] runScenario failed:", e);
                return false;
            }
        };
    });
}
</script>

<svelte:window onkeydown={handleKeydown} />

<AiSidebar />

<div class="h-screen w-full">
    <Editor bind:this={editorComponent} />
</div>

<!-- Tutorial overlay — rendered when tutorialActive store is true -->
{#if $tutorialActive}
    <Tutorial onComplete={() => {}} />
{/if}

<!-- Debug panel — DEV only, never rendered in production builds -->
{#if import.meta.env.DEV && $debugPanelActive}
    <DebugPanel reloadEditor={() => editorComponent?.reload()} />
{/if}

<!-- Modal stack — render only the top entry as a single dialog; the stack
     remains for breadcrumbs/state but prevents multiple real <dialog>s. -->
{#if $modalStack.length > 0}
    {@const entry = $modalStack[$modalStack.length - 1]}
    {@const i = $modalStack.length - 1}
    {#if entry.type === "diff"}
        <DiffModal suggestionId={entry.suggestionId} parentView={entry.parentView} stackIndex={i} />
    {:else if entry.type === "revision"}
        <RevisionModal revisionId={entry.revisionId} view={entry.parentView} stackIndex={i} />
    {/if}
{/if}

<style>
    :global(html) {
        background-color: #e5e7eb; /* gray-200 */
    }
</style>
