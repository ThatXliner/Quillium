<!--
    PreviewContent.svelte — The content half of the history preview.

    Renders the selected snapshot in a real read-only CodeMirror editor using
    the same extensions and typography as the writing surface. Writers can
    compare it with the previous snapshot in either layout:

      Inline       — additions in the selected text plus injected removals.
      Side by side — removals in the previous pane, additions in the selected.

    The chosen layout survives timeline/tab changes and future visits. The two
    split panes intentionally own separate EditorViews and diff extensions so
    one pane's lifecycle can never detach or reconfigure the other.
-->
<script lang="ts">
import { getExtensions, savedFields } from "$lib/editor/extensions";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, type ViewUpdate } from "@codemirror/view";
import {
    ReadonlyAnnotationCard,
    ReadonlyEditorController,
    ReadonlyEditorHost,
} from "@quillium/share";
import { onMount } from "svelte";
import { docTextFromStateJson } from "./diff";
import { diffDecorations, diffTheme, sideBySideDiffDecorations } from "./diffDecorations";

type DiffLayout = "inline" | "side-by-side";

const DIFF_LAYOUT_STORAGE_KEY = "quillium.versionHistory.diffLayout";

const {
    currentStateJson,
    previousStateJson,
    previousText,
    hasPrevious,
    loading,
    hasContent,
    bannerText = null,
}: {
    currentStateJson: string | null;
    previousStateJson: string | null;
    previousText: string;
    hasPrevious: boolean;
    loading: boolean;
    hasContent: boolean;
    bannerText?: string | null;
} = $props();

let previewView: EditorView | undefined;
let previousPreviewView: EditorView | undefined;
const editorController = new ReadonlyEditorController();
let diffCompartment: Compartment | undefined;
let previousDiffCompartment: Compartment | undefined;
let previewRevision = $state(0);
let activeAnnotationId = $state<string | null>(null);
let diffLayout = $state<DiffLayout>("inline");

onMount(() => {
    try {
        const saved = localStorage.getItem(DIFF_LAYOUT_STORAGE_KEY);
        if (saved === "inline" || saved === "side-by-side") diffLayout = saved;
    } catch {
        // Storage can be unavailable in hardened webviews; the inline default
        // remains fully functional.
    }
});

const serializedCurrentText = $derived(docTextFromStateJson(currentStateJson));
const currentPreviewText = $derived.by(() => {
    void previewRevision;
    return previewView?.state.doc.toString() ?? serializedCurrentText;
});
const hasTextChanges = $derived(hasPrevious && currentPreviewText !== previousText);
const selectedPaneLabel = $derived(bannerText ? "At selected point" : "Selected version");
const annotationProjection = $derived.by(() => {
    void previewRevision;
    return editorController.snapshot();
});
const previewSerializedState = $derived.by(() => {
    // A baseline/layout change must rebuild the current view even when its
    // serialized snapshot did not change.
    void previousText;
    void hasPrevious;
    void diffLayout;
    return parseSerializedState(currentStateJson, "");
});
const previousSerializedState = $derived.by(() => {
    // Rebuild the previous pane when the selected snapshot changes, even if
    // the previous snapshot itself stays the same.
    void serializedCurrentText;
    return parseSerializedState(previousStateJson, previousText);
});

function parseSerializedState(json: string | null, fallbackDoc: string): Record<string, unknown> {
    if (!json || json === "{}") return { doc: fallbackDoc };
    try {
        return JSON.parse(json) as Record<string, unknown>;
    } catch {
        return { doc: fallbackDoc };
    }
}

function setDiffLayout(layout: DiffLayout): void {
    diffLayout = layout;
    try {
        localStorage.setItem(DIFF_LAYOUT_STORAGE_KEY, layout);
    } catch {
        // Treat persistence as a convenience, never a requirement.
    }
}

function selectAnnotation(annotationId: string): void {
    if (!editorController.selectAnnotation(annotationId)) return;
    activeAnnotationId = annotationId;
}

function currentDiffExtension(current: string): Extension {
    if (!hasPrevious) return [];
    return diffLayout === "side-by-side"
        ? sideBySideDiffDecorations(previousText, current, "selected")
        : diffDecorations(previousText, current);
}

function switchRevisionVersion(annotationId: string, versionIndex: number): void {
    if (!previewView || !editorController.switchRevisionVersion(annotationId, versionIndex)) return;
    if (diffCompartment) {
        previewView.dispatch({
            effects: diffCompartment.reconfigure(
                currentDiffExtension(previewView.state.doc.toString()),
            ),
        });
    }
    if (previousPreviewView && previousDiffCompartment) {
        previousPreviewView.dispatch({
            effects: previousDiffCompartment.reconfigure(
                sideBySideDiffDecorations(
                    previousPreviewView.state.doc.toString(),
                    previewView.state.doc.toString(),
                    "previous",
                ),
            ),
        });
    }
}

