<script lang="ts">
/**
 * PlaybackViewer.svelte — Interactive writing-provenance playback viewer.
 *
 * Reconstructs and animates a draft's writing process from its full,
 * append-only event stream, color-coded by where each edit came from
 * (typed / pasted / AI revision / formatting / other). Renders a
 * read-only CodeMirror preview (mirroring VersionHistory.svelte) and
 * a transport with play/pause, speed, scrubber, and skip controls.
 *
 * Data + reconstruction reuse existing infra:
 *   - listDraftEvents / resolveActiveDraftId  ($lib/db)
 *   - replayEvents                            ($lib/editor/replay)
 *   - generateProvenanceReport                ($lib/provenance/report)
 *
 * Owned by the authorship-proof feature; rendered by /authorship.
 */
import { listDraftEvents, listSnapshots, loadSnapshotState, resolveActiveDraftId } from "$lib/db";
import type { ChangeSpec, EventPayload, Provenance } from "$lib/db/events";
import type { EventRecord } from "$lib/db/types";
import { getExtensions } from "$lib/editor/extensions";
import { reconstructState } from "$lib/editor/replay";
import { goToEditor } from "$lib/navigation";
import { type ProvenanceReport, generateProvenanceReport } from "$lib/provenance/report";
import { selectPlaybackBaseline } from "$lib/provenance/timeline";
import { currentDocumentId, currentDocumentTitle, currentDraftId } from "$lib/stores";
import Kbd from "$lib/ui/Kbd.svelte";
import { EditorState, RangeSetBuilder } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import {
    ArrowLeft,
    FileText,
    Pause,
    Play,
    Quote,
    SkipBack,
    SkipForward,
    Sparkles,
} from "lucide-svelte";
import { onDestroy, onMount } from "svelte";
import { get } from "svelte/store";

// ── Origin presentation ─────────────────────────────────────────
type OriginStyle = { label: string; badge: string; dot: string; mark: string };

// Tailwind class bundles per origin, plus the highlight color used for the
// inline "current edit" decoration over the just-inserted range.
const ORIGIN_STYLES: Record<string, OriginStyle> = {
    type: {
        label: "Typed",
        badge: "bg-green-100 text-green-700",
        dot: "bg-green-500",
        mark: "rgba(34, 197, 94, 0.22)",
    },
    paste: {
        label: "Pasted",
        badge: "bg-amber-100 text-amber-700",
        dot: "bg-amber-500",
        mark: "rgba(245, 158, 11, 0.24)",
    },
    "ai-revision": {
        label: "AI revision",
        badge: "bg-purple-100 text-purple-700",
        dot: "bg-purple-500",
        mark: "rgba(168, 85, 247, 0.22)",
    },
    "human-revision": {
        label: "Human revision",
        badge: "bg-emerald-100 text-emerald-700",
        dot: "bg-emerald-500",
        mark: "rgba(16, 185, 129, 0.22)",
    },
    "mixed-revision": {
        label: "Mixed revision",
        badge: "bg-fuchsia-100 text-fuchsia-700",
        dot: "bg-fuchsia-500",
        mark: "rgba(217, 70, 239, 0.22)",
    },
    format: {
        label: "Formatting",
        badge: "bg-blue-100 text-blue-700",
        dot: "bg-blue-500",
        mark: "rgba(59, 130, 246, 0.20)",
    },
    other: {
        label: "Other",
        badge: "bg-black/[0.06] text-black/55",
        dot: "bg-black/30",
        mark: "rgba(0, 0, 0, 0.10)",
    },
};

const LEGEND_ORDER = [
    "type",
    "paste",
    "human-revision",
    "ai-revision",
    "mixed-revision",
    "format",
    "other",
] as const;

/** Map a raw provenance origin to one of the five presentation buckets. */
function styleKeyForOrigin(origin: Provenance["origin"] | undefined): string {
    switch (origin) {
        case "type":
            return "type";
        case "paste":
            return "paste";
        case "ai-revision":
            return "ai-revision";
        case "human-revision":
            return "human-revision";
        case "mixed-revision":
            return "mixed-revision";
        case "format":
            return "format";
        default:
            // cut / delete / restore / nested-edit / unknown / legacy
            return "other";
    }
}

// ── Speed ───────────────────────────────────────────────────────
const SPEED_OPTIONS = [0.5, 1, 2, 4] as const;
// Base interval (ms) between steps at 1x. Higher speed → shorter interval.
const BASE_STEP_MS = 320;

