/**
 * yjsAnnotations.ts — Scoped Y.Map <-> annotationField sync via observeDeep.
 *
 * Per D-90/D-92: Annotations are recursive Y.Map nodes; this plugin syncs
 * ONE scope (pair of Y.Text + Y.Map) to a CodeMirror EditorView. Plan 8.5c-01
 * mounts an instance per nested editor subtree.
 * Per D-93: Comment threads are Y.Array (append-only); Y.Array.push is the
 * mutation primitive.
 * Per D-94: No legacy wire format. The previous syncRevisionChanges JSON-diff
 * path was deleted in this phase.
 *
 * Origin tagging:
 *   - ydoc.transact(..., "local")  : writes this plugin originated
 *   - Transactions tagged with yjsAnnotationSync(true) : dispatches this plugin
 *     originated on the CM side (skip to avoid loops)
 *
 * Threat mitigations:
 *   T-08.5-03-01: Observer ignores any event whose tr.origin === "local".
 *   T-08.5-03-02: Remote payloads pass through yjsAnnotationToCodeMirror which
 *                 returns null on malformed data; null entries are skipped.
 */
import { ViewPlugin, type ViewUpdate, type EditorView } from "@codemirror/view";
import { Annotation } from "@codemirror/state";
import * as Y from "yjs";
import {
    codeMirrorToYjsAnnotation,
    yjsAnnotationToCodeMirror,
    AnnotationIdMap,
} from "./annotationSchema";
import type { YjsAnnotationNode, MessageObject } from "./types";
import {
    addAnnotation,
    removeAnnotation,
    updateThread,
    annotationField,
} from "$lib/editor/plugins/annotations/annotationField";

export const yjsAnnotationSync = Annotation.define<boolean>();

