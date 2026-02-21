<script lang="ts">
    import { EditorState } from "@codemirror/state";
    import { EditorView, type ViewUpdate } from "@codemirror/view";
    import { ChevronDown, ChevronUp, Maximize2, PlusIcon, Trash2, X } from "lucide-svelte";
    import { onDestroy, tick } from "svelte";
    import { slide } from "svelte/transition";
    import { getExtensions, savedFields } from "$lib/editor/extensions";
    import {
        annotationField,
        createNewRevision,
        deleteRevisionVersion,
        setActiveRevisionVersion,
        updateRevisionVersionState,
        type Annotation,
        type Thread as ThreadType,
    } from ".";
    import { versionText, type VersionState } from "./models";
    import { getActiveAnnotation } from "./utils";
    import { revisionBoundaryNudge, revisionOpenNestedEditor, modalStack } from "$lib/stores";
    import Thread from "./Thread.svelte";

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
    const activeVersion = $derived(revision.versions[revision.currentlySelected]);
    const activeText = $derived(activeVersion ? versionText(activeVersion) : "");
    const VERSION_PREVIEW_MAX = 34;

    let isEditorOpen = $state(false);
    let userClosedEditor = false; // plain var — not reactive, just a gate

    $effect(() => {
        if (isActive) {
            if (!userClosedEditor) isEditorOpen = true;
        } else {
            isEditorOpen = false;
            userClosedEditor = false;
        }
    });

    function openEditor() {
        userClosedEditor = false;
        isEditorOpen = true;
    }
    let recursiveEditorHost = $state<HTMLDivElement>();
    let recursiveEditor = $state<EditorView | undefined>(undefined);
    let nestedEditorHasActiveAnnotation = $state(false);
    let isSyncingFromAnnotation = false;
    let previousVersionId = revision.currentlySelected;


    // Boundary nudge: show a hint when the user presses delete at the edge
    // of this revision's content in the main document.
    let showBoundaryHint = $state(false);
    let boundaryHintTimeout: ReturnType<typeof setTimeout> | undefined;

    $effect(() => {
        if ($revisionBoundaryNudge === revision.id) {
            showBoundaryHint = true;
            clearTimeout(boundaryHintTimeout);
            boundaryHintTimeout = setTimeout(() => {
                showBoundaryHint = false;
                revisionBoundaryNudge.set(null);
            }, 4000);
        }
    });

    // When the user triggers a nested annotation command from inside this revision
    // in the main document, open the modal (instead of the inline editor) and
    // pass the command along so the modal runs it once the editor is ready.
    $effect(() => {
        const cmd = $revisionOpenNestedEditor;
        if (!cmd || cmd.revisionId !== revision.id) return;
        revisionOpenNestedEditor.set(null);
        modalStack.push({
            type: "revision",
            revisionId: revision.id,
            parentView: view,
            label: activeVersion ? previewVersionText(activeVersion) : "Revision",
            pendingNestedCommand: {
                type: cmd.type,
                selectionFrom: cmd.selectionFrom,
                selectionTo: cmd.selectionTo,
            },
        });
    });

    onDestroy(() => {
        clearTimeout(boundaryHintTimeout);
    });

    function upsertVersionState(currentEditor: EditorView, versionId = revision.currentlySelected) {
        const blob = currentEditor.state.toJSON(savedFields) as VersionState;
        view.dispatch(
            updateRevisionVersionState(
                view.state,
                revision.id,
                versionId,
                blob,
            ),
        );
    }

    function previewVersionText(version: VersionState) {
        const flattened = versionText(version).replace(/\s+/g, " ").trim();
        if (!flattened) return "(empty)";
        return flattened.length > VERSION_PREVIEW_MAX
            ? `${flattened.slice(0, VERSION_PREVIEW_MAX)}…`
            : flattened;
    }

    function createRecursiveEditor(version: VersionState) {
        if (!recursiveEditorHost || recursiveEditor) return;
        const extensions = getExtensions({
            persist: false,
            updateListener(update: ViewUpdate) {
                if (!recursiveEditor || isSyncingFromAnnotation) return;
                nestedEditorHasActiveAnnotation = !!getActiveAnnotation(recursiveEditor.state);
                upsertVersionState(recursiveEditor);
            },
        });
        // Restore full state (doc + annotations + history) if available,
        // otherwise create a fresh editor with just the text.
        const state = "annotationField" in version
            ? EditorState.fromJSON(version, { extensions }, savedFields)
            : EditorState.create({ doc: versionText(version), extensions });
        recursiveEditor = new EditorView({ state, parent: recursiveEditorHost });
        nestedEditorHasActiveAnnotation = !!getActiveAnnotation(recursiveEditor.state);
    }

    function destroyRecursiveEditor() {
        recursiveEditor?.destroy();
        recursiveEditor = undefined;
        nestedEditorHasActiveAnnotation = false;
    }

    function syncRecursiveEditorToActiveVersion(previousVersionId?: number) {
        if (!recursiveEditor || !activeVersion) return;
        const currentText = recursiveEditor.state.doc.toString();
        const targetText = activeText;
        if (currentText === targetText) return;
        // Save the current editor state back to whichever version we're leaving
        if (previousVersionId !== undefined) {
            upsertVersionState(recursiveEditor, previousVersionId);
        }
        isSyncingFromAnnotation = true;
        const extensions = getExtensions({
            persist: false,
            updateListener(update: ViewUpdate) {
                if (!recursiveEditor || isSyncingFromAnnotation) return;
                upsertVersionState(recursiveEditor);
            },
        });
        const nextState = "annotationField" in activeVersion
            ? EditorState.fromJSON(activeVersion, { extensions }, savedFields)
            : EditorState.create({ doc: targetText, extensions });
        recursiveEditor.setState(nextState);
        isSyncingFromAnnotation = false;
        nestedEditorHasActiveAnnotation = !!getActiveAnnotation(recursiveEditor.state);
    }

    $effect(() => {
        if (!isEditorOpen) {
            destroyRecursiveEditor();
            return;
        }
        tick().then(() => {
            if (!isEditorOpen || !activeVersion) return;
            createRecursiveEditor(activeVersion);
            syncRecursiveEditorToActiveVersion();
        });
    });

    $effect(() => {
        if (!recursiveEditor || !isEditorOpen) return;
        const prev = previousVersionId;
        previousVersionId = revision.currentlySelected;
        syncRecursiveEditorToActiveVersion(prev !== revision.currentlySelected ? prev : undefined);
    });

    onDestroy(() => {
        destroyRecursiveEditor();
    });
