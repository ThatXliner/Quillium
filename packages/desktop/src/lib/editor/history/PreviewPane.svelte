<!--
    PreviewPane.svelte — Historical document shell composed from the live editor UI.

    The history coordinate is rendered through the same DocumentTabs and
    DraftTreePanel components as the live editor. Their read-only modes retain
    tab/draft navigation while removing every structural mutation. The document
    remains the real read-only editor, with history diff decorations layered on
    only when a comparable prior snapshot exists.
-->
<script lang="ts">
import type { DraftMeta, TabMeta } from "$lib/db/types";
import DocumentTabs from "$lib/editor/DocumentTabs.svelte";
import DraftTreePanel from "$lib/editor/DraftTreePanel.svelte";
import { ClockIcon } from "lucide-svelte";
import { onMount } from "svelte";
import PreviewContent from "./PreviewContent.svelte";
import { docTextFromStateJson } from "./diff";

type DiffLayout = "inline" | "side-by-side";
const DIFF_LAYOUT_STORAGE_KEY = "quillium.versionHistory.diffLayout";

const {
    tabs,
    drafts,
    viewedTabId = null,
    viewedDraftId = null,
    deletedTabId = null,
    highlightTabId = null,
    highlightDraftId = null,
    currentStateJson,
    previousStateJson,
    previousText,
    comparisonStatus,
    loading,
    hasContent,
    bannerText = null,
    empty = false,
    ontabselect,
    ondraftselect,
}: {
    tabs: TabMeta[];
    drafts: DraftMeta[];
    viewedTabId?: string | null;
    viewedDraftId?: string | null;
    deletedTabId?: string | null;
    highlightTabId?: string | null;
    highlightDraftId?: string | null;
    currentStateJson: string | null;
    previousStateJson: string | null;
    previousText: string | null;
    comparisonStatus: "changed" | "unchanged" | "no-previous";
    loading: boolean;
    hasContent: boolean;
    bannerText?: string | null;
    empty?: boolean;
    ontabselect: (tabId: string) => void;
    ondraftselect: (draftId: string) => void;
} = $props();

const shownDrafts = $derived(drafts.filter((draft) => draft.tabId === viewedTabId));
let diffLayout = $state<DiffLayout>("inline");
let projectedText = $state("");
const hasTextChanges = $derived(
    comparisonStatus === "changed" && previousText !== null && projectedText !== previousText,
);
const effectiveDiffLayout = $derived(hasTextChanges ? diffLayout : "inline");

$effect(() => {
    projectedText = docTextFromStateJson(currentStateJson);
});

onMount(() => {
    try {
        const saved = localStorage.getItem(DIFF_LAYOUT_STORAGE_KEY);
        if (saved === "inline" || saved === "side-by-side") diffLayout = saved;
    } catch {
        // Storage can be unavailable in hardened webviews.
    }
});

function setDiffLayout(layout: DiffLayout): void {
    diffLayout = layout;
    try {
        localStorage.setItem(DIFF_LAYOUT_STORAGE_KEY, layout);
    } catch {
        // Persistence is a convenience, never a requirement.
    }
}
</script>