function previewExtensions(updateListener: Extension, diff: Extension): Extension[] {
    return [
        ...getExtensions({ persist: false, history: false }),
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        updateListener,
        diffTheme,
        diff,
    ];
}

function createPreviewState(
    serializedState: Record<string, unknown>,
    updateListener: Extension,
): EditorState {
    const current = typeof serializedState.doc === "string" ? serializedState.doc : "";
    const mountedDiffCompartment = new Compartment();
    const extensions = previewExtensions(
        updateListener,
        mountedDiffCompartment.of(currentDiffExtension(current)),
    );

    diffCompartment = mountedDiffCompartment;
    try {
        return EditorState.fromJSON(serializedState, { extensions }, savedFields);
    } catch {
        return EditorState.create({ doc: current, extensions });
    }
}

function createPreviousPreviewState(
    serializedState: Record<string, unknown>,
    updateListener: Extension,
): EditorState {
    const previous = typeof serializedState.doc === "string" ? serializedState.doc : previousText;
    const mountedPreviousDiffCompartment = new Compartment();
    const extensions = previewExtensions(
        updateListener,
        mountedPreviousDiffCompartment.of(
            sideBySideDiffDecorations(previousText, serializedCurrentText, "previous"),
        ),
    );

    previousDiffCompartment = mountedPreviousDiffCompartment;
    try {
        return EditorState.fromJSON(serializedState, { extensions }, savedFields);
    } catch {
        return EditorState.create({ doc: previous, extensions });
    }
}

function handlePreviousPreviewReady(nextView: EditorView | null): void {
    previousPreviewView = nextView ?? undefined;
    if (!nextView) previousDiffCompartment = undefined;
}

function handlePreviewReady(nextView: EditorView | null): void {
    previewView = nextView ?? undefined;
    editorController.attach(nextView);
    previewRevision = performance.now();
    if (!nextView) {
        diffCompartment = undefined;
        activeAnnotationId = null;
        return;
    }
    activeAnnotationId = editorController.activeAnnotationId();
}

function handlePreviewUpdate(update: ViewUpdate): void {
    if (!update.selectionSet && !update.docChanged) return;
    activeAnnotationId = editorController.activeAnnotationId();
    previewRevision = performance.now();
}
</script>