// ── State ───────────────────────────────────────────────────────
let events = $state<EventRecord[]>([]);
let loading = $state(true);
let draftId = $state<string | null>(null);
let report = $state<ProvenanceReport | null>(null);
let baselineStateJson = $state<string | null>(null);
let usingSnapshotBaseline = $state(false);
let loadError = $state(false);

let position = $state(0); // number of events applied (0..events.length)
let playing = $state(false);
let speed = $state<number>(1);
let timer: ReturnType<typeof setInterval> | null = null;

let previewEl = $state<HTMLDivElement | undefined>();
let previewView: EditorView | undefined;

// ── Derived facts about the current position ─────────────────────
const total = $derived(events.length);
const currentEvent = $derived(position > 0 ? events[position - 1] : undefined);
const currentOrigin = $derived.by<Provenance["origin"] | undefined>(() => {
    if (!currentEvent) return undefined;
    return provenanceOf(currentEvent)?.origin;
});
const currentStyle = $derived(ORIGIN_STYLES[styleKeyForOrigin(currentOrigin)]);
const currentTimestamp = $derived(
    currentEvent ? new Date(currentEvent.createdAt).toLocaleString() : null,
);

// ── Helpers ─────────────────────────────────────────────────────
function parsePayload(record: EventRecord): EventPayload | undefined {
    try {
        return JSON.parse(record.payload) as EventPayload;
    } catch {
        return undefined;
    }
}

/** Provenance off a doc/compound payload (undefined for annotation-only / malformed). */
function provenanceOf(record: EventRecord): Provenance | undefined {
    const payload = parsePayload(record);
    if (payload && (payload.type === "doc_change" || payload.type === "compound")) {
        return payload.provenance;
    }
    return undefined;
}

/** Doc-change list for a record's payload, or undefined if it has none. */
function docChangesOf(record: EventRecord): ChangeSpec[] | undefined {
    const payload = parsePayload(record);
    if (!payload) return undefined;
    if (payload.type === "doc_change") return payload.changes;
    if (payload.type === "compound") return payload.docChanges;
    return undefined;
}

/**
 * Compute the inserted range [from, to) in the *resulting* document for the
 * event at `position` (1-based). Walks the event's ChangeSpecs and tracks the
 * running offset shift so positions land in the rebuilt doc. Returns undefined
 * when there is nothing inserted (pure deletions, annotation-only events).
 */
function insertedRangeOf(record: EventRecord): { from: number; to: number } | undefined {
    const changes = docChangesOf(record);
    if (!changes || changes.length === 0) return undefined;
    // Specs are pre-mapped against the prior doc; apply them left-to-right while
    // accumulating the net shift from earlier specs in the same event.
    let shift = 0;
    let from = Number.POSITIVE_INFINITY;
    let to = Number.NEGATIVE_INFINITY;
    for (const change of changes) {
        const insertLen = change.insert.length;
        const startInResult = change.from + shift;
        const endInResult = startInResult + insertLen;
        if (insertLen > 0) {
            from = Math.min(from, startInResult);
            to = Math.max(to, endInResult);
        }
        // Net length delta of this spec: inserted - removed.
        shift += insertLen - (change.to - change.from);
    }
    if (from === Number.POSITIVE_INFINITY || to <= from) return undefined;
    return { from, to };
}

// ── Preview reconstruction ───────────────────────────────────────

// Decoration mark for the most-recently-inserted span. Its background color
// follows the current origin via a CSS var set on the editor DOM each step.
const currentEditDeco = Decoration.mark({ class: "cm-provenance-current-edit" });

const currentEditTheme = EditorView.baseTheme({
    ".cm-provenance-current-edit": {
        borderRadius: "2px",
        transition: "background-color 120ms ease",
    },
});

// Minimal extension set for the throwaway "probe" replay used only to measure
// the current event's inserted range (no view, no decorations needed).
const probeExtensions = [...getExtensions({ persist: false, history: false })];

/**
 * Build the decoration set highlighting the latest inserted range, clamped to
 * the document just built for this position. Empty when nothing was inserted.
 */
function currentEditDecorations(state: EditorState): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    if (currentEvent) {
        const range = insertedRangeOf(currentEvent);
        if (range) {
            const from = Math.min(range.from, state.doc.length);
            const to = Math.min(range.to, state.doc.length);
            if (to > from) builder.add(from, to, currentEditDeco);
        }
    }
    return builder.finish();
}

