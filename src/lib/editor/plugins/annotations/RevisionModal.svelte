<script lang="ts">
    import { EditorState } from "@codemirror/state";
    import { EditorView, type ViewUpdate } from "@codemirror/view";
    import { ChevronRight, ChevronDown, Check, X } from "lucide-svelte";
    import { onDestroy, tick } from "svelte";
    import { scale } from "svelte/transition";
    import { getExtensions, savedFields } from "$lib/editor/extensions";
    import {
        addAnnotation,
        annotationField,
        setActiveRevisionVersion,
        updateRevisionVersionState,
        updateThread,
        type Annotation,
        type Annotations as AnnotationsMap,
        type GenericAnnotation,
        type Thread as ThreadType,
    } from ".";

    import { canCreateNewComment, getActiveAnnotation } from "./utils";
    import { createNewAnnotation, versionText, type VersionState } from "./models";
    import { EditorSelection, Transaction } from "@codemirror/state";
    import { modalStack, type ModalEntry } from "$lib/stores";
    import Annotations from "./Annotations.svelte";
    import Thread from "./Thread.svelte";

    const { revisionId, view, stackIndex }: { revisionId: number; view: EditorView; stackIndex: number } = $props();

    const crumbs = $derived($modalStack.slice(0, stackIndex + 1));

    // Track selected version index per crumb level reactively
    let crumbSelectedVersions = $state<number[]>([]);
    // Which crumb dropdown is open (-1 = none)
    let openDropdown = $state(-1);

    $effect(() => {
        crumbSelectedVersions = crumbs.map((crumb) => {
            if (crumb.type !== "revision") return 0;
            const rev = crumb.parentView.state.field(annotationField)[crumb.revisionId] as Annotation<"revision"> | undefined;
            return rev?.currentlySelected ?? 0;
        });
    });

    function selectVersion(ci: number, vi: number, crumb: typeof crumbs[number], isCurrent: boolean) {
        if (crumb.type !== "revision") return;
        crumbSelectedVersions[ci] = vi;
        openDropdown = -1;
        crumb.parentView.dispatch(setActiveRevisionVersion(crumb.parentView.state, crumb.revisionId, vi));
        if (isCurrent) {
            destroyEditor();
            tick().then(() => {
                const v = view.state.field(annotationField)[revisionId] as Annotation<"revision"> | undefined;
                if (v) createEditor(v.versions[v.currentlySelected]);
            });
        } else {
            // Pop back to that level and signal it to rebuild its editor
            modalStack.popToAndRebuild(ci);
        }
    }

    // Rebuild editor when our own stack entry gets a fresh rebuildToken
    // (set by popToAndRebuild when a child level switches our version)
    let lastRebuildToken = 0;
    $effect(() => {
        const entry = $modalStack[stackIndex] as (ModalEntry & { rebuildToken?: number }) | undefined;
        const token = entry?.rebuildToken ?? 0;
        if (token && token !== lastRebuildToken) {
            lastRebuildToken = token;
            destroyEditor();
            tick().then(() => {
                const v = view.state.field(annotationField)[revisionId] as Annotation<"revision"> | undefined;
                if (v) createEditor(v.versions[v.currentlySelected]);
            });
        }
    });

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
        if (openDropdown === -1) return;
        const handler = (e: MouseEvent) => {
            if (!(e.target as HTMLElement).closest(".version-trigger, .version-popover")) {
                openDropdown = -1;
            }
        };
        document.addEventListener("click", handler);
        return () => document.removeEventListener("click", handler);
    });

    $effect(() => {
        if (!dialogEl) return;
        if (!dialogEl.open) dialogEl.showModal();
        tick().then(() => {
            const rev = view.state.field(annotationField)[revisionId] as Annotation<"revision"> | undefined;
            if (rev && !editor) {
                createEditor(rev.versions[rev.currentlySelected]);
            }
            // Run any pending nested annotation command passed when opening the modal
            const activeEditor = editor;
            const entry = $modalStack[stackIndex];
            if (activeEditor && entry?.type === "revision" && entry.pendingNestedCommand) {
                const cmd = entry.pendingNestedCommand;
                const s = activeEditor.state;
                const docLen = s.doc.length;
                const from = Math.max(0, Math.min(cmd.selectionFrom, docLen));
                const to = Math.max(from, Math.min(cmd.selectionTo, docLen));
                activeEditor.dispatch({ selection: EditorSelection.range(from, to) });
                activeEditor.focus();
                if (cmd.type === "comment") {
                    const s2 = activeEditor.state;
                    if (!s2.selection.main.empty && canCreateNewComment(s2.field(annotationField))) {
                        activeEditor.dispatch(
                            s2.update({
                                effects: [addAnnotation.of(createNewAnnotation(s2.field(annotationField), s2.selection, "comment"))],
                                annotations: Transaction.addToHistory.of(true),
                            }),
                        );
                    }
                } else if (cmd.type === "revision") {
                    const s2 = activeEditor.state;
                    if (!s2.selection.main.empty) {
                        const selectedText = s2.sliceDoc(s2.selection.main.from, s2.selection.main.to);
                        activeEditor.dispatch(
                            s2.update({
                                effects: [
                                    addAnnotation.of({
                                        ...createNewAnnotation(s2.field(annotationField), s2.selection, "revision"),
                                        currentlySelected: 0,
                                        versions: [{ doc: selectedText }],
                                    }),
                                ],
                                annotations: Transaction.addToHistory.of(true),
                            }),
                        );
                    }
                }
            }
        });
    });

    onDestroy(() => {
        destroyEditor();
    });

    const revisionThread = $derived(
        (view.state.field(annotationField)[revisionId] as Annotation<"revision"> | undefined)?.thread ?? [],
    );

    function dispatchUpdateThread(newThreadValue: ThreadType) {
        view.dispatch(
            view.state.update({
                effects: [
                    updateThread.of({
                        annotationId: revisionId,
                        newThread: newThreadValue,
                    }),
                ],
            }),
        );
    }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
