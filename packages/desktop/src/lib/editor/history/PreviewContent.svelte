<!--
    PreviewContent.svelte — The content half of the history preview.

    Renders the viewed tab's document content at the selected coordinate inside a
    REAL read-only CodeMirror editor (same extensions/theme/font/width as the
    actual editor and locked-draft view), with track-changes decorations on top:
    additions highlighted green, deletions injected as red strikethrough widgets
    (vs. the same draft's immediately-previous version). Building it from the
    editor's own pipeline is what makes the preview look identical to editing.

    Props:
      currentStateJson — serialized EditorState of the version to show, or null
      previousText     — plain text of the previous version (diff baseline)
      loading          — true while content is being fetched
      hasContent       — false when the viewed tab has no content at this point
      bannerText       — optional note shown above the content (structural coord)
-->
<script lang="ts">
import { getExtensions, savedFields } from "$lib/editor/extensions";
import { Compartment, EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
    ReadonlyAnnotationCard,
    annotationField,
    getActiveAnnotation,
    isAnnotationOfType,
    serializeFromState,
    setActiveRevisionVersion,
} from "@quillium/share";
import { docTextFromStateJson } from "./diff";
import { diffDecorations, diffTheme } from "./diffDecorations";

const {
    currentStateJson,
    previousText,
    loading,
    hasContent,
    bannerText = null,
}: {
    currentStateJson: string | null;
    previousText: string;
    loading: boolean;
    hasContent: boolean;
    bannerText?: string | null;
} = $props();

let previewEl = $state<HTMLDivElement | undefined>();
let previewView: EditorView | undefined;
let diffCompartment: Compartment | undefined;
let previewRevision = $state(0);
let activeAnnotationId = $state<string | null>(null);

const currentPreviewText = $derived.by(() => {
    void previewRevision;
    return previewView?.state.doc.toString() ?? docTextFromStateJson(currentStateJson);
});
const hasChanges = $derived(hasContent && currentPreviewText !== previousText);
const annotationProjection = $derived.by(() => {
    void previewRevision;
    return previewView ? serializeFromState(previewView.state) : { content: "", annotations: [] };
});

function selectAnnotation(annotationId: string) {
    const annotation = annotationProjection.annotations.find((item) => item.id === annotationId);
    if (!previewView || !annotation) return;

    activeAnnotationId = annotationId;
    previewView.dispatch({
        selection: EditorSelection.cursor(annotation.from),
        scrollIntoView: true,
    });
}

function switchRevisionVersion(annotationId: string, versionIndex: number) {
    if (!previewView || annotationId.includes(".v")) return;

    const revisionId = Number(annotationId);
    if (!Number.isInteger(revisionId)) return;
    const annotation = previewView.state.field(annotationField, false)?.[revisionId];
    if (!annotation || !isAnnotationOfType(annotation, "revision")) return;

    const version = annotation.versions[versionIndex];
    if (!version) return;
    previewView.dispatch(
        setActiveRevisionVersion(previewView.state, revisionId, version.id, { moveCursor: true }),
    );
    if (diffCompartment) {
        previewView.dispatch({
            effects: diffCompartment.reconfigure(
                diffDecorations(previousText, previewView.state.doc.toString()),
            ),
        });
    }
}

// Mount/remount a read-only editor from the current version's state, with the
// track-changes overlay. Re-runs when the element binds or the inputs change.
$effect(() => {
    if (!previewEl || loading || !hasContent) return;

    const current = docTextFromStateJson(currentStateJson);
    const mountedDiffCompartment = new Compartment();
    const extensions = [
        // Same stack the editor and locked-draft / library previews use, so the
        // typography and layout match exactly.
        ...getExtensions({ persist: false, history: false }),
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        EditorView.updateListener.of((update) => {
            if (!update.selectionSet && !update.docChanged) return;
            activeAnnotationId = String(getActiveAnnotation(update.state)?.id ?? "") || null;
            previewRevision = performance.now();
        }),
        diffTheme,
        mountedDiffCompartment.of(diffDecorations(previousText, current)),
    ];

    let state: EditorState;
    const json = currentStateJson;
    if (json && json !== "{}") {
        try {
            state = EditorState.fromJSON(JSON.parse(json), { extensions }, savedFields);
        } catch {
            state = EditorState.create({ extensions });
        }
    } else {
        state = EditorState.create({ extensions });
    }

    const mountedView = new EditorView({ state, parent: previewEl });
    previewView = mountedView;
    diffCompartment = mountedDiffCompartment;
    activeAnnotationId = String(getActiveAnnotation(state)?.id ?? "") || null;
    // Avoid reading and writing the same rune inside this effect (`+=` would
    // subscribe the effect to itself and trigger Svelte's update-depth guard).
    previewRevision = performance.now();

    return () => {
        mountedView.destroy();
        if (previewView === mountedView) {
            previewView = undefined;
            diffCompartment = undefined;
        }
    };
});
</script>

<div class="history-preview-content w-full flex flex-col items-center gap-3">
    {#if bannerText}
        <div
            class="w-[816px] max-w-full rounded-lg border border-black/[0.08] bg-blue-50/60
                   px-4 py-2 text-xs text-black/60"
        >
            {bannerText}
        </div>
    {/if}

    {#if loading}
        <div class="flex items-center justify-center w-full py-20 text-black/30 text-sm">
            Loading…
        </div>
    {:else if !hasContent}
        <div
            class="w-[816px] max-w-full min-h-[40vh] bg-white rounded-lg shadow-xl
                   flex items-center justify-center text-sm text-black/35"
        >
            This tab has no content at this point.
        </div>
    {:else}
        {#if hasChanges}
            <div class="w-[816px] max-w-full flex items-center gap-4 text-[11px] text-black/45 px-1">
                <span class="flex items-center gap-1.5">
                    <span class="inline-block w-3 h-3 rounded-sm bg-green-200 border border-green-300"></span>
                    Added
                </span>
                <span class="flex items-center gap-1.5">
                    <span class="inline-block w-3 h-3 rounded-sm bg-red-200 border border-red-300"></span>
                    Removed
                </span>
                <span class="text-black/30">vs. previous version</span>
            </div>
        {/if}

        <div class="history-preview-stage">
            <div
                class="version-preview w-[816px] max-w-full min-h-[40vh] bg-white rounded-lg shadow-xl
                       py-3 px-1 select-text"
                bind:this={previewEl}
            ></div>

            {#if annotationProjection.annotations.length > 0}
                <aside class="history-annotation-column" aria-label="Snapshot annotations">
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
                </aside>
            {/if}
        </div>
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

    :global(.version-preview .cm-editor.cm-focused) {
        outline: none;
    }

    :global(.version-preview .cm-editor) {
        z-index: 0 !important;
    }

    :global(.version-preview .cm-scroller) {
        overflow: visible !important;
    }

    :global(.version-preview .cm-content) {
        font-family: var(--doc-font-family);
        font-size: var(--doc-font-size);
        text-indent: 2em;
    }

    :global(.version-preview .cm-cursor) {
        display: none !important;
    }

    /* Query the content pane after the structure sidebar has taken its width,
       rather than the viewport that also contains that sidebar. */
    @container (max-width: 1179px) {
        .history-preview-stage {
            flex-direction: column;
            align-items: center;
        }

        .history-annotation-column {
            position: static;
            width: min(816px, 100%);
            max-height: none;
            flex-basis: auto;
        }
    }
</style>
