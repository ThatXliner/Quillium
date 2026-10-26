<script lang="ts">
/** ReadonlyEditorHost.svelte — Lifecycle-safe host for a real read-only CodeMirror state. */
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, type ViewUpdate } from "@codemirror/view";
import { untrack } from "svelte";
import "./core/annotations.css";
import {
    type PersonaColor,
    annotationField,
    getActiveAnnotation,
    getReadonlyExtensions,
    isAnnotationOfType,
    readonlySavedFields,
    setActiveRevisionVersion,
} from "./core";

type RevisionSelection = {
    annotationId: number;
    versionIndex: number;
};

let {
    serializedState,
    personaColors = [],
    atomicRevisions = true,
    revisionSelections = [],
    class: className = "",
    stateFactory,
    onReady,
    onUpdate,
    onActiveAnnotationChange,
}: {
    serializedState: Record<string, unknown>;
    personaColors?: PersonaColor[];
    atomicRevisions?: boolean;
    revisionSelections?: readonly RevisionSelection[];
    class?: string;
    stateFactory?: (
        serializedState: Record<string, unknown>,
        updateListener: Extension,
    ) => EditorState;
    onReady?: (view: EditorView | null) => void;
    onUpdate?: (update: ViewUpdate) => void;
    onActiveAnnotationChange?: (annotationId: number | null) => void;
} = $props();

let host = $state<HTMLDivElement>();
let view = $state<EditorView | null>(null);
let mountError = $state<string | null>(null);
let applyingRevisionSelections = false;

function notifyActive(nextView: EditorView): void {
    const active = getActiveAnnotation(nextView.state);
    onActiveAnnotationChange?.(active?.id ?? null);
}

$effect(() => {
    if (!host) return;
    const json = {
        selection: { ranges: [{ anchor: 0, head: 0 }], main: 0 },
        ...serializedState,
    };
    mountError = null;

    try {
        const updateListener = EditorView.updateListener.of((update) => {
            if (update.selectionSet && !applyingRevisionSelections) notifyActive(update.view);
            onUpdate?.(update);
        });
        const state = stateFactory
            ? untrack(() => stateFactory(json, updateListener))
            : EditorState.fromJSON(
                  json,
                  {
                      extensions: [
                          getReadonlyExtensions({ atomicRevisions, personaColors }),
                          updateListener,
                      ],
                  },
                  readonlySavedFields,
              );
        const mountedView = new EditorView({ state, parent: host });
        view = mountedView;
        untrack(() => {
            onReady?.(mountedView);
        });

        return () => {
            mountedView.destroy();
            if (view === mountedView) view = null;
            untrack(() => onReady?.(null));
        };
    } catch (error) {
        mountError = error instanceof Error ? error.message : String(error);
        view = null;
        untrack(() => onReady?.(null));
    }
});

$effect(() => {
    const currentView = view;
    const selections = revisionSelections;
    if (!currentView) return;

    for (const { annotationId, versionIndex: requestedIndex } of selections) {
        const annotation = currentView.state.field(annotationField, false)?.[annotationId];
        if (!annotation || !isAnnotationOfType(annotation, "revision")) continue;
        const target = annotation.versions[requestedIndex];
        if (!target || annotation.activeVersionId === target.id) continue;
        applyingRevisionSelections = true;
        try {
            currentView.dispatch(
                setActiveRevisionVersion(currentView.state, annotationId, target.id, {
                    moveCursor: false,
                }),
            );
        } finally {
            applyingRevisionSelections = false;
        }
    }
});
</script>

<div class="readonly-editor-host {className}" data-readonly-editor-host bind:this={host}></div>
{#if mountError}
    <p class="mount-error" data-readonly-editor-error title={mountError}>
        This document couldn't be rendered.
    </p>
{/if}

<style>
    .readonly-editor-host {
        width: 100%;
        height: 100%;
    }

    .readonly-editor-host :global(.cm-editor) {
        width: 100%;
        height: 100%;
        background: transparent;
    }

    .readonly-editor-host :global(.cm-editor.cm-focused) {
        outline: none;
    }

    .readonly-editor-host :global(.cm-scroller) {
        height: 100%;
        font-family: inherit;
        line-height: inherit;
    }

    .readonly-editor-host :global(.cm-gutters) {
        display: none;
    }

    .mount-error {
        margin: 0.75rem;
        color: var(--text-soft, rgba(0, 0, 0, 0.55));
        font-size: 0.9rem;
    }
</style>
