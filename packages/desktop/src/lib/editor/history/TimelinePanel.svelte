<!--
    TimelinePanel.svelte — The document-wide history timeline (right rail).

    One linear, chronological stream interleaving content snapshots (across every
    draft) with structural events, grouped into collapsible calendar-day and
    hour sections. Both snapshot and activity rows are selectable coordinates;
    snapshot rows are additionally label-editable. There is exactly one restore
    path — the parent's top-bar "Restore to here" CTA acting on the selected
    coordinate — so rows carry no inline restore action.

    Props:
      groups          — day- and hour-grouped TimelineItem[] (from timeline.ts)
      selectedId      — id of the selected TimelineItem, or null
      onselect        — (item) select a coordinate
      onlabel         — (snapshotId, label) commit a snapshot label
-->
<script lang="ts">
import { ChevronDown, ChevronRight, PencilIcon } from "lucide-svelte";
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
let initializedFolds = $state(false);
let collapsedDays = $state<Set<string>>(new Set());
let collapsedHours = $state<Set<string>>(new Set());

$effect(() => {
    if (initializedFolds || groups.length === 0) return;

    // Keep the newest writing session immediately visible while making a long
    // history calm to scan. Each older day opens with only its newest hour shown.
    collapsedDays = new Set(groups.slice(1).map((group) => group.key));
    collapsedHours = new Set(
        groups.flatMap((group) => group.hours.slice(1).map((hour) => hour.key)),
    );
    initializedFolds = true;
});

$effect(() => {
    if (!selectedId) return;

    for (const group of groups) {
        const hour = group.hours.find((candidate) =>
            candidate.items.some((item) => item.id === selectedId),
        );
        if (!hour) continue;

        if (collapsedDays.has(group.key)) {
            const next = new Set(collapsedDays);
            next.delete(group.key);
            collapsedDays = next;
        }
        if (collapsedHours.has(hour.key)) {
            const next = new Set(collapsedHours);
            next.delete(hour.key);
            collapsedHours = next;
        }
        break;
    }
});

function toggleDay(key: string) {
    const next = new Set(collapsedDays);
    if (!next.delete(key)) next.add(key);
    collapsedDays = next;
}

function toggleHour(key: string) {
    const next = new Set(collapsedHours);
    if (!next.delete(key)) next.add(key);
    collapsedHours = next;
}

function versionCount(group: TimelineGroup): number {
    return group.hours.reduce((count, hour) => count + hour.items.length, 0);
}

function countLabel(count: number): string {
    return `${count} ${count === 1 ? "version" : "versions"}`;
}

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
    {#each groups as group (group.key)}
        {@const dayCollapsed = collapsedDays.has(group.key)}
        {@const dayPanelId = `history-day-${group.key}`}
        <button
            type="button"
            aria-expanded={!dayCollapsed}
            aria-controls={dayPanelId}
            onclick={() => toggleDay(group.key)}
            class="w-full px-4 pt-4 pb-2 flex items-center gap-2 text-left group/day
                   hover:bg-black/[0.02] transition-colors"
        >
            {#if dayCollapsed}
                <ChevronRight size={13} class="text-black/25 group-hover/day:text-black/45" />
            {:else}
                <ChevronDown size={13} class="text-black/25 group-hover/day:text-black/45" />
            {/if}
            <span class="text-[11px] font-semibold text-black/45 uppercase tracking-wide">
                {group.heading}
            </span>
            <span class="ml-auto text-[10px] text-black/25 normal-case tracking-normal">
                {countLabel(versionCount(group))}
            </span>
        </button>

        {#if !dayCollapsed}
            <div id={dayPanelId}>
                {#each group.hours as hour (hour.key)}
                    {@const hourCollapsed = collapsedHours.has(hour.key)}
                    {@const hourPanelId = `history-hour-${hour.key}`}
                    <button
                        type="button"
                        aria-expanded={!hourCollapsed}
                        aria-controls={hourPanelId}
                        onclick={() => toggleHour(hour.key)}
                        class="w-full pl-7 pr-4 py-1.5 flex items-center gap-2 text-left
                               hover:bg-black/[0.02] transition-colors group/hour"
                    >
                        {#if hourCollapsed}
                            <ChevronRight
                                size={12}
                                class="text-black/20 group-hover/hour:text-black/40"
                            />
                        {:else}
                            <ChevronDown
                                size={12}
                                class="text-black/20 group-hover/hour:text-black/40"
                            />
                        {/if}
                        <span class="text-xs font-medium text-black/45">{hour.heading}</span>
                        <span class="ml-auto text-[10px] text-black/25">
                            {countLabel(hour.items.length)}
                        </span>
                    </button>

                    {#if !hourCollapsed}
                        <div id={hourPanelId}>
                            {#each hour.items as item (item.id)}
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
                    class="w-full text-left pl-9 pr-4 py-2.5 flex items-start gap-3 cursor-pointer
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
                    class="w-full text-left pl-9 pr-4 py-2.5 flex items-start gap-3 cursor-pointer
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
                        </div>
                    {/if}
                {/each}
            </div>
        {/if}
    {/each}
</div>