{#snippet annotationCards()}
    {#each annotationProjection.annotations as annotation (annotation.id)}
        <ReadonlyAnnotationCard
            {annotation}
            active={activeAnnotationId === annotation.id}
            {activeAnnotationId}
            selectedRevisionVersionIndex={annotation.type === "revision"
                ? annotation.activeVersionIndex
                : null}
            onSelect={() => selectAnnotation(annotation.id)}
            onSelectAnnotation={selectAnnotation}
            onSelectRevisionVersion={(versionIndex) =>
                switchRevisionVersion(annotation.id, versionIndex)}
        />
    {/each}
{/snippet}

<div class="history-preview-content w-full flex flex-col items-center gap-3">
    {#if bannerText}
        <div
            class="w-full max-w-[1280px] rounded-lg border border-black/[0.08] bg-blue-50/60
                   px-4 py-2 text-xs text-black/65"
        >
            {bannerText}
        </div>
    {/if}

    {#if loading}
        <div class="flex items-center justify-center w-full py-20 text-black/55 text-sm">
            Loading…
        </div>
    {:else if !hasContent}
        <div
            class="w-[816px] max-w-full min-h-[40vh] bg-white rounded-lg shadow-xl
                   flex items-center justify-center text-sm text-black/55"
        >
            This tab is empty at this point.
        </div>
    {:else}
        <div class="diff-toolbar w-full max-w-[1280px] flex flex-wrap items-center gap-3 px-1">
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
                {:else if !hasPrevious}
                    <span>No earlier version to compare</span>
                {:else}
                    <span>No text changes from the previous version</span>
                {/if}
            </div>

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
        </div>

        {#if diffLayout === "inline"}
            <div class="history-preview-stage">
                <div
                    class="version-preview w-[816px] max-w-full min-h-[40vh] bg-white rounded-lg
                           shadow-xl py-3 px-1 select-text"
                    data-diff-layout="inline"
                    aria-label="Selected version with inline changes"
                >
                    <ReadonlyEditorHost
                        serializedState={previewSerializedState}
                        stateFactory={createPreviewState}
                        onReady={handlePreviewReady}
                        onUpdate={handlePreviewUpdate}
                    />
                </div>

                {#if annotationProjection.annotations.length > 0}
                    <aside class="history-annotation-column" aria-label="Snapshot annotations">
                        {@render annotationCards()}
                    </aside>
                {/if}
            </div>
        {:else}
            <div class="history-preview-stage history-preview-stage-split">
                <div class="history-split-grid" data-diff-layout="side-by-side">
                    <section
                        class="history-diff-pane"
                        data-diff-pane="previous"
                        aria-labelledby="history-previous-version-heading"
                    >
                        <header class="history-diff-pane-header">
                            <h3 id="history-previous-version-heading">Previous version</h3>
                            <span>Removed text</span>
                        </header>
                        {#if hasPrevious}
                            <div class="history-diff-editor select-text">
                                <ReadonlyEditorHost
                                    serializedState={previousSerializedState}
                                    stateFactory={createPreviousPreviewState}
                                    onReady={handlePreviousPreviewReady}
                                />
                            </div>
                        {:else}
                            <div class="history-diff-empty">No earlier version to compare.</div>
                        {/if}
                    </section>

                    <section
                        class="history-diff-pane version-preview"
                        data-diff-pane="selected"
                        aria-labelledby="history-selected-version-heading"
                    >
                        <header class="history-diff-pane-header">
                            <h3 id="history-selected-version-heading">{selectedPaneLabel}</h3>
                            <span>Added text</span>
                        </header>
                        <div class="history-diff-editor select-text">
                            <ReadonlyEditorHost
                                serializedState={previewSerializedState}
                                stateFactory={createPreviewState}
                                onReady={handlePreviewReady}
                                onUpdate={handlePreviewUpdate}
                            />
                        </div>
                    </section>
                </div>

                {#if annotationProjection.annotations.length > 0}
                    <aside
                        class="history-annotation-column history-annotation-column-split"
                        aria-label="Snapshot annotations"
                    >
                        {@render annotationCards()}
                    </aside>
                {/if}
            </div>
        {/if}
    {/if}
</div>

<style>
    .history-preview-content {
        container-type: inline-size;
    }

    .history-preview-stage {
        display: flex;
        align-items: flex-start;
        justify-content: center;
        width: 100%;
        gap: 1.5rem;
    }

    .history-preview-stage-split {
        max-width: 1280px;
        flex-direction: column;
        align-items: stretch;
    }

    .history-split-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        width: 100%;
        gap: 1rem;
    }

    .history-diff-pane {
        min-width: 0;
        min-height: 40vh;
        overflow: hidden;
        border: 1px solid rgba(0, 0, 0, 0.08);
        border-radius: 0.75rem;
        background: white;
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.1);
    }

    .history-diff-pane-header {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 0.75rem;
        border-bottom: 1px solid rgba(0, 0, 0, 0.07);
        background: rgba(0, 0, 0, 0.018);
        padding: 0.65rem 0.9rem;
    }

    .history-diff-pane-header h3 {
        color: rgba(0, 0, 0, 0.72);
        font-size: 0.75rem;
        font-weight: 600;
    }

    .history-diff-pane-header span {
        color: rgba(0, 0, 0, 0.52);
        font-size: 0.6875rem;
    }

    .history-diff-editor {
        min-height: 40vh;
        padding: 0.75rem 0.25rem;
    }

    .history-diff-empty {
        display: flex;
        min-height: 40vh;
        align-items: center;
        justify-content: center;
        padding: 2rem;
        color: rgba(0, 0, 0, 0.55);
        font-size: 0.875rem;
        text-align: center;
    }

    .history-annotation-column {
        position: sticky;
        top: 1rem;
        display: grid;
        width: min(320px, 28vw);
        max-height: calc(100vh - 10rem);
        flex: 0 0 min(320px, 28vw);
        gap: 0.75rem;
        overflow-y: auto;
        padding: 0.2rem;
        scrollbar-width: thin;
    }

    .history-annotation-column-split {
        position: static;
        grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
        width: 100%;
        max-height: none;
        flex: none;
        overflow: visible;
    }

    :global(.version-preview .cm-editor.cm-focused),
    :global(.history-diff-pane .cm-editor.cm-focused) {
        outline: none;
    }

    :global(.version-preview .cm-editor),
    :global(.history-diff-pane .cm-editor) {
        z-index: 0 !important;
    }

    :global(.version-preview .cm-scroller),
    :global(.history-diff-pane .cm-scroller) {
        overflow: visible !important;
    }

    :global(.version-preview .cm-content),
    :global(.history-diff-pane .cm-content) {
        font-family: var(--doc-font-family);
        font-size: var(--doc-font-size);
        text-indent: 2em;
    }

    :global(.version-preview .cm-cursor),
    :global(.history-diff-pane .cm-cursor) {
        display: none !important;
    }

    /* Query the content pane after the structure sidebar has taken its width,
       rather than the viewport that also contains that sidebar. */
    @container (max-width: 1179px) {
        .history-preview-stage:not(.history-preview-stage-split) {
            flex-direction: column;
            align-items: center;
        }

        .history-annotation-column:not(.history-annotation-column-split) {
            position: static;
            width: min(816px, 100%);
            max-height: none;
            flex-basis: auto;
        }
    }

    @container (max-width: 779px) {
        .history-split-grid {
            grid-template-columns: minmax(0, 1fr);
        }
    }
</style>
