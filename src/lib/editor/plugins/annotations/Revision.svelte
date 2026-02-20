<script lang="ts">
    import { EditorState } from "@codemirror/state";
    import { EditorView, type ViewUpdate } from "@codemirror/view";
    import { ChevronDown, ChevronUp, PlusIcon, Trash2, X } from "lucide-svelte";
    import { onDestroy, tick } from "svelte";
    import { getExtensions } from "$lib/editor/extensions";
    import {
        annotationField,
        createNewRevision,
        deleteRevisionVersion,
        setActiveRevisionVersion,
        type Annotation,
        type Annotations as AnnotationsMap,
        type GenericAnnotation,
        type Thread as ThreadType,
        updateRevisionVersionText,
    } from ".";
    import { getActiveAnnotation } from "./utils";
    import Thread from "./Thread.svelte";
    import Annotations from "./Annotations.svelte";

    const {
        revision,
        isActive,
        view,
        remove,
        updateThread,
    }: {
        revision: Annotation<"revision">;
        isActive: boolean;
        view: EditorView;
        remove: () => void;
        updateThread: (thread: ThreadType) => void;
    } = $props();

    const thread = $derived(revision.thread);
    const activeText = $derived(
        revision.versions[revision.currentlySelected] ?? "",
    );
    const VERSION_PREVIEW_MAX = 34;

    let isEditorOpen = $state(false);
    let recursiveEditorHost = $state<HTMLDivElement>();
    let recursiveEditor = $state<EditorView | undefined>(undefined);
    let recursiveAnnotations = $state<AnnotationsMap | undefined>(undefined);
    let recursiveActiveAnnotation = $state<GenericAnnotation | undefined>(undefined);
    let isSyncingFromAnnotation = false;

    $effect(() => {
        if (isActive) {
            isEditorOpen = true;
        }
    });

    function updateRecursiveMeta(currentView: EditorView) {
        recursiveAnnotations = currentView.state.field(annotationField);
        recursiveActiveAnnotation = getActiveAnnotation(currentView.state);
    }

    function upsertVersionText(text: string) {
        if (text === activeText) return;
        view.dispatch(
            updateRevisionVersionText(
                view.state,
                revision.id,
                revision.currentlySelected,
                text,
            ),
        );
    }

    function previewVersionText(text: string) {
        const flattened = text.replace(/\s+/g, " ").trim();
        if (!flattened) return "(empty)";
        return flattened.length > VERSION_PREVIEW_MAX
            ? `${flattened.slice(0, VERSION_PREVIEW_MAX)}…`
            : flattened;
    }

    function createRecursiveEditor(initialText: string) {
        if (!recursiveEditorHost || recursiveEditor) return;
        recursiveEditor = new EditorView({
            state: EditorState.create({
                doc: initialText,
                extensions: getExtensions({
                    persist: false,
                    updateListener(update: ViewUpdate) {
                        if (!recursiveEditor) return;
                        updateRecursiveMeta(recursiveEditor);
                        if (!update.docChanged || isSyncingFromAnnotation) {
                            return;
                        }
                        upsertVersionText(update.state.doc.toString());
                    },
                }),
            }),
            parent: recursiveEditorHost,
        });
        updateRecursiveMeta(recursiveEditor);
    }

    function destroyRecursiveEditor() {
        recursiveEditor?.destroy();
        recursiveEditor = undefined;
        recursiveAnnotations = undefined;
        recursiveActiveAnnotation = undefined;
    }

    function syncRecursiveEditorToActiveVersion() {
        if (!recursiveEditor) return;
        const next = activeText;
        const current = recursiveEditor.state.doc.toString();
        if (current === next) return;
        isSyncingFromAnnotation = true;
        recursiveEditor.dispatch({
            changes: {
                from: 0,
                to: recursiveEditor.state.doc.length,
                insert: next,
            },
        });
        isSyncingFromAnnotation = false;
        updateRecursiveMeta(recursiveEditor);
    }

    $effect(() => {
        if (!isEditorOpen) {
            destroyRecursiveEditor();
            return;
        }
        tick().then(() => {
            if (!isEditorOpen) return;
            createRecursiveEditor(activeText);
            syncRecursiveEditorToActiveVersion();
        });
    });

    $effect(() => {
        if (!recursiveEditor || !isEditorOpen) return;
        syncRecursiveEditorToActiveVersion();
    });

    onDestroy(() => {
        destroyRecursiveEditor();
    });
</script>

