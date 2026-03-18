/**
 * useRevisionModalEditor.svelte.ts — Reactive hook for the nested
 * CodeMirror editor lifecycle inside RevisionModal.
 *
 * Encapsulates:
 *   - FSM (unmounted → mounting → ready ⇄ rebuilding)
 *   - createEditor / destroyEditor / moveCursorToEnd
 *   - executePendingNestedCommand
 *   - Sensor effects A, B, C (dialog bind, external sync, nested events)
 *   - onDestroy cleanup
 *   - Publishing modalAnnotations to modalAnnotationStores
 *
 * Store values needed for reactivity are passed as getter functions
 * from the parent component, which can use $store syntax.
 */

import { onDestroy } from "svelte";
import { EditorView, type ViewUpdate } from "@codemirror/view";
import { EditorSelection, Transaction } from "@codemirror/state";
import {
    addAnnotation,
    annotationField,
    updateRevisionVersionState,
    type Annotation,
    type Annotations as AnnotationsMap,
    type GenericAnnotation,
} from ".";
import { canCreateNewComment, getActiveAnnotation } from "./utils";
import {
    createNewAnnotation,
    isAnnotationOfType,
    versionText,
    type VersionState,
} from "./models";
import { modalStack, modalAnnotationStores, type ModalEntry } from "$lib/stores";
import type { AnnotationUiEvent } from "$lib/stores";
import {
    createNestedEditorState,
    translateAndDispatch,
    previewVersionText,
} from "./nestedEditor";
import { nestedSavedFields } from "$lib/editor/extensions";

