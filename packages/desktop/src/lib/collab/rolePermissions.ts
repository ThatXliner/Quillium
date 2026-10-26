import { parentSyncEdit } from "$lib/editor/plugins/annotations/NestedEditorController";
import {
    addAnnotation,
    annotationField,
    classifyAnnotationMutation,
    removeAnnotation,
    updateThread,
} from "$lib/editor/plugins/annotations/annotationField";
import { commentDraftScopeBridge } from "$lib/editor/plugins/annotations/drafts.svelte";
import { isAnnotationOfType } from "$lib/editor/plugins/annotations/models";
import { versionGroupField } from "$lib/editor/plugins/annotations/versionGroupField";
import { modalStack } from "$lib/stores";
import {
    Annotation,
    EditorState,
    type Extension,
    StateEffect,
    Transaction,
} from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import * as Y from "yjs";
import { getCommentSubmission, registerCommentSubmissions } from "./commentSubmission.svelte";
import { pendingCommentsFor } from "./pendingComments";
import { type RoleContext, roleContext } from "./roleContext";
import { yjsAnnotationSync } from "./yjsAnnotations";
import { yjsAnnotation } from "./yjsBinding";
import type { CommentOperation } from "./yjsProvider";
import { yjsVersionGroupSync } from "./yjsVersionGroups";

const pendingProjection = Annotation.define<boolean>();
const sendComment = StateEffect.define<{ annotationId: number; message: string }>();

