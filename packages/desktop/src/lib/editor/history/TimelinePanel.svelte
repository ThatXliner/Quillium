<!--
    TimelinePanel.svelte — The document-wide history timeline (right rail).

    One linear, chronological stream interleaving content snapshots (across every
    draft) with structural events, grouped by date. Both snapshot and activity
    rows are selectable coordinates; snapshot rows are additionally label-
    editable. There is exactly one restore path — the parent's top-bar "Restore
    to here" CTA acting on the selected coordinate — so rows carry no inline
    restore action.

    Props:
      groups          — date-grouped TimelineItem[] (from timeline.ts)
      selectedId      — id of the selected TimelineItem, or null
      onselect        — (item) select a coordinate
      onlabel         — (snapshotId, label) commit a snapshot label
-->
<script lang="ts">
import { PencilIcon } from "lucide-svelte";
import {
    type TimelineGroup,
    type TimelineItem,
    describeDocEvent,
    formatTime,
    formatTimeShort,
} from "./timeline";

const {
    groups,
    selectedId,
    onselect,
    onlabel,
}: {
    groups: TimelineGroup[];
    selectedId: string | null;
    onselect: (item: TimelineItem) => void;
    onlabel: (snapshotId: number, label: string) => void;
} = $props();

let editingLabelId = $state<number | null>(null);
let editingLabelText = $state("");

function startEdit(snapshotId: number, current: string) {
    editingLabelId = snapshotId;
    editingLabelText = current;
}

function commitEdit(snapshotId: number) {
    if (editingLabelText.trim()) onlabel(snapshotId, editingLabelText.trim());
    editingLabelId = null;
}
</script>

<div role="list" aria-label="History timeline">
    {#each groups as group (group.heading)}
        <div class="px-4 pt-4 pb-1">
            <span class="text-[11px] font-semibold text-black/35 uppercase tracking-wide">
                {group.heading}
            </span>
        </div>
        {#each group.items as item (item.id)}
            {#if item.kind === "snapshot"}
                {@const snapshot = item.snapshot}
                {@const isSelected = selectedId === item.id}
                <div
                    role="option"
                    tabindex="0"
                    aria-selected={isSelected}
                    onclick={() => onselect(item)}
                    onkeydown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onselect(item);
                        }
                    }}
                    class="w-full text-left px-4 py-2.5 flex items-start gap-3 cursor-pointer
                           transition-colors
                           {isSelected
                               ? 'bg-blue-50 border-r-2 border-blue-500'
                               : 'hover:bg-black/[0.025] border-r-2 border-transparent'}"
                >
                    <div
                        class="mt-1.5 w-2 h-2 rounded-full flex-shrink-0
                               {snapshot.label ? 'bg-blue-500' : 'bg-black/20'}"
                    ></div>
                    <div class="flex-1 min-w-0">
                        {#if editingLabelId === snapshot.id}
                            <input
                                type="text"
                                bind:value={editingLabelText}
                                onclick={(e) => e.stopPropagation()}
                                onblur={() => commitEdit(snapshot.id)}
                                onkeydown={(e) => {
                                    e.stopPropagation();
                                    if (e.key === "Enter") commitEdit(snapshot.id);
                                    if (e.key === "Escape") editingLabelId = null;
                                }}
                                class="text-sm font-medium text-blue-600 bg-blue-50 border
                                       border-blue-300 rounded px-1.5 py-0.5 focus:outline-none w-full"
                            />
                        {:else if snapshot.label}
                            <div class="flex items-center gap-1">
                                <span class="text-sm font-medium text-blue-600 truncate">
                                    {snapshot.label}
                                </span>
                                <button
                                    aria-label="Edit label"
                                    onclick={(e) => {
                                        e.stopPropagation();
                                        startEdit(snapshot.id, snapshot.label ?? "");
                                    }}
                                    class="text-black/20 hover:text-black/50 transition-colors flex-shrink-0"
                                >
                                    <PencilIcon size={10} />
                                </button>
                            </div>
                        {:else}
                            <div class="flex items-center gap-1">
                                <span class="text-xs text-black/50">
                                    {formatTimeShort(snapshot.createdAt)}
                                </span>
                                <button
                                    onclick={(e) => {
                                        e.stopPropagation();
                                        startEdit(snapshot.id, "");
                                    }}
                                    title="Add label"
                                    aria-label="Add label"
                                    class="text-black/20 hover:text-black/50 transition-colors flex-shrink-0"
                                >
                                    <PencilIcon size={10} />
                                </button>
                            </div>
                        {/if}
                        <p class="text-[11px] text-black/35 mt-0.5">
                            {snapshot.draftLabel} · {snapshot.label ? "Named checkpoint" : "Auto-saved"}
                        </p>
                    </div>
                </div>
            {:else}
                {@const info = describeDocEvent(item.event)}
                {@const isSelected = selectedId === item.id}
                <!-- A structural event is a coordinate too: selecting it and
                     hitting "Restore to here" rewinds the whole document to that
                     point. There is exactly ONE restore path (the top-bar CTA);
                     no competing inline action. -->
                <div
                    role="option"
                    tabindex="0"
                    aria-selected={isSelected}
                    onclick={() => onselect(item)}
                    onkeydown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onselect(item);
                        }
                    }}
                    class="w-full text-left px-4 py-2.5 flex items-start gap-3 cursor-pointer
                           transition-colors
                           {isSelected
                               ? 'bg-blue-50 border-r-2 border-blue-500'
                               : 'hover:bg-black/[0.025] border-r-2 border-transparent'}"
                >
                    <div class="mt-1.5 w-2 h-2 rounded-full bg-black/15 flex-shrink-0"></div>
                    <div class="flex-1 min-w-0">
                        <p class="text-xs text-black/55 leading-snug">{info.text}</p>
                        <p class="text-[10px] text-black/30 mt-0.5">{formatTime(item.event.createdAt)}</p>
                    </div>
                </div>
            {/if}
        {/each}
    {/each}
</div>