</script>

<div
    data-tutorial-role="revision-card"
    data-revision-id={revision.id}
    class="border rounded-[14px] transition-all duration-200
        {isActive
            ? 'bg-purple-50/90 border-purple-200/60 shadow-xl'
            : 'bg-purple-50/60 border-purple-200/40 shadow-lg opacity-90 hover:opacity-100'}"
    style="backdrop-filter: blur(12px); clip-path: inset(0 round 14px);"
>
    <!-- Header -->
    <div class="flex items-center justify-between px-3 pt-3 pb-2">
        <h3 class="text-[10px] font-semibold text-purple-600/70 uppercase tracking-wider">Revision</h3>
        <button
            class="p-1 rounded-md text-purple-400/50 hover:text-red-500/60 hover:bg-white/40 transition-colors"
            onclick={() => remove()}
            title="Delete entire revision"
        >
            <Trash2 size={16} />
        </button>
    </div>

    <!-- Version pills -->
    <div class="px-3 pb-2 flex flex-wrap gap-1">
        {#each revision.versions as version, i}
            {@const versionActive = i === revision.currentlySelected}
            <div class="inline-flex items-center rounded-md overflow-hidden
                {versionActive
                    ? 'bg-purple-500/80 ring-1 ring-purple-400/40'
                    : 'bg-white/60 ring-1 ring-purple-200/40'}">
                <button
                    class="max-w-[120px] px-2 py-1 text-[11px] font-medium truncate transition-colors
                        {versionActive ? 'text-white' : 'text-black/65 hover:text-black/85'}"
                    disabled={versionActive}
                    title={versionText(version) || "(empty)"}
                    onclick={() => {
                        view.dispatch(
                            setActiveRevisionVersion(view.state, revision.id, i),
                        );
                    }}
                >
                    {version.label ?? previewVersionText(version)}
                </button>
                <button
                    class="pr-1.5 pl-0.5 py-1 transition-colors
                        {versionActive ? 'text-white/60 hover:text-white' : 'text-black/30 hover:text-red-500/70'}"
                    onclick={() => {
                        view.dispatch(
                            deleteRevisionVersion(view.state, revision.id, i),
                        );
                    }}
                    title={`Delete version ${i + 1}`}
                >
                    <X size={9} />
                </button>
            </div>
        {/each}
    </div>

    <!-- Actions row -->
    <div class="px-3 pb-3 flex gap-1.5">
        <button
            class="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-purple-600/80
                bg-white/50 hover:bg-white/70 rounded-md ring-1 ring-purple-200/40 transition-colors"
            onclick={() => {
                view.dispatch(createNewRevision(view.state, revision.id));
                view.focus();
            }}
            title="Create a new version"
        >
            <PlusIcon size={10} />
            <span>New version</span>
        </button>
        <button
            data-tutorial-action="toggle-nested-editor"
            data-revision-id={revision.id}
            class="flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md ring-1 transition-colors
                {isEditorOpen
                    ? 'text-purple-600/80 bg-purple-100/40 ring-purple-300/40 hover:bg-purple-100/60'
                    : 'text-purple-600/60 bg-white/50 ring-purple-200/40 hover:bg-white/70'}"
            onclick={() => {
                userClosedEditor = isEditorOpen;
                isEditorOpen = !isEditorOpen;
            }}
            title={isEditorOpen ? "Hide nested editor" : "Open nested editor"}
        >
            {#if isEditorOpen}
                <ChevronUp size={10} />
            {:else}
                <ChevronDown size={10} />
            {/if}
            <span>Nested editor</span>
        </button>
        <button
            data-tutorial-action="expand-revision-modal"
            data-revision-id={revision.id}
            class="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-purple-600/60
                bg-white/50 hover:bg-white/70 rounded-md ring-1 ring-purple-200/40 transition-colors ml-auto"
            onclick={() => { modalStack.push({ type: "revision", revisionId: revision.id, parentView: view, label: activeVersion ? previewVersionText(activeVersion) : "Revision" }); }}
            title="Expand editor"
        >
            <Maximize2 size={10} />
        </button>
    </div>

    <!-- Boundary hint -->
    {#if showBoundaryHint}
        <div class="mx-3 mb-3 flex items-start gap-1.5 px-2 py-1.5 rounded-md
            bg-purple-50/70 ring-1 ring-purple-200/50 text-[10px] text-purple-600/80 leading-snug">
            <span class="shrink-0 mt-px">↓</span>
            <span>Use the nested editor to edit at revision boundaries.</span>
        </div>
    {/if}

    <!-- Nested editor (collapsible) -->
    {#if isEditorOpen}
        <div transition:slide={{ duration: 200 }} class="mx-3 mb-3 rounded-lg overflow-hidden ring-1 ring-white/40 bg-white/60">
            <div
                bind:this={recursiveEditorHost}
                class="revision-recursive-editor h-[220px] overflow-hidden"
            ></div>
            {#if nestedEditorHasActiveAnnotation}
                <div transition:slide={{ duration: 150 }}
                    class="border-t border-purple-100/60 px-3 py-2 flex items-center justify-between gap-2">
                    <span class="text-[10px] text-purple-500/70">Annotation selected</span>
                    <button
                        class="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-purple-600/80
                            bg-purple-50 hover:bg-purple-100/60 rounded-md ring-1 ring-purple-200/50 transition-colors"
                        onclick={() => modalStack.push({ type: "revision", revisionId: revision.id, parentView: view, label: activeVersion ? previewVersionText(activeVersion) : "Revision" })}
                    >
                        <Maximize2 size={9} />
                        <span>View in modal</span>
                    </button>
                </div>
            {/if}
        </div>
    {/if}

    <!-- Thread -->
    {#if thread.length > 0 || isActive}
        <div class="border-t border-black/[0.07] px-3 py-2.5">
            <Thread {thread} {updateThread} />
        </div>
    {/if}
</div>


<style>
    .revision-recursive-editor :global(.cm-editor) {
        height: 220px;
        width: 100%;
        background: transparent;
    }

    .revision-recursive-editor :global(.cm-scroller) {
        overflow: auto;
        line-height: 1.6;
    }

    .revision-recursive-editor :global(.cm-content) {
        text-indent: 0;
        min-height: 100%;
        padding: 8px 10px 12px 10px;
        font-size: 13px;
    }

    .revision-recursive-editor :global(.cm-focused) {
        outline: none;
    }

</style>