export function createRolePermissions(context: RoleContext): Extension {
    let view: EditorView | undefined;
    const pending = pendingCommentsFor(context);
    const prepare = (annotationId: number, message: string): CommentOperation => {
        if (!view) throw new Error("The comment editor has closed");
        const annotation = view.state.field(annotationField)[annotationId];
        if (!annotation || !isAnnotationOfType(annotation, "comment"))
            throw new Error("Comment not found");
        if (pending.has(annotationId)) {
            const range = annotation.selection.main;
            return context.prepareComment({
                kind: "createComment",
                scope: context.scope,
                start: Array.from(
                    Y.encodeRelativePosition(
                        Y.createRelativePositionFromTypeIndex(context.text, range.from),
                    ),
                ),
                end: Array.from(
                    Y.encodeRelativePosition(
                        Y.createRelativePositionFromTypeIndex(context.text, range.to),
                    ),
                ),
                message,
            });
        }
        const id = context.ids.getYjsId(annotationId);
        if (!id) throw new Error("Comment not found");
        return context.prepareComment({
            kind: "replyToComment",
            scope: context.scope,
            annotationId: id,
            message,
        });
    };
    const accepted = (annotationId: number, target: string): void => {
        if (context.ids.getYjsId(annotationId) === target) pending.remove(target);
    };
    return [
        roleContext.of(context),
        commentDraftScopeBridge,
        ...(context.role === "editor"
            ? []
            : [
                  EditorState.readOnly.of(context.role === "viewer"),
                  EditorView.editable.of(false),
                  EditorView.contentAttributes.of({ tabindex: "0", "aria-readonly": "true" }),
                  EditorState.transactionFilter.of((transaction) => {
                      if (
                          transaction.annotation(yjsAnnotation) ||
                          transaction.annotation(yjsAnnotationSync) ||
                          transaction.annotation(yjsVersionGroupSync) ||
                          transaction.annotation(parentSyncEdit) ||
                          transaction.annotation(pendingProjection)
                      )
                          return transaction;
                      if (
                          transaction.startState.field(versionGroupField, false) !==
                          transaction.state.field(versionGroupField, false)
                      )
                          return [];
                      if (
                          !transaction.docChanged &&
                          classifyAnnotationMutation(transaction) === "none"
                      )
                          return transaction;
                      if (transaction.docChanged || context.role === "viewer") return [];
                      const pendingBefore = pending.ids();
                      const allowedPending = new Set(pendingBefore);
                      const requests: ReturnType<typeof sendComment.of>[] = [];
                      for (const effect of transaction.effects) {
                          if (effect.is(addAnnotation)) {
                              if (
                                  transaction.startState.field(annotationField)[effect.value.id] &&
                                  !allowedPending.has(effect.value.id)
                              )
                                  return [];
                              if (
                                  !isAnnotationOfType(effect.value, "comment") ||
                                  effect.value.status !== "pending" ||
                                  effect.value.thread.length !== 0
                              )
                                  return [];
                              allowedPending.add(effect.value.id);
                          } else if (effect.is(removeAnnotation)) {
                              if (!allowedPending.has(effect.value.id)) return [];
                              allowedPending.delete(effect.value.id);
                          } else if (effect.is(updateThread)) {
                              const annotation =
                                  transaction.startState.field(annotationField)[
                                      effect.value.annotationId
                                  ];
                              if (!annotation || !isAnnotationOfType(annotation, "comment"))
                                  return [];
                              const thread = effect.value.newThread;
                              if (
                                  thread.length !== annotation.thread.length + 1 ||
                                  JSON.stringify(thread.slice(0, -1)) !==
                                      JSON.stringify(annotation.thread)
                              )
                                  return [];
                              const message = thread.at(-1)?.message;
                              if (!message?.trim()) return [];
                              requests.push(
                                  sendComment.of({ annotationId: annotation.id, message }),
                              );
                          }
                      }
                      const effects = transaction.effects.filter(
                          (effect) => !effect.is(updateThread),
                      );
                      const projected = requests.length
                          ? transaction.startState.update({ effects, filter: false }).state
                          : transaction.state;
                      const before = transaction.startState.field(annotationField);
                      const after = projected.field(annotationField);
                      for (const [id, annotation] of Object.entries(before)) {
                          if (
                              !pendingBefore.has(Number(id)) &&
                              !allowedPending.has(Number(id)) &&
                              JSON.stringify(annotation) !== JSON.stringify(after[Number(id)])
                          )
                              return [];
                      }
                      for (const [id, annotation] of Object.entries(after)) {
                          if (!before[Number(id)] && !allowedPending.has(Number(id))) return [];
                          if (
                              allowedPending.has(Number(id)) &&
                              (!isAnnotationOfType(annotation, "comment") ||
                                  annotation.status !== "pending" ||
                                  annotation.thread.length !== 0)
                          )
                              return [];
                      }
                      return requests.length
                          ? {
                                effects: [...effects, ...requests],
                                selection: transaction.selection,
                                annotations: Transaction.addToHistory.of(false),
                            }
                          : transaction;
                  }),
              ]),
        ...(context.role === "commenter"
            ? [
                  EditorState.transactionExtender.of((transaction) => {
                      if (
                          transaction.annotation(pendingProjection) ||
                          !(
                              transaction.annotation(parentSyncEdit) ||
                              transaction.annotation(yjsAnnotation) ||
                              transaction.annotation(yjsAnnotationSync)
                          )
                      )
                          return null;
                      return {
                          effects: pending
                              .project()
                              .map((annotation) => addAnnotation.of(annotation)),
                      };
                  }),
              ]
            : []),
        ViewPlugin.fromClass(
            class {
                private unregister: (() => void) | undefined;
                private unsubscribe: (() => void) | undefined;
                private destroyed = false;
                private scheduled = false;
                private visible = new Set<number>();
                constructor(private readonly editor: EditorView) {
                    view = editor;
                    if (context.role === "commenter") {
                        this.unregister = registerCommentSubmissions(editor, prepare, {
                            scope: context.annotations,
                            keyForAnnotationId: (id) => context.ids.getYjsId(id),
                            onAccepted: accepted,
                        });
                        this.unsubscribe = pending.subscribe(() => this.scheduleProjection());
                        this.scheduleProjection();
                    }
                }
                update(update: ViewUpdate): void {
                    if (context.role !== "commenter") return;
                    for (const transaction of update.transactions) {
                        if (
                            transaction.annotation(parentSyncEdit) ||
                            transaction.annotation(yjsAnnotation) ||
                            transaction.annotation(yjsAnnotationSync) ||
                            transaction.annotation(pendingProjection)
                        )
                            continue;
                        for (const effect of transaction.effects) {
                            if (
                                effect.is(addAnnotation) &&
                                isAnnotationOfType(effect.value, "comment") &&
                                effect.value.status === "pending" &&
                                effect.value.thread.length === 0
                            ) {
                                const committed =
                                    update.state.field(annotationField)[effect.value.id];
                                if (committed && isAnnotationOfType(committed, "comment"))
                                    pending.add(committed);
                            } else if (effect.is(removeAnnotation)) {
                                const key = context.ids.getYjsId(effect.value.id);
                                if (key && pending.has(effect.value.id)) pending.remove(key);
                            } else if (effect.is(sendComment)) {
                                const { annotationId, message } = effect.value;
                                const key = context.ids.getYjsId(annotationId);
                                queueMicrotask(() => {
                                    if (
                                        !this.destroyed &&
                                        key &&
                                        context.ids.getYjsId(annotationId) === key
                                    )
                                        void getCommentSubmission(this.editor, annotationId)?.send(
                                            message,
                                        );
                                });
                            }
                        }
                    }
                    this.visible = new Set([...this.visible, ...pending.ids()]);
                }
                private scheduleProjection(): void {
                    if (this.scheduled || this.destroyed) return;
                    this.scheduled = true;
                    queueMicrotask(() => {
                        this.scheduled = false;
                        if (this.destroyed) return;
                        const current = this.editor.state.field(annotationField);
                        const annotations = pending.project();
                        const next = new Set(annotations.map((annotation) => annotation.id));
                        const effects: StateEffect<unknown>[] = [];
                        for (const id of this.visible) {
                            if (!next.has(id) && current[id]) {
                                effects.push(removeAnnotation.of(current[id]));
                                modalStack.removeComment(this.editor, id);
                            }
                        }
                        for (const annotation of annotations) {
                            const previous = current[annotation.id];
                            if (
                                !previous ||
                                JSON.stringify(previous) !== JSON.stringify(annotation)
                            )
                                effects.push(addAnnotation.of(annotation));
                        }
                        this.visible = next;
                        if (effects.length)
                            this.editor.dispatch({
                                effects,
                                annotations: [
                                    pendingProjection.of(true),
                                    Transaction.addToHistory.of(false),
                                ],
                            });
                    });
                }
                destroy(): void {
                    this.destroyed = true;
                    this.unregister?.();
                    this.unsubscribe?.();
                    view = undefined;
                }
            },
        ),
    ];
}