{#if empty}
    <div class="flex w-full flex-col items-center justify-center gap-3 text-center">
        <ClockIcon size={36} class="text-black/15" />
        <p class="text-sm text-black/40">Select a version to preview it</p>
    </div>
{:else}
    <div class="history-document-shell w-full max-w-[1680px]">
        {#if bannerText}
            <div
                class="mx-auto mb-3 w-[816px] max-w-full rounded-lg border border-black/[0.08]
                    bg-blue-50/60 px-4 py-2 text-xs text-black/60"
            >
                {bannerText}
            </div>
        {/if}

        <div class="history-document-grid">
            <div class="history-comparison-bar">
                <div class="min-w-0 flex-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-black/60">
                    {#if hasTextChanges}
                        <span class="flex items-center gap-1.5">
                            <span
                                class="inline-block w-3 h-3 rounded-sm bg-green-200 border border-green-400"
                            ></span>
                            Added (underlined)
                        </span>
                        <span class="flex items-center gap-1.5">
                            <span
                                class="inline-block w-3 h-3 rounded-sm bg-red-200 border border-red-400"
                            ></span>
                            Removed (struck through)
                        </span>
                        <span class="text-black/50">Compared with the previous version</span>
                    {:else if comparisonStatus === "no-previous"}
                        <span>No earlier version to compare</span>
                    {:else}
                        <span>No differences at this point</span>
                    {/if}
                </div>

                {#if hasTextChanges}
                    <div class="flex items-center gap-2 shrink-0">
                        <span class="text-xs font-medium text-black/55">View</span>
                        <div
                            class="flex rounded-lg border border-black/[0.10] bg-black/[0.04] p-0.5"
                            role="group"
                            aria-label="Diff layout"
                        >
                            <button
                                type="button"
                                aria-pressed={diffLayout === "inline"}
                                onclick={() => setDiffLayout("inline")}
                                class="rounded-md px-3 py-1.5 text-xs font-medium transition-colors
                                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60
                                    {diffLayout === 'inline'
                                        ? 'bg-white text-blue-700 shadow-sm'
                                        : 'text-black/55 hover:bg-white/60 hover:text-black/75'}"
                            >
                                Inline
                            </button>
                            <button
                                type="button"
                                aria-pressed={diffLayout === "side-by-side"}
                                onclick={() => setDiffLayout("side-by-side")}
                                class="rounded-md px-3 py-1.5 text-xs font-medium transition-colors
                                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60
                                    {diffLayout === 'side-by-side'
                                        ? 'bg-white text-blue-700 shadow-sm'
                                        : 'text-black/55 hover:bg-white/60 hover:text-black/75'}"
                            >
                                Side by side
                            </button>
                        </div>
                    </div>
                {/if}
            </div>

            <div class="history-tabs min-w-0">
                <DocumentTabs
                    readOnly
                    {tabs}
                    activeTabId={viewedTabId}
                    highlightedTabId={highlightTabId}
                    {deletedTabId}
                    {ontabselect}
                />
            </div>

            <aside
                class="history-drafts"
                aria-label="Historical draft navigation"
            >
                <DraftTreePanel
                    readOnly
                    drafts={shownDrafts}
                    activeDraftId={viewedDraftId}
                    highlightedDraftId={highlightDraftId}
                    {ondraftselect}
                />
            </aside>

            <div class="history-content min-w-0">
                <PreviewContent
                    {currentStateJson}
                    {previousStateJson}
                    {previousText}
                    diffLayout={effectiveDiffLayout}
                    {loading}
                    {hasContent}
                    oncurrenttextchange={(text) => (projectedText = text)}
                />
            </div>
        </div>
    </div>
{/if}

<style>
    .history-document-shell {
        container-type: inline-size;
    }

    .history-document-grid {
        display: grid;
        grid-template-columns: 12rem minmax(0, 1fr);
        column-gap: 1.5rem;
    }

    .history-tabs {
        grid-column: 2;
        grid-row: 2;
    }

    .history-comparison-bar {
        grid-column: 2;
        grid-row: 1;
        display: flex;
        min-height: 2.5rem;
        align-items: center;
        gap: 0.75rem;
        padding: 0 0.25rem 0.65rem;
    }

    .history-drafts {
        grid-column: 1;
        grid-row: 3;
    }

    .history-content {
        grid-column: 2;
        grid-row: 3;
    }

    /* Keep the 816px document surface intact when the history timeline leaves
       too little inline room for the tree beside it. The tree moves above the
       tab/document pair, so navigation remains available without squeezing the
       page narrower than the live editor. */
    @container (max-width: 1055px) {
        .history-document-grid {
            grid-template-columns: minmax(0, 1fr);
            column-gap: 0;
        }

        .history-drafts {
            grid-column: 1;
            grid-row: 1;
            margin-bottom: 0.75rem;
        }

        .history-tabs {
            grid-column: 1;
            grid-row: 3;
        }

        .history-comparison-bar {
            grid-column: 1;
            grid-row: 2;
        }

        .history-content {
            grid-column: 1;
            grid-row: 4;
        }
    }
</style>