<dialog
    bind:this={dialogEl}
    class="revision-modal"
    onclick={(e) => { if (e.target === dialogEl) close(); }}
>
    <div class="revision-modal-inner">
        <!-- Header -->
        <div class="flex items-center justify-between px-5 py-3 border-b border-purple-100/80 shrink-0 gap-3 min-w-0">
            <!-- Breadcrumb trail -->
            <nav class="flex items-center gap-1.5 min-w-0 flex-1 flex-wrap">
                {#each crumbs as crumb, ci}
                    {@const isCurrent = ci === crumbs.length - 1}
                    {@const crumbRevision = crumb.type === "revision"
                        ? (crumb.parentView.state.field(annotationField)[crumb.revisionId] as Annotation<"revision"> | undefined)
                        : undefined}
                    {@const selectedVi = crumbSelectedVersions[ci] ?? 0}

                    {#if ci > 0}
                        <ChevronRight size={10} class="text-purple-300/60 shrink-0" />
                    {/if}

                    <div class="flex items-center gap-1.5">
                        <!-- "Revision" label — clickable back if not current -->
                        {#if isCurrent}
                            <span class="text-[10px] font-semibold text-purple-700/70 uppercase tracking-wider shrink-0">Revision</span>
                        {:else}
                            <button
                                class="text-[10px] text-purple-400/60 hover:text-purple-600/80 transition-colors uppercase tracking-wider shrink-0"
                                onclick={() => modalStack.popTo(ci)}
                            >Revision</button>
                        {/if}

                        <!-- Version dropdown -->
                        {#if crumbRevision && crumbRevision.versions.length > 0}
                            <!-- svelte-ignore a11y_no_static_element_interactions -->
                            <div
                                class="relative"
                                onkeydown={(e) => { if (e.key === "Escape") openDropdown = -1; }}
                            >
                                <!-- Trigger -->
                                <button
                                    class="version-trigger flex items-center gap-1 pl-2 pr-1.5 py-0.5 rounded-md text-[10px] font-medium
                                        transition-all duration-150
                                        {isCurrent
                                            ? 'bg-purple-100/70 text-purple-700/80 hover:bg-purple-100 ring-1 ring-purple-200/60'
                                            : 'bg-black/5 text-black/45 hover:bg-black/8 ring-1 ring-black/10'}
                                        {openDropdown === ci ? 'ring-2 ' + (isCurrent ? 'ring-purple-300/60' : 'ring-black/20') : ''}"
                                    onclick={(e) => { e.stopPropagation(); openDropdown = openDropdown === ci ? -1 : ci; }}
                                >
                                    <span>{crumbRevision.versions[selectedVi]?.label ?? previewVersionText(crumbRevision.versions[selectedVi])}</span>
                                    <ChevronDown
                                        size={9}
                                        class="transition-transform duration-200 {openDropdown === ci ? 'rotate-180' : ''}
                                            {isCurrent ? 'text-purple-400/70' : 'text-black/30'}"
                                    />
                                </button>

                                <!-- Popover -->
                                {#if openDropdown === ci}
                                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                                    <div
                                        class="version-popover"
                                        transition:scale={{ start: 0.92, duration: 150, opacity: 0 }}
                                        style="transform-origin: top left;"
                                    >
                                        {#each crumbRevision.versions as version, vi}
                                            {@const isSelected = vi === selectedVi}
                                            <button
                                                class="version-option {isSelected ? 'version-option-active' : ''}"
                                                onclick={() => selectVersion(ci, vi, crumb, isCurrent)}
                                            >
                                                <span class="flex-1 text-left truncate">{version.label ?? previewVersionText(version)}</span>
                                                {#if isSelected}
                                                    <Check size={10} class="text-purple-500/70 shrink-0" />
                                                {/if}
                                            </button>
                                        {/each}
                                    </div>
                                {/if}
                            </div>
                        {/if}
                    </div>
                {/each}
            </nav>

            <button
                class="p-1 rounded-md text-black/30 hover:text-black/60 hover:bg-black/5 transition-colors shrink-0"
                onclick={close}
            >
                <X size={16} />
            </button>
        </div>

        <!-- Body: thread + editor + annotations panel -->
        <div class="flex flex-1 overflow-hidden">
            <!-- Thread sidebar (left) -->
            <div class="revision-modal-thread shrink-0 border-r border-purple-100/60 flex flex-col bg-purple-50/20">
                <div class="px-4 py-3 border-b border-purple-100/50">
                    <span class="text-[9px] font-semibold text-purple-600/60 uppercase tracking-wider">Thread</span>
                </div>
                <div class="flex-1 overflow-y-auto px-4 py-3">
                    {#if revisionThread.length === 0}
                        <p class="text-[11px] text-black/30 leading-relaxed mb-3">No messages yet.</p>
                    {/if}
                    <Thread
                        thread={revisionThread}
                        updateThread={dispatchUpdateThread}
                        accentClass="text-purple-600/80 hover:text-purple-700"
                    />
                </div>
            </div>

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
        width: 1060px;
        height: 72vh;
        background: white;
        border-radius: 1rem;
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
        overflow: hidden;
    }

    .revision-modal-thread {
        width: 220px;
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

    .version-popover {
        position: absolute;
        top: calc(100% + 4px);
        left: 0;
        min-width: 160px;
        max-width: 240px;
        background: white;
        border: 1px solid rgba(147, 112, 219, 0.15);
        border-radius: 10px;
        box-shadow: 0 8px 24px -4px rgba(0,0,0,0.12), 0 2px 8px -2px rgba(0,0,0,0.08);
        padding: 4px;
        z-index: 10;
        overflow: hidden;
    }

    .version-option {
        display: flex;
        align-items: center;
        gap: 6px;
        width: 100%;
        padding: 5px 8px;
        border-radius: 6px;
        font-size: 11px;
        color: rgba(0,0,0,0.6);
        transition: background 0.1s, color 0.1s;
        cursor: pointer;
    }

    .version-option:hover {
        background: rgba(147, 112, 219, 0.08);
        color: rgba(109, 40, 217, 0.85);
    }

    .version-option-active {
        background: rgba(147, 112, 219, 0.1);
        color: rgba(109, 40, 217, 0.9);
        font-weight: 500;
    }
</style>