// Mount/remount the preview whenever the target element, the event list, or
// the play position changes. Rebuilds from empty each step — acceptable for v1
// since drafts are small. Mirrors VersionHistory.svelte's $effect mount pattern.
// The "current edit" decoration is provided statically at construction via the
// EditorView.decorations facet (the view is recreated each step, so a static
// set is both simplest and correct here).
$effect(() => {
    if (!previewEl) return;
    // Track reactive deps explicitly so the effect re-runs on every step.
    void position;
    void events;
    void baselineStateJson;

    previewView?.destroy();

    const slice = position > 0 ? events.slice(0, position) : [];

    // Pass 1: reconstruct just to learn the inserted range of the current event
    // against the final document (positions depend on the rebuilt doc length).
    const probe = reconstructState(baselineStateJson, slice, probeExtensions);
    const deco = currentEditDecorations(probe);

    // Pass 2: rebuild the real state with the static decoration facet included
    // from the start, so the highlight and the editor's own annotation
    // decorations both render. Replay is deterministic, so positions match.
    const liveExtensions = [
        ...getExtensions({ persist: false, history: false }),
        EditorState.readOnly.of(true),
        currentEditTheme,
        EditorView.decorations.of(deco),
    ];
    const state = reconstructState(baselineStateJson, slice, liveExtensions);

    previewView = new EditorView({ state, parent: previewEl });
    // Tint color follows the current origin.
    previewView.dom.style.setProperty("--provenance-mark", currentStyle.mark);

    return () => {
        previewView?.destroy();
    };
});

// ── Transport ────────────────────────────────────────────────────
function clampPosition(pos: number): number {
    if (pos < 0) return 0;
    if (pos > total) return total;
    return pos;
}

function stepInterval(): number {
    return Math.max(40, Math.round(BASE_STEP_MS / speed));
}

function stopTimer() {
    if (timer !== null) {
        clearInterval(timer);
        timer = null;
    }
}

function startTimer() {
    stopTimer();
    timer = setInterval(() => {
        if (position >= total) {
            pause();
            return;
        }
        position = clampPosition(position + 1);
    }, stepInterval());
}

function play() {
    if (total === 0) return;
    // Replay from the start if we're already at the end.
    if (position >= total) position = 0;
    playing = true;
    startTimer();
}

function pause() {
    playing = false;
    stopTimer();
}

function togglePlay() {
    if (playing) pause();
    else play();
}

function skipToStart() {
    pause();
    position = 0;
}

function skipToEnd() {
    pause();
    position = total;
}

function onScrub(e: Event) {
    pause();
    position = clampPosition(Number((e.target as HTMLInputElement).value));
}

function onSpeedChange(e: Event) {
    speed = Number((e.target as HTMLSelectElement).value);
    // Restart the interval at the new cadence if currently playing.
    if (playing) startTimer();
}

// ── Lifecycle ────────────────────────────────────────────────────
async function resolveDraftId(): Promise<string | null> {
    const direct = get(currentDraftId);
    if (direct) return direct;
    const docId = get(currentDocumentId);
    if (!docId) return null;
    return resolveActiveDraftId(docId);
}

onMount(async () => {
    loading = true;
    try {
        draftId = await resolveDraftId();
        if (!draftId) return;
        const [allEvents, snapshots] = await Promise.all([
            listDraftEvents(draftId),
            listSnapshots(draftId),
        ]);
        const baseline = selectPlaybackBaseline(allEvents, snapshots);
        if (baseline) {
            baselineStateJson = await loadSnapshotState(baseline.id);
            usingSnapshotBaseline = baselineStateJson !== null;
        }
        events =
            baseline && usingSnapshotBaseline
                ? allEvents.filter((event) => event.id > baseline.upToEventId)
                : allEvents;
        position = events.length; // Open showing the finished document.
        report = await generateProvenanceReport(draftId, get(currentDocumentTitle));
    } catch (error) {
        console.error("[provenance] Could not load authorship playback", error);
        loadError = true;
    } finally {
        loading = false;
    }
});

onDestroy(() => {
    stopTimer();
    previewView?.destroy();
});