export function useRevisionModalEditor(props: {
    revisionId: number;
    view: EditorView;
    stackIndex: number;
    initialPendingCommand:
        | { type: string; selectionFrom: number; selectionTo: number; revisionId?: number }
        | undefined;
    /** Reactive getter: current modal stack entry at stackIndex */
    getModalEntry: () => (ModalEntry & { rebuildToken?: number }) | undefined;
    /** Reactive getter: annotation map from parent level (for Sensor B) */
    getParentAnnotations: () => AnnotationsMap | undefined;
    /** Reactive getter: latest annotationUiEvent */
    getAnnotationUiEvent: () => AnnotationUiEvent | null;
}) {
    const {
        revisionId,
        view,
        stackIndex,
        initialPendingCommand,
        getModalEntry,
        getParentAnnotations,
        getAnnotationUiEvent,
    } = props;

    // ─── FSM ──────────────────────────────────────────────────
    let fsmState = $state<"unmounted" | "mounting" | "ready" | "rebuilding">("unmounted");

    // DOM refs — set from the template
    let editorHost = $state<HTMLDivElement | undefined>(undefined);
    let wrapperEl = $state<HTMLDivElement | undefined>(undefined);

    // Editor state
    let editor = $state<EditorView | undefined>(undefined);
    let lastDispatchedDoc = "";
    let editorVersionIndex = 0;
    let pullingFromParent = false;

    // Reactive mirrors of nested CodeMirror state
    let modalAnnotations = $state<AnnotationsMap | undefined>(undefined);
    let modalActiveAnnotation = $state<GenericAnnotation | undefined>(undefined);

    function readRevision() {
        return view.state.field(annotationField)[revisionId] as
            | Annotation<"revision">
            | undefined;
    }

    function moveCursorToEnd(activeEditor: EditorView) {
        const end = activeEditor.state.doc.length;
        activeEditor.dispatch({
            selection: { anchor: end },
            scrollIntoView: true,
        });
        activeEditor.focus();
    }

    function createEditor(version: VersionState, versionIndex?: number) {
        if (!editorHost || editor) return;
        if (versionIndex !== undefined) editorVersionIndex = versionIndex;
        const state = createNestedEditorState(
            version,
            (update: ViewUpdate) => {
                if (!editor) return;
                if (!pullingFromParent && translateAndDispatch(update, view, revisionId)) {
                    lastDispatchedDoc = editor.state.doc.toString();
                }
                modalAnnotations = editor.state.field(annotationField);
                modalActiveAnnotation = getActiveAnnotation(editor.state);
            },
            view,
            revisionId,
        );
        editor = new EditorView({ state, parent: editorHost });
        lastDispatchedDoc = editor.state.doc.toString();
        modalAnnotations = editor.state.field(annotationField);
        modalActiveAnnotation = getActiveAnnotation(editor.state);
    }

    function destroyEditor() {
        if (editor) {
            const rev = view.state.field(annotationField)[revisionId] as
                | Annotation<"revision">
                | undefined;
            if (rev && editorVersionIndex < rev.versions.length) {
                const blob = editor.state.toJSON(nestedSavedFields) as VersionState;
                view.dispatch(
                    updateRevisionVersionState(
                        view.state,
                        revisionId,
                        editorVersionIndex,
                        blob,
                        { addToHistory: false },
                    ),
                );
            }
        }
        editor?.destroy();
        editor = undefined;
        modalAnnotations = undefined;
        modalActiveAnnotation = undefined;
    }

    function executePendingNestedCommand(
        activeEditor: EditorView,
        cmd: { type: string; selectionFrom: number; selectionTo: number },
    ) {
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
                        effects: [
                            addAnnotation.of(
                                createNewAnnotation(
                                    s2.field(annotationField),
                                    s2.selection,
                                    "comment",
                                ),
                            ),
                        ],
                        annotations: Transaction.addToHistory.of(true),
                    }),
                );
            }
        } else if (cmd.type === "revision") {
            const s2 = activeEditor.state;
            if (!s2.selection.main.empty) {
                const selectedText = s2.sliceDoc(
                    s2.selection.main.from,
                    s2.selection.main.to,
                );
                activeEditor.dispatch(
                    s2.update({
                        effects: [
                            addAnnotation.of({
                                ...createNewAnnotation(
                                    s2.field(annotationField),
                                    s2.selection,
                                    "revision",
                                ),
                                activeVersionIndex: 0,
                                versions: [{ doc: selectedText }],
                            }),
                        ],
                        annotations: Transaction.addToHistory.of(true),
                    }),
                );
            }
        }
    }

    type FsmEvent =
        | { type: "DIALOG_BOUND" }
        | { type: "REBUILD_REQUESTED" }
        | { type: "VERSION_SWITCHED" }
        | { type: "EXTERNAL_DOC_CHANGED"; doc: string }
        | {
              type: "NESTED_ANNOTATION_EVENT";
              cmd: {
                  type: string;
                  selectionFrom: number;
                  selectionTo: number;
                  revisionId?: number;
              };
          };

    function send(event: FsmEvent) {
        switch (fsmState) {
            case "unmounted": {
                if (event.type === "DIALOG_BOUND") {
                    fsmState = "mounting";
                }
                break;
            }
            case "ready": {
                if (event.type === "REBUILD_REQUESTED" || event.type === "VERSION_SWITCHED") {
                    fsmState = "rebuilding";
                    destroyEditor();
                    if (event.type === "VERSION_SWITCHED") {
                        modalStack.popTo(stackIndex);
                    }
                } else if (event.type === "EXTERNAL_DOC_CHANGED") {
                    if (!editor) break;
                    if (event.doc === lastDispatchedDoc) break;
                    const current = editor.state.doc.toString();
                    if (current !== event.doc) {
                        pullingFromParent = true;
                        editor.dispatch({
                            changes: { from: 0, to: current.length, insert: event.doc },
                            annotations: Transaction.addToHistory.of(false),
                        });
                        pullingFromParent = false;
                        modalAnnotations = editor.state.field(annotationField);
                    }
                    lastDispatchedDoc = event.doc;
                } else if (event.type === "NESTED_ANNOTATION_EVENT") {
                    if (!editor) break;
                    executePendingNestedCommand(editor, event.cmd);
                    if (event.cmd.type === "revision") {
                        const nestedAnns = editor.state.field(annotationField);
                        const keys = Object.keys(nestedAnns).map(Number);
                        if (keys.length === 0) break;
                        const newId = Math.max(...keys);
                        const newAnn = nestedAnns[newId];
                        if (newAnn && isAnnotationOfType(newAnn, "revision")) {
                            // Defer push outside the current Svelte flush cycle to
                            // prevent the modalStack update from re-triggering effects
                            // that are still mid-execution (stack overflow risk).
                            const entry = {
                                type: "revision" as const,
                                revisionId: newId,
                                parentView: editor,
                                label: previewVersionText(
                                    newAnn.versions[newAnn.activeVersionIndex],
                                ),
                            };
                            setTimeout(() => modalStack.push(entry), 0);
                        }
                    }
                }
                break;
            }
            default:
                break;
        }
    }

    // ─── Reactive FSM continuation ────────────────────────────
    $effect(() => {
        if (fsmState === "mounting" && editorHost) {
            const rev = readRevision();
            if (rev && !editor) {
                createEditor(rev.versions[rev.activeVersionIndex], rev.activeVersionIndex);
            }
            const activeEditor = editor;
            if (activeEditor) {
                if (initialPendingCommand) {
                    executePendingNestedCommand(activeEditor, initialPendingCommand);
                } else {
                    moveCursorToEnd(activeEditor);
                }
            }
            fsmState = "ready";
        } else if (fsmState === "rebuilding" && editorHost) {
            const rev = readRevision();
            if (rev) {
                createEditor(rev.versions[rev.activeVersionIndex], rev.activeVersionIndex);
                if (editor) moveCursorToEnd(editor);
            }
            fsmState = "ready";
        }
    });

    // ─── Sensor Effect A: Dialog bind + rebuild token ─────────
    let lastRebuildToken = 0;
    $effect(() => {
        const el = wrapperEl;
        const entry = getModalEntry();
        const token = entry?.rebuildToken ?? 0;

        if (fsmState === "unmounted" && el) {
            send({ type: "DIALOG_BOUND" });
        } else if (fsmState === "ready" && token && token !== lastRebuildToken) {
            lastRebuildToken = token;
            send({ type: "REBUILD_REQUESTED" });
        } else if (token) {
            lastRebuildToken = token;
        }
    });

    // ─── Sensor Effect B: External sync ───────────────────────
    let lastSyncedVersionIndex = -1;
    $effect(() => {
        const ann = getParentAnnotations();
        if (fsmState !== "ready" || !editor || !ann) return;
        const rev = ann[revisionId] as Annotation<"revision"> | undefined;
        if (!rev || !isAnnotationOfType(rev, "revision") || !rev.versions?.[rev.activeVersionIndex])
            return;

        if (lastSyncedVersionIndex >= 0 && rev.activeVersionIndex !== lastSyncedVersionIndex) {
            lastSyncedVersionIndex = rev.activeVersionIndex;
            send({ type: "VERSION_SWITCHED" });
            return;
        }
        lastSyncedVersionIndex = rev.activeVersionIndex;

        const externalDoc = versionText(rev.versions[rev.activeVersionIndex]);
        send({ type: "EXTERNAL_DOC_CHANGED", doc: externalDoc });
    });

    // ─── Sensor Effect C: Nested annotation event ─────────────
    let lastNestedEditorEventToken = getAnnotationUiEvent()?.token ?? 0;
    $effect(() => {
        const event = getAnnotationUiEvent();
        if (
            !event ||
            fsmState !== "ready" ||
            !editor ||
            event.token === lastNestedEditorEventToken ||
            event.type !== "revision-open-nested-editor" ||
            event.command.revisionId !== revisionId
        )
            return;
        lastNestedEditorEventToken = event.token;
        send({ type: "NESTED_ANNOTATION_EVENT", cmd: event.command });
    });

    // ─── Publish to per-level store ───────────────────────────
    $effect(() => {
        if (modalAnnotations) {
            modalAnnotationStores.set(stackIndex, modalAnnotations);
        }
    });

    // ─── Cleanup ──────────────────────────────────────────────
    onDestroy(() => {
        destroyEditor();
        modalAnnotationStores.remove(stackIndex);
    });

    return {
        get editorHost() { return editorHost; },
        set editorHost(el: HTMLDivElement | undefined) { editorHost = el; },
        get wrapperEl() { return wrapperEl; },
        set wrapperEl(el: HTMLDivElement | undefined) { wrapperEl = el; },
        get editor() { return editor; },
        get modalAnnotations() { return modalAnnotations; },
        get modalActiveAnnotation() { return modalActiveAnnotation; },
        send,
    };
}
