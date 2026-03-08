<!--
    DebugPanel.svelte — Developer overlay for loading editor scenarios.

    How it works:
      1. Creates a temporary EditorState with full extensions (including
         annotationField and annotation decorations) but no persist listener.
      2. Mounts a headless EditorView and intercepts every transaction
         dispatched during scenario.setup(), converting each to an
         EventPayload (same format as the live persistence layer).
      3. Wipes the DB and creates a fresh document + draft.
      4. Appends each collected EventPayload to the event log via
         appendEvent(), so the document has a real replay-able history.
      5. Takes a final snapshot of the temp state for fast initial load,
         and calls updateDocumentMeta() so the library shows a preview.
      6. Calls reloadEditor() — the editor restores state via the normal
         snapshot + replayEvents path, identical to a real session restore.

    Activation: click the 🐛 button in the StatusBar, or press Escape to close.
    Only available when import.meta.env.DEV is true (stripped from production).
-->
<script lang="ts">
import { editorView, currentDocumentId, currentDocumentTitle, currentDraftId } from "$lib/stores";
import { debugPanelActive } from "$lib/debug/store.svelte";
import { scenarios, type Scenario } from "$lib/debug/scenarios";
import { EditorState, type Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { getExtensions, savedFields } from "$lib/editor/extensions";
import {
    resetDb,
    createDocument,
    createDraft,
    appendEvent,
    createSnapshot,
    updateDocumentMeta,
} from "$lib/db";
import type { AnnotationEvent, ChangeSpec, EventPayload, SelectionJSON } from "$lib/db/events";
import {
    addAnnotation,
    removeAnnotation,
    updateThread,
    annotationField,
} from "$lib/editor/plugins/annotations/annotationField";
import type { ViewUpdate } from "@codemirror/view";

const { reloadEditor }: { reloadEditor: () => Promise<void> | void } = $props();

let loading = $state<string | null>(null);
let lastLoaded = $state<string | null>(null);
let error = $state<string | null>(null);

function close() {
    $debugPanelActive = false;
}

// ── Event payload extraction (mirrors listeners.ts) ───────────────

function extractSelection(update: ViewUpdate): SelectionJSON {
    const sel = update.state.selection;
    return {
        ranges: sel.ranges.map((r) => ({ anchor: r.anchor, head: r.head })),
        main: sel.mainIndex,
    };
}

function extractAnnotationEvents(tr: Transaction, startState: EditorState): AnnotationEvent[] {
    const events: AnnotationEvent[] = [];
    for (const effect of tr.effects) {
        if (effect.is(addAnnotation)) {
            const annotation = effect.value;
            events.push({
                type: "annotation_add",
                annotation: JSON.parse(
                    JSON.stringify({
                        ...annotation,
                        selection: annotation.selection.toJSON(),
                    }),
                ),
            });
        } else if (effect.is(removeAnnotation)) {
            events.push({
                type: "annotation_remove",
                annotationId: effect.value.id,
            });
        } else if (effect.is(updateThread)) {
            const { annotationId, newThread } = effect.value;
            const ann = startState.field(annotationField)[annotationId];
            if (ann) {
                events.push({
                    type: "annotation_update",
                    annotation: JSON.parse(
                        JSON.stringify({
                            ...ann,
                            selection: ann.selection.toJSON(),
                            thread: newThread,
                        }),
                    ),
                });
            }
        }
    }
    return events;
}

function buildEventPayload(update: ViewUpdate): EventPayload | null {
    let allDocChanges: ChangeSpec[] = [];
    let allAnnotationEvents: AnnotationEvent[] = [];

    for (const tr of update.transactions) {
        if (tr.docChanged) {
            const changes: ChangeSpec[] = [];
            tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
                changes.push({ from: fromA, to: toA, insert: inserted.toString() });
            });
            allDocChanges = allDocChanges.concat(changes);
        }
        allAnnotationEvents = allAnnotationEvents.concat(
            extractAnnotationEvents(tr, update.startState),
        );
    }

    const hasDocChange = allDocChanges.length > 0;
    const hasAnnotationChange = allAnnotationEvents.length > 0;
    if (!hasDocChange && !hasAnnotationChange) return null;

    const selection = extractSelection(update);

    if (hasDocChange && hasAnnotationChange) {
        return { type: "compound", docChanges: allDocChanges, annotationEvents: allAnnotationEvents, selection };
    }
    if (hasDocChange) {
        return { type: "doc_change", changes: allDocChanges, selection };
    }
    if (allAnnotationEvents.length === 1) {
        return allAnnotationEvents[0] as EventPayload;
    }
    return { type: "compound", docChanges: [], annotationEvents: allAnnotationEvents, selection };
}

// ── Scenario runner ───────────────────────────────────────────────