// ── Summary formatting ───────────────────────────────────────────
function formatDuration(ms: number): string {
    const totalSeconds = Math.round(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
}

function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
        goToEditor();
        return;
    }
    const target = e.target as HTMLElement | null;
    const typing =
        target &&
        (target.tagName === "INPUT" ||
            target.tagName === "SELECT" ||
            target.tagName === "TEXTAREA");
    if (typing) return;
    if (e.key === " ") {
        e.preventDefault();
        togglePlay();
    } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        pause();
        position = clampPosition(position - 1);
    } else if (e.key === "ArrowRight") {
        e.preventDefault();
        pause();
        position = clampPosition(position + 1);
    }
}
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="h-screen w-full flex flex-col bg-[#f5f5f0]">
    <!-- Top bar -->
    <div
        class="flex items-center gap-4 px-5 py-3 bg-white border-b border-black/[0.08] shadow-sm flex-shrink-0"
    >
        <button
            onclick={goToEditor}
            class="flex items-center gap-2 text-sm text-black/60 hover:text-black/90
                   transition-colors px-2 py-1 rounded-md hover:bg-black/5"
        >
            <ArrowLeft size={16} />
            Back
            <Kbd keys={["Esc"]} />
        </button>
        <div class="w-px h-5 bg-black/15"></div>
        <div class="flex-1 flex items-center gap-2 min-w-0">
            <span class="text-sm font-medium text-black/70 flex-shrink-0">Authorship Playback for</span>
            <span class="text-sm text-black/40 truncate">{$currentDocumentTitle}</span>
        </div>

        {#if report}
            <!-- Summary header -->
            <div class="flex items-center gap-4 text-xs text-black/50">
                <span class="flex items-center gap-1.5">
                    <span class="font-medium text-black/70">
                        {formatDuration(report.activeWritingMs)}
                    </span>
                    active writing
                </span>
                <div class="w-px h-4 bg-black/10"></div>
                <span class="flex items-center gap-1.5">
                    <Quote size={12} class="text-amber-500" />
                    <span class="font-medium text-black/70">{report.pastes.length}</span>
                    paste{report.pastes.length === 1 ? "" : "s"}
                </span>
                <div class="w-px h-4 bg-black/10"></div>
                <span class="flex items-center gap-1.5">
                    <Sparkles size={12} class="text-purple-500" />
                    <span class="font-medium text-black/70">
                        {report.aiAssist.aiRevisionEvents}
                    </span>
                    AI revision{report.aiAssist.aiRevisionEvents === 1 ? "" : "s"}
                </span>
            </div>
        {/if}
    </div>

    <!-- Body -->
    <div class="flex flex-1 overflow-hidden flex-col">
        <!-- Document preview -->
        <div class="flex-1 overflow-y-auto py-10 px-8 flex justify-center">
            {#if loading}
                <div class="flex items-center justify-center w-full text-black/30 text-sm">
                    Loading…
                </div>
            {:else if loadError}
                <div class="flex flex-col items-center justify-center w-full gap-3 text-center">
                    <FileText size={36} class="text-black/15" />
                    <p class="text-sm text-black/45">Couldn’t load writing history.</p>
                    <p class="text-xs text-black/30 leading-relaxed max-w-xs">
                        Your document is unchanged. Return to the editor and try opening Authorship
                        Playback again.
                    </p>
                </div>
            {:else if total === 0 && !baselineStateJson}
                <div class="flex flex-col items-center justify-center w-full gap-3 text-center">
                    <FileText size={36} class="text-black/15" />
                    <p class="text-sm text-black/45">No writing history yet.</p>
                    <p class="text-xs text-black/30 leading-relaxed max-w-xs">
                        Start writing and your authorship process will appear here, ready to play
                        back.
                    </p>
                </div>
            {:else}
                <div
                    class="provenance-preview w-[816px] min-h-full bg-white rounded-lg shadow-xl
                           py-3 px-1 pointer-events-none select-none"
                    bind:this={previewEl}
                ></div>
            {/if}
        </div>

        <!-- Transport / controls -->
        {#if !loading && total > 0}
            <div
                class="flex-shrink-0 bg-white border-t border-black/[0.08] px-6 py-3 space-y-3
                       shadow-[0_-4px_12px_-4px_rgba(0,0,0,0.06)]"
            >
                <!-- Scrubber + position label -->
                <div class="flex items-center gap-4">
                    <button
                        onclick={togglePlay}
                        aria-label={playing ? "Pause" : "Play"}
                        class="flex items-center justify-center w-9 h-9 rounded-full
                               bg-blue-500 text-white hover:bg-blue-600 transition-colors
                               flex-shrink-0"
                    >
                        {#if playing}
                            <Pause size={16} />
                        {:else}
                            <Play size={16} class="translate-x-px" />
                        {/if}
                    </button>

                    <button
                        onclick={skipToStart}
                        aria-label="Skip to start"
                        class="text-black/45 hover:text-black/80 transition-colors flex-shrink-0"
                    >
                        <SkipBack size={18} />
                    </button>

                    <input
                        type="range"
                        min="0"
                        max={total}
                        step="1"
                        value={position}
                        oninput={onScrub}
                        aria-label="Playback position"
                        class="provenance-scrubber flex-1"
                        style="--scrub-fill: {total > 0 ? (position / total) * 100 : 0}%"
                    />

                    <button
                        onclick={skipToEnd}
                        aria-label="Skip to end"
                        class="text-black/45 hover:text-black/80 transition-colors flex-shrink-0"
                    >
                        <SkipForward size={18} />
                    </button>

                    <select
                        value={speed}
                        onchange={onSpeedChange}
                        aria-label="Playback speed"
                        class="text-xs text-black/60 bg-black/[0.04] hover:bg-black/[0.07]
                               rounded-full px-2.5 py-1 border-0 cursor-pointer
                               focus:outline-none focus:ring-1 focus:ring-blue-400 transition-colors
                               flex-shrink-0"
                    >
                        {#each SPEED_OPTIONS as option}
                            <option value={option}>{option}×</option>
                        {/each}
                    </select>
                </div>

                <!-- Status row: badge + legend + position -->
                <div class="flex items-center gap-4 flex-wrap">
                    <!-- Current edit badge -->
                    <div class="flex items-center gap-2 flex-shrink-0">
                        <span
                            class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full
                                   text-[11px] font-medium {currentStyle.badge}"
                        >
                            <span class="w-1.5 h-1.5 rounded-full {currentStyle.dot}"></span>
                            {position === 0 ? "Start" : currentStyle.label}
                        </span>
                        {#if currentTimestamp}
                            <span class="text-[11px] text-black/40">{currentTimestamp}</span>
                        {/if}
                    </div>

                    <div class="w-px h-4 bg-black/10 flex-shrink-0"></div>

                    <!-- Legend -->
                    <div class="flex items-center gap-3 flex-1 min-w-0">
                        {#if usingSnapshotBaseline}
                            <span class="text-[11px] text-black/35">
                                Starts at earliest saved baseline
                            </span>
                            <div class="w-px h-3 bg-black/10"></div>
                        {/if}
                        {#each LEGEND_ORDER as key}
                            {@const style = ORIGIN_STYLES[key]}
                            <span class="flex items-center gap-1.5 text-[11px] text-black/45">
                                <span class="w-2 h-2 rounded-full {style.dot}"></span>
                                {style.label}
                            </span>
                        {/each}
                    </div>

                    <span class="text-[11px] text-black/45 flex-shrink-0">
                        event {position} of {total}
                    </span>
                </div>
            </div>
        {/if}
    </div>
</div>

<style>
    /* The current-edit highlight color tracks the active origin via a CSS var
       set per step in applyCurrentEditDeco. */
    :global(.provenance-preview .cm-provenance-current-edit) {
        background-color: var(--provenance-mark, transparent);
    }
    :global(.provenance-preview .cm-editor) {
        pointer-events: none;
    }
    :global(.provenance-preview .cm-cursor) {
        display: none !important;
    }

    /* Scrubber styling — a simple filled track. */
    .provenance-scrubber {
        appearance: none;
        height: 4px;
        border-radius: 9999px;
        background: linear-gradient(
            to right,
            rgb(59 130 246) 0%,
            rgb(59 130 246) var(--scrub-fill, 0%),
            rgba(0, 0, 0, 0.12) var(--scrub-fill, 0%),
            rgba(0, 0, 0, 0.12) 100%
        );
        cursor: pointer;
    }
    .provenance-scrubber::-webkit-slider-thumb {
        appearance: none;
        width: 14px;
        height: 14px;
        border-radius: 9999px;
        background: white;
        border: 2px solid rgb(59 130 246);
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
        cursor: pointer;
    }
    .provenance-scrubber::-moz-range-thumb {
        width: 14px;
        height: 14px;
        border-radius: 9999px;
        background: white;
        border: 2px solid rgb(59 130 246);
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
        cursor: pointer;
    }
</style>
