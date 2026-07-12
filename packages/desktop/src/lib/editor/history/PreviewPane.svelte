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
import PreviewContent from "./PreviewContent.svelte";

const {
    tabs,
    drafts,
    viewedTabId = null,
    viewedDraftId = null,
    highlightTabId = null,
    highlightDraftId = null,
    currentStateJson,
    previousText,
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
    highlightTabId?: string | null;
    highlightDraftId?: string | null;
    currentStateJson: string | null;
    previousText: string | null;
    loading: boolean;
    hasContent: boolean;
    bannerText?: string | null;
    empty?: boolean;
    ontabselect: (tabId: string) => void;
    ondraftselect: (draftId: string) => void;
} = $props();

const shownDrafts = $derived(drafts.filter((draft) => draft.tabId === viewedTabId));
</script>

{#if empty}
    <div class="flex w-full flex-col items-center justify-center gap-3 text-center">
        <ClockIcon size={36} class="text-black/15" />
        <p class="text-sm text-black/40">Select a version to preview it</p>
    </div>
{:else}
    <div class="history-document-shell w-full max-w-[1480px]">
        {#if bannerText}
            <div
                class="mx-auto mb-3 w-[816px] max-w-full rounded-lg border border-black/[0.08]
                    bg-blue-50/60 px-4 py-2 text-xs text-black/60"
            >
                {bannerText}
            </div>
        {/if}

        <div class="history-document-grid">
            <div class="history-tabs min-w-0">
                <DocumentTabs
                    readOnly
                    {tabs}
                    activeTabId={viewedTabId}
                    highlightedTabId={highlightTabId}
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
                <PreviewContent {currentStateJson} {previousText} {loading} {hasContent} />
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
        grid-row: 1;
    }

    .history-drafts {
        grid-column: 1;
        grid-row: 2;
    }

    .history-content {
        grid-column: 2;
        grid-row: 2;
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
            grid-row: 2;
        }

        .history-content {
            grid-column: 1;
            grid-row: 3;
        }
    }
</style>
