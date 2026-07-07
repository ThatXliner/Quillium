<!--
    DocumentTitleBar.svelte — Status bar with the editable document title.

    Renders the StatusBar pill with the current title, inline rename input
    (Cmd+L / click), and the AI title-suggest button. Fully wired to the
    global stores (currentDocumentTitle, currentDocumentId, editorView), so
    it takes no props; Editor.svelte exposes `startEditingTitle` by
    delegating to this component's exported `startEditing()`.
-->
<script lang="ts">
import { createModel } from "$lib/ai/provider";
import {
    aiSettings,
    beginAiTask,
    endAiTask,
    ensureApiKeyLoaded,
    getAiAbortSignal,
    hasApiKey,
} from "$lib/ai/settings.svelte";
import { updateDocumentMeta } from "$lib/db";
import { captureException } from "$lib/posthog";
import { appSettings } from "$lib/settings.svelte";
import { currentDocumentId, currentDocumentTitle, editorView } from "$lib/stores";
import Kbd from "$lib/ui/Kbd.svelte";
import { generateText } from "ai";
import { Pencil, SparklesIcon } from "lucide-svelte";
import { get } from "svelte/store";
import StatusBar from "./StatusBar.svelte";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const modKey = isMac ? "⌘" : "Ctrl";

let titleEditing = $state(false);
let titleInputEl = $state<HTMLInputElement | undefined>();
let titleDraft = $state("");
let titleSuggesting = $state(false);

export function startEditing() {
    titleDraft = $currentDocumentTitle;
    titleEditing = true;
    // Focus input on next tick after it mounts
    setTimeout(() => titleInputEl?.select(), 0);
}

function getWordCount(doc: string): number {
    return doc.trim().split(/\s+/).filter(Boolean).length;
}

async function suggestTitle() {
    const text = $editorView?.state.doc.toString() ?? "";
    if (!text.trim() || titleSuggesting) return;
    titleSuggesting = true;
    const task = beginAiTask("title-suggestion");
    const abortSignal = getAiAbortSignal();
    try {
        await ensureApiKeyLoaded();
        const model = createModel(
            aiSettings.provider,
            aiSettings.apiKey,
            aiSettings.model,
            aiSettings.baseURL,
        );
        const { text: suggested } = await generateText({
            model,
            abortSignal,
            prompt: `Suggest a single short, evocative title for this piece of writing. Reply with only the title — no quotes, no explanation, no punctuation at the end.\n\n${text.slice(0, 1000)}`,
        });
        const newTitle = suggested.trim().slice(0, 40);
        if (newTitle) {
            currentDocumentTitle.set(newTitle);
            const docId = get(currentDocumentId);
            if (docId) {
                updateDocumentMeta(
                    docId,
                    newTitle,
                    getWordCount(text),
                    text.slice(0, 200),
                    "[]",
                    text,
                ).catch((e) => {
                    console.error(e);
                    captureException(e);
                });
            }
        }
    } catch (e) {
        if (!abortSignal.aborted) {
            console.error("[suggestTitle]", e);
            captureException(e);
        }
    } finally {
        titleSuggesting = false;
        endAiTask(task);
    }
}

async function commitTitle() {
    if (!titleEditing) return;
    titleEditing = false;
    const newTitle = titleDraft.trim() || "Untitled";
    if (newTitle === $currentDocumentTitle) return;
    currentDocumentTitle.set(newTitle);
    const docId = get(currentDocumentId);
    if (docId) {
        const text = $editorView?.state.doc.toString() ?? "";
        updateDocumentMeta(
            docId,
            newTitle,
            getWordCount(text),
            text.slice(0, 200),
            "[]",
            text,
        ).catch((e) => {
            console.error(e);
            captureException(e);
        });
    }
}
</script>

<StatusBar titleVisibility={appSettings.titleVisibility} titleForced={titleEditing}>
    {#snippet children()}
        <div class="flex items-center justify-center py-1.5 px-4 mx-auto mb-3 rounded-full {appSettings.titleVisibility !== 'always' ? 'max-w-full' : ''}">
            {#if titleEditing}
                <input
                    bind:this={titleInputEl}
                    bind:value={titleDraft}
                    onblur={commitTitle}
                    onkeydown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); commitTitle(); }
                        if (e.key === "Escape") { titleEditing = false; }
                    }}
                    class="text-sm font-medium text-black/70 bg-transparent border-none outline-none min-w-[8rem] max-w-[28rem] text-center placeholder:text-black/30"
                    aria-label="Document title"
                />
            {:else}
                <button
                    onclick={startEditing}
                    title="Rename title ({modKey}L)"
                    class="flex items-center gap-2 text-sm font-medium text-black/60 hover:text-black/80 transition-colors {appSettings.titleVisibility !== 'always' ? 'max-w-[28rem]' : ''}"
                >
                    <span class={appSettings.titleVisibility !== 'always' ? 'truncate' : ''}>{$currentDocumentTitle}</span>
                    <Pencil size={14} class="shrink-0 text-black/40" />
                    <Kbd keys={[modKey, "L"]} />
                </button>
            {/if}
            {#if appSettings.aiEnabled && hasApiKey()}
                <div class="w-px h-3.5 bg-black/20 shrink-0 mx-1.5"></div>
                <button
                    onclick={suggestTitle}
                    disabled={titleSuggesting}
                    title="Suggest a title with AI"
                    class="flex items-center gap-1 pr-2 py-1 rounded-md text-[10px] font-medium text-black/35 hover:text-black/60 hover:bg-white/50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
                >
                    <SparklesIcon size={11} />
                    <span>{titleSuggesting ? "…" : "Suggest"}</span>
                </button>
            {/if}
        </div>
    {/snippet}
</StatusBar>