async function runScenario(scenario: Scenario) {
    if (!$editorView) {
        error = "Editor not ready — wait for the editor to initialise.";
        return;
    }

    loading = scenario.id;
    error = null;

    try {
        // 1. Collect EventPayloads from the scenario's transactions.
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

        // 2. Run the scenario — each dispatch fires the updateListener above.
        scenario.setup(tempView);

        const finalState = tempView.state;
        tempView.destroy();

        // 3. Fresh DB: new document + draft.
        await resetDb();
        const docId = await createDocument(scenario.label);
        const draftId = await createDraft(docId, "Draft");
        currentDocumentId.set(docId);
        currentDocumentTitle.set(scenario.label);
        currentDraftId.set(draftId);

        // 4. Replay events into the event log — this is the "real history".
        let lastSeq = -1;
        for (const payload of collectedPayloads) {
            const result = await appendEvent(draftId, JSON.stringify(payload));
            lastSeq = result.eventSeq;
        }

        // 5. Write a snapshot of the final state so the editor loads fast,
        //    and update document metadata so the library shows a preview.
        const stateJson = JSON.stringify(finalState.toJSON(savedFields));
        await createSnapshot(draftId, stateJson, lastSeq);

        const docText = finalState.doc.toString();
        const title = scenario.label;
        const wordCount = docText.trim().split(/\s+/).filter(Boolean).length;
        const previewText = docText.slice(0, 200);
        await updateDocumentMeta(docId, title, wordCount, previewText, "[]");

        // 6. Reload the editor via the normal snapshot + replay path.
        await reloadEditor();

        lastLoaded = scenario.id;
    } catch (e) {
        error = e instanceof Error ? e.message : String(e);
        console.error("[DebugPanel] scenario load failed:", e);
    } finally {
        loading = null;
    }
}

function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") close();
}
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- Backdrop -->
<div
    class="fixed inset-0 z-[100] bg-black/20 backdrop-blur-sm flex items-center justify-center"
    onclick={close}
    role="presentation"
>
    <!-- Panel -->
    <div
        class="relative bg-white/90 backdrop-blur-md border border-white/50 rounded-2xl shadow-2xl w-[520px] max-h-[80vh] flex flex-col overflow-hidden"
        onclick={(e) => e.stopPropagation()}
        onkeydown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Debug panel"
        tabindex="-1"
    >
        <!-- Header -->
        <div class="flex items-center justify-between px-5 py-4 border-b border-black/10">
            <div class="flex items-center gap-2.5">
                <span class="text-lg">🐛</span>
                <span class="font-semibold text-black/80 text-sm">Debug Scenarios</span>
                <span class="text-[10px] font-mono bg-amber-100 text-amber-700 border border-amber-200 rounded px-1.5 py-0.5">DEV</span>
            </div>
            <button
                onclick={close}
                class="w-6 h-6 rounded-full bg-black/10 hover:bg-black/20 text-black/40 hover:text-black/70 transition-colors text-xs font-bold flex items-center justify-center"
                aria-label="Close debug panel"
            >✕</button>
        </div>

        <!-- Info bar -->
        <div class="px-5 py-2.5 bg-amber-50/80 border-b border-amber-100 text-[11px] text-amber-700">
            Saves the scenario to disk and reloads the editor. <strong>Overwrites your current draft.</strong>
        </div>

        <!-- Error -->
        {#if error}
            <div class="mx-5 mt-3 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-[11px] text-red-700">
                {error}
            </div>
        {/if}

        <!-- Scenario list -->
        <div class="overflow-y-auto flex-1 px-4 py-3 flex flex-col gap-2">
            {#each scenarios as scenario}
                {@const isLoading = loading === scenario.id}
                {@const isLoaded = lastLoaded === scenario.id && loading === null}
                <div
                    class={`flex items-start justify-between gap-3 rounded-xl border px-4 py-3 transition-colors ${
                        isLoaded
                            ? "border-green-200 bg-green-50/70"
                            : "border-black/10 bg-white/60 hover:bg-white/90"
                    }`}
                >
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2">
                            <span class="text-sm font-medium text-black/80">{scenario.label}</span>
                            {#if isLoaded}
                                <span class="text-[10px] text-green-600 font-medium">✓ loaded</span>
                            {/if}
                        </div>
                        <p class="text-[11px] text-black/50 mt-0.5 leading-snug">{scenario.description}</p>
                    </div>
                    <button
                        onclick={() => runScenario(scenario)}
                        disabled={loading !== null}
                        class={`shrink-0 text-[11px] font-medium px-3 py-1.5 rounded-lg transition-colors ${
                            isLoading
                                ? "bg-blue-100 text-blue-400 cursor-wait"
                                : "bg-blue-500 hover:bg-blue-600 text-white disabled:opacity-40 disabled:cursor-not-allowed"
                        }`}
                    >
                        {isLoading ? "Saving…" : "Load"}
                    </button>
                </div>
            {/each}
        </div>

        <!-- Footer -->
        <div class="px-5 py-3 border-t border-black/10 text-[10px] text-black/35 flex items-center justify-between">
            <span>Press <kbd class="font-mono bg-black/10 px-1 rounded">Esc</kbd> to close</span>
            <span>DEV only — stripped from production builds</span>
        </div>
    </div>
</div>
