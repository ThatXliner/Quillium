<script lang="ts">
    import { EditorState } from "@codemirror/state";
    import { EditorView, type ViewUpdate } from "@codemirror/view";
    import { X } from "lucide-svelte";
    import { onDestroy, tick } from "svelte";
    import { getExtensions, savedFields } from "$lib/editor/extensions";
    import {
        annotationField,
        setActiveRevisionVersion,
        updateRevisionVersionState,
        type Annotation,
        type Annotations as AnnotationsMap,
        type GenericAnnotation,
    } from ".";
    import { versionText, type VersionState } from "./models";
    import { getActiveAnnotation } from "./utils";
    import { modalStack } from "$lib/stores";
    import Annotations from "./Annotations.svelte";

    const { revisionId, view }: { revisionId: number; view: EditorView } = $props();

    const revision = $derived(
        view.state.field(annotationField)[revisionId] as Annotation<"revision"> | undefined,
    );
    const VERSION_PREVIEW_MAX = 34;

    function previewVersionText(version: VersionState) {
        const flattened = versionText(version).replace(/\s+/g, " ").trim();
        if (!flattened) return "(empty)";
        return flattened.length > VERSION_PREVIEW_MAX
            ? `${flattened.slice(0, VERSION_PREVIEW_MAX)}…`
            : flattened;
    }

    let editorHost = $state<HTMLDivElement>();
    let editor = $state<EditorView | undefined>(undefined);
    let dialogEl = $state<HTMLDialogElement>();

    let modalAnnotations = $state<AnnotationsMap | undefined>(undefined);
    let modalActiveAnnotation = $state<GenericAnnotation | undefined>(undefined);

    function createEditor(version: VersionState) {
        if (!editorHost || editor) return;
        const extensions = getExtensions({
            persist: false,
            updateListener(_update: ViewUpdate) {
                if (!editor) return;
                const blob = editor.state.toJSON(savedFields) as VersionState;
                const rev = view.state.field(annotationField)[revisionId] as Annotation<"revision"> | undefined;
                if (!rev) return;
                view.dispatch(
                    updateRevisionVersionState(view.state, revisionId, rev.currentlySelected, blob),
                );
                modalAnnotations = editor.state.field(annotationField);
                modalActiveAnnotation = getActiveAnnotation(editor.state);
            },
        });
        const state = "annotationField" in version
            ? EditorState.fromJSON(version, { extensions }, savedFields)
            : EditorState.create({ doc: versionText(version), extensions });
        editor = new EditorView({ state, parent: editorHost });
        modalAnnotations = editor.state.field(annotationField);
        modalActiveAnnotation = getActiveAnnotation(editor.state);
    }

    function destroyEditor() {
        editor?.destroy();
        editor = undefined;
        modalAnnotations = undefined;
        modalActiveAnnotation = undefined;
    }

    function close() {
        modalStack.pop();
    }

    $effect(() => {
        if (!dialogEl) return;
        if (!dialogEl.open) dialogEl.showModal();
        tick().then(() => {
            const rev = view.state.field(annotationField)[revisionId] as Annotation<"revision"> | undefined;
            if (rev && !editor) createEditor(rev.versions[rev.currentlySelected]);
        });
    });

    onDestroy(() => {
        destroyEditor();
    });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
<dialog
    bind:this={dialogEl}
    class="revision-modal"
    onclick={(e) => { if (e.target === dialogEl) close(); }}
>
    <div class="revision-modal-inner">
        <!-- Header -->
        <div class="flex items-center justify-between px-5 py-3 border-b border-purple-100/80 shrink-0">
            <div class="flex items-center gap-3">
                <span class="text-[10px] font-semibold text-purple-600/70 uppercase tracking-wider">Revision</span>
                <div class="flex flex-wrap gap-1">
                    {#if revision}
                        {#each revision.versions as version, i}
                            {@const versionActive = i === revision.currentlySelected}
                            <button
                                class="px-2 py-0.5 text-[11px] font-medium rounded-md transition-colors
                                    {versionActive
                                        ? 'bg-purple-500/80 text-white ring-1 ring-purple-400/40'
                                        : 'bg-black/5 text-black/55 ring-1 ring-purple-200/30 hover:text-black/80'}"
                                disabled={versionActive}
                                onclick={() => {
                                    view.dispatch(setActiveRevisionVersion(view.state, revisionId, i));
                                    destroyEditor();
                                    tick().then(() => {
                                        const v = view.state.field(annotationField)[revisionId] as Annotation<"revision"> | undefined;
                                        if (v) createEditor(v.versions[v.currentlySelected]);
                                    });
                                }}
                            >
                                {version.label ?? previewVersionText(version)}
                            </button>
                        {/each}
                    {/if}
                </div>
            </div>
            <button
                class="p-1 rounded-md text-black/30 hover:text-black/60 hover:bg-black/5 transition-colors"
                onclick={close}
            >
                <X size={16} />
            </button>
        </div>

        <!-- Body: editor + annotations panel -->
        <div class="flex flex-1 overflow-hidden">
            <!-- Editor -->
            <div bind:this={editorHost} class="revision-modal-editor flex-1 overflow-hidden"></div>

            <!-- Annotations sidebar -->
            {#if editor && modalAnnotations && Object.keys(modalAnnotations).length > 0}
                <div class="w-64 shrink-0 border-l border-purple-100/60 overflow-y-auto bg-purple-50/20 px-2 py-3">
                    <div class="text-[9px] font-medium text-black/35 uppercase tracking-wider mb-2 px-1">
                        Annotations
                    </div>
                    <Annotations
                        view={editor}
                        annotationsData={modalAnnotations}
                        activeAnnotationData={modalActiveAnnotation}
                        layout="inline"
                    />
                </div>
            {/if}
        </div>
    </div>
</dialog>

<style>
    .revision-modal {
        border: none;
        padding: 0;
        background: transparent;
        width: 100vw;
        height: 100vh;
        max-width: 100vw;
        max-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .revision-modal::backdrop {
        background: rgba(0, 0, 0, 0.3);
        backdrop-filter: blur(4px);
    }

    .revision-modal-inner {
        display: flex;
        flex-direction: column;
        width: 900px;
        height: 72vh;
        background: white;
        border-radius: 1rem;
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
        overflow: hidden;
    }

    .revision-modal-editor :global(.cm-editor) {
        height: 100%;
        width: 100%;
        background: transparent;
    }

    .revision-modal-editor :global(.cm-scroller) {
        overflow: auto;
        line-height: 1.7;
        height: 100%;
    }

    .revision-modal-editor :global(.cm-content) {
        text-indent: 0;
        min-height: 100%;
        padding: 20px 32px 32px 32px;
        font-size: 15px;
    }

    .revision-modal-editor :global(.cm-focused) {
        outline: none;
    }
</style>