export function createAnnotationSyncPlugin(
    scopeYtext: Y.Text,
    scopeAnnotations: Y.Map<YjsAnnotationNode>,
    clientId: string,
) {
    return ViewPlugin.fromClass(
        class {
            private deepObserver: (
                events: Y.YEvent<Y.AbstractType<unknown>>[],
                tr: Y.Transaction,
            ) => void;
            private destroyed = false;
            private idMap = new AnnotationIdMap();

            constructor(private view: EditorView) {
                this._syncIdMapFromCM();

                this.deepObserver = (events, tr) => {
                    if (this.destroyed || tr.origin === "local") return;
                    const ydoc = scopeYtext.doc;
                    if (!ydoc) return;

                    const effects: Array<
                        | ReturnType<typeof addAnnotation.of>
                        | ReturnType<typeof removeAnnotation.of>
                        | ReturnType<typeof updateThread.of>
                    > = [];

                    // Track annotation IDs that need a full rebuild so we don't
                    // queue an add + update for the same node in one flush.
                    const rebuildCmIds = new Set<number>();

                    for (const ev of events) {
                        // Shallow: scopeAnnotations key add/remove/update
                        if (ev.target === scopeAnnotations && ev instanceof Y.YMapEvent) {
                            for (const key of ev.keysChanged) {
                                const change = ev.changes.keys.get(key);
                                if (!change) continue;

                                if (change.action === "delete") {
                                    const cmId = this.idMap.getCmId(key);
                                    if (cmId !== undefined) {
                                        const current = this.view.state.field(annotationField);
                                        const existing = current[cmId];
                                        if (existing) effects.push(removeAnnotation.of(existing));
                                        this.idMap.remove(key);
                                    }
                                    continue;
                                }

                                // add or update → schedule full rebuild
                                const node = scopeAnnotations.get(key);
                                if (!node) continue;
                                const cmId = this.idMap.getOrCreateCmId(key);
                                rebuildCmIds.add(cmId);
                            }
                            continue;
                        }

                        // Nested: thread Y.Array for one of our annotations.
                        // Path shape: [<annotationYjsKey>, "thread"] or similar.
                        if (
                            ev.target instanceof Y.Array &&
                            ev.path.length >= 2 &&
                            ev.path[1] === "thread"
                        ) {
                            const yjsKey = ev.path[0] as string;
                            const cmId = this.idMap.getCmId(yjsKey);
                            if (cmId === undefined) continue;
                            const threadArr = ev.target as Y.Array<MessageObject>;
                            effects.push(
                                updateThread.of({
                                    annotationId: cmId,
                                    newThread: threadArr.toArray(),
                                }),
                            );
                            continue;
                        }

                        // Nested: anything else under a revision's version subtree
                        // (text changes, label edits, nested annotations map ops).
                        // Schedule a full rebuild of the owning annotation so the CM
                        // revision annotation reflects the new versions[] snapshot.
                        if (ev.path.length >= 1) {
                            const yjsKey = ev.path[0] as string;
                            const cmId = this.idMap.getCmId(yjsKey);
                            if (cmId !== undefined) rebuildCmIds.add(cmId);
                        }
                    }

                    // Apply pending rebuilds (remove + add)
                    if (rebuildCmIds.size > 0) {
                        const current = this.view.state.field(annotationField);
                        for (const cmId of rebuildCmIds) {
                            const yjsKey = this.idMap.getYjsId(cmId);
                            if (!yjsKey) continue;
                            const node = scopeAnnotations.get(yjsKey);
                            if (!node) continue;
                            const rebuilt = yjsAnnotationToCodeMirror(node, ydoc, scopeYtext, cmId);
                            if (!rebuilt) continue;
                            const existing = current[cmId];
                            if (existing) effects.push(removeAnnotation.of(existing));
                            effects.push(addAnnotation.of(rebuilt));
                        }
                    }

                    if (effects.length > 0) {
                        this.view.dispatch({
                            effects,
                            annotations: [yjsAnnotationSync.of(true)],
                        });
                    }
                };

                scopeAnnotations.observeDeep(this.deepObserver);
            }

            private _syncIdMapFromCM() {
                const annotations = this.view.state.field(annotationField);
                for (const idStr of Object.keys(annotations)) {
                    const cmId = Number(idStr);
                    const yjsId = `${clientId}-init-${cmId}`;
                    this.idMap.register(yjsId, cmId);
                }
            }

            update(update: ViewUpdate) {
                if (update.transactions.some((tr) => tr.annotation(yjsAnnotationSync))) {
                    return;
                }
                const ydoc = scopeYtext.doc;
                if (!ydoc) return;

                for (const tr of update.transactions) {
                    for (const effect of tr.effects) {
                        if (effect.is(addAnnotation)) {
                            const ann = effect.value;
                            let yjsId = this.idMap.getYjsId(ann.id);
                            if (!yjsId) {
                                yjsId = `${clientId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                                this.idMap.register(yjsId, ann.id);
                            }
                            const capturedYjsId = yjsId;
                            const node = codeMirrorToYjsAnnotation(ann, scopeYtext, clientId, ydoc);
                            node.set("id", capturedYjsId);
                            ydoc.transact(() => {
                                scopeAnnotations.set(capturedYjsId, node);
                            }, "local");
                        } else if (effect.is(removeAnnotation)) {
                            const ann = effect.value;
                            const yjsId = this.idMap.getYjsId(ann.id);
                            if (yjsId) {
                                const capturedYjsId = yjsId;
                                ydoc.transact(() => {
                                    scopeAnnotations.delete(capturedYjsId);
                                }, "local");
                                this.idMap.remove(yjsId);
                            }
                        } else if (effect.is(updateThread)) {
                            const { annotationId, newThread } = effect.value;
                            const yjsId = this.idMap.getYjsId(annotationId);
                            if (!yjsId) continue;
                            const node = scopeAnnotations.get(yjsId);
                            if (!node) continue;
                            const threadArr = node.get("thread");
                            if (!(threadArr instanceof Y.Array)) continue;
                            const cur = threadArr.length;
                            ydoc.transact(() => {
                                if (newThread.length >= cur) {
                                    // Pure append (D-93 happy path)
                                    const appended = newThread.slice(cur).map((m) => ({ ...m }));
                                    if (appended.length > 0) threadArr.push(appended);
                                } else {
                                    // Shrink / divergence — replace atomically.
                                    threadArr.delete(0, cur);
                                    if (newThread.length > 0) {
                                        threadArr.push(newThread.map((m) => ({ ...m })));
                                    }
                                }
                            }, "local");
                        }
                    }
                }
                // NOTE: syncRevisionChanges removed. Revision version text is owned
                // by the subtree Y.Text (Plan 8.5c-01 wires createYjsBinding there).
                // Revision structural ops (add version, switch active) will go
                // through dedicated StateEffects or subtree Y.Map updates in Plan 8.5c-01.
            }

            destroy() {
                this.destroyed = true;
                scopeAnnotations.unobserveDeep(this.deepObserver);
                this.idMap.clear();
            }
        },
    );
}
