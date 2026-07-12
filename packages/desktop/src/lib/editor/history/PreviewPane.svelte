<!--
    PreviewPane.svelte — Two-column history preview: structure map + content.

    Left: the document's tab/draft structure as-of the selected coordinate
    (PreviewStructureMap) — tabs are clickable to switch which tab's content the
    right side shows. Right: that tab's content at the coordinate, rendered as a
    track-changes diff vs. the previous version (PreviewContent).

    Props:
      tabs, drafts          — structure rewound to the coordinate
      viewedTabId           — tab whose content is shown (controlled)
      highlightDraftId      — the coordinate's target draft
      currentStateJson      — serialized EditorState of the viewed version
      previousStateJson     — serialized EditorState of the comparison version
      previousText          — plain text of the previous version (diff baseline)
      hasPrevious           — distinguishes no baseline from an empty baseline
      loading               — true while content loads
      hasContent            — false when the viewed tab has no content here
      bannerText            — optional note (structural coordinate)
      empty                 — true when no coordinate is selected
      ontabselect           — (tabId) switch the viewed tab
-->
<script lang="ts">
import type { DraftMeta, TabMeta } from "$lib/db/types";
import { ClockIcon } from "lucide-svelte";
import PreviewContent from "./PreviewContent.svelte";
import PreviewStructureMap from "./PreviewStructureMap.svelte";

const {
    tabs,
    drafts,
    viewedTabId = null,
    highlightDraftId = null,
    currentStateJson,
    previousStateJson,
    previousText,
    hasPrevious,
    loading,
    hasContent,
    bannerText = null,
    empty = false,
    ontabselect,
}: {
    tabs: TabMeta[];
    drafts: DraftMeta[];
    viewedTabId?: string | null;
    highlightDraftId?: string | null;
    currentStateJson: string | null;
    previousStateJson: string | null;
    previousText: string;
    hasPrevious: boolean;
    loading: boolean;
    hasContent: boolean;
    bannerText?: string | null;
    empty?: boolean;
    ontabselect: (tabId: string) => void;
} = $props();
</script>

{#if empty}
    <div class="flex flex-col items-center justify-center w-full gap-3 text-center">
        <ClockIcon size={36} class="text-black/15" />
        <p class="text-sm text-black/40">Select a version to preview it</p>
    </div>
{:else}
    <div class="history-preview-shell w-full max-w-[1680px]">
        <div class="history-preview-layout flex w-full gap-6">
            <!-- Structure map (clickable tabs) -->
            <aside class="history-structure-map w-64 flex-shrink-0">
                <h3
                    class="text-xs font-semibold text-black/55 uppercase tracking-wide mb-2 px-1"
                >
                    Structure
                </h3>
                <PreviewStructureMap
                    {tabs}
                    {drafts}
                    {viewedTabId}
                    {highlightDraftId}
                    {ontabselect}
                />
            </aside>

            <!-- Content (real read-only editor + selectable diff layout) -->
            <div class="flex-1 flex justify-center min-w-0">
                <PreviewContent
                    {currentStateJson}
                    {previousStateJson}
                    {previousText}
                    {hasPrevious}
                    {loading}
                    {hasContent}
                    {bannerText}
                />
            </div>
        </div>
    </div>
{/if}

<style>
    .history-preview-shell {
        container-type: inline-size;
    }

    /* The structure rail is useful context, but it should move above the
       comparison before it forces two readable prose panes to collapse. */
    @container (max-width: 1100px) {
        .history-preview-layout {
            flex-direction: column;
        }

        .history-structure-map {
            width: min(100%, 32rem);
        }
    }
</style>
