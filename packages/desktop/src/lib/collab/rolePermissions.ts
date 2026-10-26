import { parentSyncEdit } from "$lib/editor/plugins/annotations/NestedEditorController";
import {
    addAnnotation,
    annotationField,
    classifyAnnotationMutation,
    removeAnnotation,
    updateThread,
} from "$lib/editor/plugins/annotations/annotationField";
import { isAnnotationOfType } from "$lib/editor/plugins/annotations/models";
import { versionGroupField } from "$lib/editor/plugins/annotations/versionGroupField";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";
import { toast } from "svelte-sonner";
import * as Y from "yjs";
import { type RoleContext, roleContext } from "./roleContext";
import { yjsAnnotationSync } from "./yjsAnnotations";
import { yjsAnnotation } from "./yjsBinding";
import type { CommentInput } from "./yjsProvider";
import { yjsVersionGroupSync } from "./yjsVersionGroups";

export function createRolePermissions(context: RoleContext): Extension {
    let view: EditorView | undefined;
    const pending = new Set<number>();
    const submitting = new Set<string>();
    const submit = (command: CommentInput, pendingId?: number): void => {
        const key =
            pendingId === undefined && command.kind === "replyToComment"
                ? command.annotationId
                : String(pendingId);
        if (submitting.has(key)) return;
        submitting.add(key);
        queueMicrotask(() => {
            void context
                .send(command)
                .then(() => {
                    if (pendingId === undefined || !view) return;
                    const annotation = view.state.field(annotationField)[pendingId];
                    if (annotation && pending.has(pendingId)) {
                        pending.delete(pendingId);
                        const pendingKey = context.ids.getYjsId(pendingId);
                        if (pendingKey) context.ids.remove(pendingKey);
                        view.dispatch({
                            effects: removeAnnotation.of(annotation),
                            annotations: yjsAnnotationSync.of(true),
                        });
                    }
                })
                .finally(() => submitting.delete(key))
                .catch((error: unknown) =>
                    toast.error(
                        error instanceof Error ? error.message : "The comment was not accepted",
                    ),
                );
        });
    };
    return [
        roleContext.of(context),
        ...(context.role === "editor"
            ? []
            : [
                  EditorState.readOnly.of(context.role === "viewer"),
                  EditorView.editable.of(false),
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
                              if (pending.has(annotation.id)) {
                                  const range = annotation.selection.main;
                                  submit(
                                      {
                                          kind: "createComment",
                                          scope: context.scope,
                                          start: Array.from(
                                              Y.encodeRelativePosition(
                                                  Y.createRelativePositionFromTypeIndex(
                                                      context.text,
                                                      range.from,
                                                  ),
                                              ),
                                          ),
                                          end: Array.from(
                                              Y.encodeRelativePosition(
                                                  Y.createRelativePositionFromTypeIndex(
                                                      context.text,
                                                      range.to,
                                                  ),
                                              ),
                                          ),
                                          message,
                                      },
                                      annotation.id,
                                  );
                              } else {
                                  const annotationId = context.ids.getYjsId(annotation.id);
                                  if (!annotationId) return [];
                                  submit({
                                      kind: "replyToComment",
                                      scope: context.scope,
                                      annotationId,
                                      message,
                                  });
                              }
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
                constructor(editor: EditorView) {
                    view = editor;
                }
                destroy(): void {
                    view = undefined;
                }
            },
        ),
    ];
}