<div
    class="backdrop-blur-md border overflow-hidden transition-all duration-200
        {isActive
            ? 'bg-gray-200/80 border-white/50 shadow-xl rounded-[14px]'
            : 'bg-gray-300/70 border-white/30 shadow-lg rounded-[12px] opacity-90 hover:opacity-100'}"
>
    <div class="p-3 space-y-3">
        <div class="flex items-center justify-between gap-2">
            <h3 class="text-xs font-semibold text-black/60 uppercase tracking-wider">Revisions</h3>
            <button
                class="p-1.5 rounded-lg border border-white/30 bg-white/35 hover:bg-white/55 transition-colors text-black/60"
                onclick={() => {
                    isEditorOpen = !isEditorOpen;
                }}
                title={isEditorOpen ? "Collapse recursive editor" : "Expand recursive editor"}
            >
                {#if isEditorOpen}
                    <ChevronUp size={13} />
                {:else}
                    <ChevronDown size={13} />
                {/if}
            </button>
        </div>

        <div class="flex flex-wrap gap-1.5">
            {#each revision.versions as versionText, i}
                {@const versionActive = i === revision.currentlySelected}
                <div class="inline-flex items-center rounded-lg border border-white/30 bg-white/40 overflow-hidden">
                    <button
                        class="max-w-36 px-2 py-1.5 text-xs font-medium truncate transition-colors
                            {versionActive
                                ? 'bg-purple-500/80 text-white'
                                : 'text-black/70 hover:bg-white/70'}"
                        disabled={versionActive}
                        title={versionText || "(empty)"}
                        onclick={() => {
                            view.dispatch(
                                setActiveRevisionVersion(
                                    view.state,
                                    revision.id,
                                    i,
                                ),
                            );
                        }}
                    >
                        {previewVersionText(versionText)}
                    </button>
                    <button
                        class="px-1.5 py-1.5 text-black/40 hover:text-red-500/80 hover:bg-white/70 transition-colors"
                        onclick={() => {
                            view.dispatch(
                                deleteRevisionVersion(
                                    view.state,
                                    revision.id,
                                    i,
                                ),
                            );
                        }}
                        title={`Delete version ${i + 1}`}
                    >
                        <X size={10} />
                    </button>
                </div>
            {/each}
        </div>

        <p class="text-[11px] text-black/55 leading-relaxed">
            Revisions are atomic in the parent document. This nested editor is fully featured and live-synced.
        </p>

        <div class="flex gap-2">
            <button
                class="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium text-purple-700/80 bg-white/35 hover:bg-white/55 rounded-lg border border-white/30 transition-colors"
                onclick={() => {
                    view.dispatch(
                        createNewRevision(view.state, revision.id),
                    );
                }}
                title="Create a new version"
            >
                <PlusIcon size={11} />
                <span>New Version</span>
            </button>
            <button
                class="px-2.5 py-1.5 rounded-lg text-black/35 hover:text-red-500/70 hover:bg-white/40 border border-white/25 transition-colors"
                onclick={() => remove()}
                title="Delete entire revision"
            >
                <Trash2 size={13} />
            </button>
        </div>

        {#if isEditorOpen}
            <div class="rounded-xl border border-white/35 bg-white/55 p-2 space-y-2">
                <div
                    bind:this={recursiveEditorHost}
                    class="revision-recursive-editor h-[260px] rounded-lg border border-white/45 bg-white/85 shadow-inner overflow-hidden"
                ></div>
                <div class="text-[10px] text-black/45 px-1">
                    Nested annotations for this revision buffer:
                </div>
                {#if recursiveEditor && recursiveAnnotations}
                    <div class="max-h-56 overflow-y-auto overscroll-contain pr-1">
                        <Annotations
                            view={recursiveEditor}
                            annotationsData={recursiveAnnotations}
                            activeAnnotationData={recursiveActiveAnnotation}
                            layout="inline"
                        />
                    </div>
                {/if}
            </div>
        {/if}
    </div>

    <div class="w-full h-px bg-black/10"></div>

    <div class="p-3">
        <Thread {thread} {updateThread} />
    </div>
</div>

<style>
    .revision-recursive-editor :global(.cm-editor) {
        position: relative !important;
        height: 100%;
        width: 100%;
        background: transparent;
    }

    .revision-recursive-editor :global(.cm-scroller) {
        overflow: auto;
        font-size: 15px;
        line-height: 1.55;
    }

    .revision-recursive-editor :global(.cm-content) {
        text-indent: 0;
        min-height: 100%;
        padding: 10px 12px 16px 12px;
    }

    .revision-recursive-editor :global(.cm-focused) {
        outline: none;
    }
</style>
