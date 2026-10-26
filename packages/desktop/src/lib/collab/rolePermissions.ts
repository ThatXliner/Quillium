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
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";
import * as Y from "yjs";
import { getCommentSubmission, registerCommentSubmissions } from "./commentSubmission.svelte";
import { type RoleContext, roleContext } from "./roleContext";
import { yjsAnnotationSync } from "./yjsAnnotations";
import { yjsAnnotation } from "./yjsBinding";
import type { CommentOperation } from "./yjsProvider";
import { yjsVersionGroupSync } from "./yjsVersionGroups";

export function createRolePermissions(context: RoleContext): Extension {
    let view: EditorView | undefined;
    const pending = new Set<number>();
    const prepare = (annotationId: number, message: string): CommentOperation => {
        if (!view) throw new Error("The comment editor has closed");
        const annotation = view.state.field(annotationField)[annotationId];
        if (!annotation || !isAnnotationOfType(annotation, "comment"))
            throw new Error("Comment not found");
        if (pending.has(annotationId)) {
            const range = annotation.selection.main;
            const operation = context.prepareComment({
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
            return async (): Promise<void> => {
                await operation();
                if (!view) return;
                const current = view.state.field(annotationField)[annotationId];
                if (current && pending.has(annotationId)) {
                    pending.delete(annotationId);
                    const pendingKey = context.ids.getYjsId(annotationId);
                    if (pendingKey) context.ids.remove(pendingKey);
                    modalStack.removeComment(view, annotationId);
                    view.dispatch({
                        effects: removeAnnotation.of(current),
                        annotations: yjsAnnotationSync.of(true),
                    });
                }
            };
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
                          transaction.annotation(parentSyncEdit)
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
                      const pendingBefore = new Set(pending);
                      let allowLocal = true;
                      for (const effect of transaction.effects) {
                          if (effect.is(addAnnotation)) {
                              if (
                                  transaction.startState.field(annotationField)[effect.value.id] &&
                                  !pending.has(effect.value.id)
                              )
                                  return [];
                              if (
                                  !isAnnotationOfType(effect.value, "comment") ||
                                  effect.value.status !== "pending" ||
                                  effect.value.thread.length !== 0
                              )
                                  return [];
                              pending.add(effect.value.id);
                              context.ids.getOrCreateYjsId(effect.value.id, "pending-comment");
                          } else if (effect.is(removeAnnotation)) {
                              if (!pending.has(effect.value.id)) return [];
                              pending.delete(effect.value.id);
                              const pendingKey = context.ids.getYjsId(effect.value.id);
                              if (pendingKey) context.ids.remove(pendingKey);
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
                              const id = annotation.id;
                              queueMicrotask(() => {
                                  if (view) void getCommentSubmission(view, id)?.send(message);
                              });
                              allowLocal = false;
                          }
                      }
                      if (!allowLocal) return [];
                      const before = transaction.startState.field(annotationField);
                      const after = transaction.state.field(annotationField);
                      for (const [id, annotation] of Object.entries(before)) {
                          if (
                              !pendingBefore.has(Number(id)) &&
                              !pending.has(Number(id)) &&
                              JSON.stringify(annotation) !== JSON.stringify(after[Number(id)])
                          )
                              return [];
                      }
                      for (const [id, annotation] of Object.entries(after)) {
                          if (!before[Number(id)] && !pending.has(Number(id))) return [];
                          if (
                              pending.has(Number(id)) &&
                              (!isAnnotationOfType(annotation, "comment") ||
                                  annotation.status !== "pending" ||
                                  annotation.thread.length !== 0)
                          )
                              return [];
                      }
                      return transaction;
                  }),
              ]),
        ViewPlugin.fromClass(
            class {
                private unregister: (() => void) | undefined;
                constructor(editor: EditorView) {
                    view = editor;
                    if (context.role === "commenter")
                        this.unregister = registerCommentSubmissions(editor, prepare);
                }
                destroy(): void {
                    this.unregister?.();
                    view = undefined;
                }
            },
        ),
    ];
}
