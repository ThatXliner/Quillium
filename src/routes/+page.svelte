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
import DictionaryPopover from "$lib/editor/DictionaryPopover.svelte";
import Tutorial from "$lib/tutorial/Tutorial.svelte";
import { tutorialActive, modalStack, editorView, settingsOpen } from "$lib/stores";
import DiffModal from "$lib/editor/plugins/annotations/DiffModal.svelte";
import RevisionModal from "$lib/editor/plugins/annotations/RevisionModal.svelte";
import CommentModal from "$lib/editor/plugins/annotations/CommentModal.svelte";
import { debugPanelActive } from "$lib/debug/store.svelte";
import DebugPanel from "$lib/debug/DebugPanel.svelte";
import { goToHistory, goToLibrary } from "$lib/navigation";
import type { EventPayload } from "$lib/db/events";
import type { BackupEntry } from "$lib/errorGuard";
import { restoreBackup } from "$lib/editor/restore";
import { exportDocument } from "$lib/export";
import { appSettings, applySettings, persistSettings } from "$lib/settings.svelte";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import UpdateBanner from "$lib/ui/UpdateBanner.svelte";
import AutoAIWidget from "$lib/autoai/AutoAIWidget.svelte";
import { toast, Toaster } from "svelte-sonner";
import { triggerManualReview } from "$lib/autoai/engine";
import { autoAISettings } from "$lib/autoai/settings.svelte";

let updateAvailable = $state(false);
let updateVersion = $state("");
let updateInstalling = $state(false);
let updateReady = $state(false);

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
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "e") {
        e.preventDefault();
        const view = $editorView;
        if (view) exportDocument(view, "txt");
    }
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "h") {
        e.preventDefault();
        goToHistory();
    }
    if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        $settingsOpen = !$settingsOpen;
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

async function installUpdate() {
    updateInstalling = true;
    try {
        if (updateReady) {
            await relaunch();
        } else {
            const update = await check();
            if (update) {
                await update.downloadAndInstall();
                updateReady = true;
            }
            updateInstalling = false;
        }
    } catch (e) {
        console.error("Update install failed:", e);
        updateInstalling = false;
    }
}

onMount(() => {
    showTutorialOnFirstVisit();

    // Check for updates silently in the background.
    check()
        .then((update) => {
            if (update) {
                updateAvailable = true;
                updateVersion = update.version;
            }
        })
        .catch(() => {
            toast.error("Unable to check for updates", {
                description:
                    "https://github.com/ThatXliner/quillium-releases could not be reached",
            });
        });

    // Handle crash-restore events dispatched by ErrorBanner.svelte.
    function handleRestoreBackup(e: Event) {
        const view = $editorView;
        if (!view) return;
        const { documentText } = (e as CustomEvent<BackupEntry>).detail;
        restoreBackup(view, documentText);
    }

    function handleManualReviewEvent() {
        if (appSettings.aiEnabled && autoAISettings.enabled) triggerManualReview();
    }

    window.addEventListener("quillium:restore-backup", handleRestoreBackup);
    window.addEventListener("quillium:manual-review", handleManualReviewEvent);

    // Listen for Tauri menu events
    const menuUnlisteners: UnlistenFn[] = [];
    listen("menu:settings", () => ($settingsOpen = !$settingsOpen)).then((u) =>
        menuUnlisteners.push(u),
    );
    listen("menu:history", () => goToHistory()).then((u) => menuUnlisteners.push(u));
    listen("menu:library", () => goToLibrary()).then((u) => menuUnlisteners.push(u));
    listen("menu:export", () => {
        const view = $editorView;
        if (view) exportDocument(view, "txt");
    }).then((u) => menuUnlisteners.push(u));

    return () => {
        window.removeEventListener("quillium:restore-backup", handleRestoreBackup);
        window.removeEventListener("quillium:manual-review", handleManualReviewEvent);
        for (const unlisten of menuUnlisteners) unlisten();
    };
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

                // Set stores after snapshot is written to avoid a race
                // where the Editor subscription loads an empty state.
                currentDocumentId.set(docId);
                currentDocumentTitle.set(scenario.label);
                currentDraftId.set(draftId);

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

{#if appSettings.aiEnabled}
    <AiSidebar />
{/if}
<DictionaryPopover />

<div class="h-screen w-full">
    <Editor bind:this={editorComponent} />
</div>

<!-- Update banner — shown when a new version is available -->
{#if updateAvailable}
    <UpdateBanner
        version={updateVersion}
        installing={updateInstalling}
        ready={updateReady}
        oninstall={installUpdate}
        ondismiss={() => updateAvailable = false}
    />
{/if}

<!-- Tutorial overlay — rendered when tutorialActive store is true -->
{#if $tutorialActive}
    <Tutorial onComplete={() => {}} />
{/if}

<!-- Debug panel — DEV only, never rendered in production builds -->
{#if import.meta.env.DEV && $debugPanelActive}
    <DebugPanel
        reloadEditor={() => editorComponent?.reload()}
    />
{/if}

<!-- AutoAI collaborator widget — fixed bottom-right bubble -->
{#if appSettings.aiEnabled}
    <AutoAIWidget />
{/if}
<Toaster position="bottom-right" />

<!-- Modal stack — render all entries so parent editors stay alive when a
     child modal is pushed on top. Each modal manages its own dialog
     visibility via `isTop` (only the topmost shows its <dialog>). -->
{#each $modalStack as entry, i (i)}
    {#if entry.type === "diff"}
        <DiffModal suggestionId={entry.suggestionId} parentView={entry.parentView} stackIndex={i} />
    {:else if entry.type === "revision"}
        <RevisionModal revisionId={entry.revisionId} view={entry.parentView} stackIndex={i} />
    {:else if entry.type === "comment"}
        <CommentModal commentId={entry.commentId} parentView={entry.parentView} stackIndex={i} />
    {/if}
{/each}

<style>
    :global(html) {
        background-color: #e5e7eb; /* gray-200 */
    }
</style>
