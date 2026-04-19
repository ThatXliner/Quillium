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
import { Annotation, Transaction } from "@codemirror/state";
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
    _updateActiveRevisionVersion,
    _addVersionToRevision,
    _deleteVersionFromRevision,
} from "$lib/editor/plugins/annotations/annotationField";
import { isAnnotationOfType } from "$lib/editor/plugins/annotations/models";

export const yjsAnnotationSync = Annotation.define<boolean>();

export function createAnnotationSyncPlugin(
    scopeYtext: Y.Text,
    scopeAnnotations: Y.Map<YjsAnnotationNode>,
    clientId: string,
    idMap: AnnotationIdMap = new AnnotationIdMap(),
) {
    return ViewPlugin.fromClass(
        class {
            private deepObserver: (
                events: Y.YEvent<Y.AbstractType<unknown>>[],
                tr: Y.Transaction,
            ) => void;
            private destroyed = false;
            private idMap = idMap;

            constructor(private view: EditorView) {
                this._syncIdMapFromCM();
                this._syncInitialToYjs();   // Owner: push CM annotations to Yjs
                this._syncInitialFromYjs(); // Joiner: pull Yjs annotations to CM

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
                            annotations: [
                                yjsAnnotationSync.of(true),
                                Transaction.addToHistory.of(false),
                            ],
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

            private _syncInitialToYjs() {
                const ydoc = scopeYtext.doc;
                if (!ydoc) return;

                const annotations = this.view.state.field(annotationField);
                const annotationIds = Object.keys(annotations);
                if (annotationIds.length === 0) return;

                // Owner seeding: push existing CM annotations to Yjs
                // Use queueMicrotask to ensure plugin is fully constructed
                queueMicrotask(() => {
                    if (this.destroyed) return;

                    ydoc.transact(() => {
                        for (const idStr of annotationIds) {
                            const cmId = Number(idStr);
                            const ann = annotations[cmId];
                            if (!ann) continue;

                            const yjsId = this.idMap.getYjsId(cmId);
                            if (!yjsId) continue;

                            // Skip if already in Yjs (reconnect case)
                            if (scopeAnnotations.has(yjsId)) continue;

                            const node = codeMirrorToYjsAnnotation(ann, scopeYtext, clientId, ydoc);
                            node.set("id", yjsId);
                            scopeAnnotations.set(yjsId, node);
                        }
                    }, "local");
                });
            }

            private _syncInitialFromYjs() {
                const ydoc = scopeYtext.doc;
                if (!ydoc) return;
                if (scopeAnnotations.size === 0) return;

                // CodeMirror doesn't allow dispatch() during plugin construction or
                // update(). queueMicrotask defers to the next event loop tick, after
                // the current update cycle completes. This is the standard CM pattern
                // for plugins that need to dispatch on mount (see codemirror/dev#1341).
                queueMicrotask(() => {
                    if (this.destroyed) return;

                    const effects: ReturnType<typeof addAnnotation.of>[] = [];
                    scopeAnnotations.forEach((node, yjsKey) => {
                        // Skip if already in CM (owner case)
                        if (this.idMap.getCmId(yjsKey) !== undefined) return;

                        const cmId = this.idMap.getOrCreateCmId(yjsKey);
                        const ann = yjsAnnotationToCodeMirror(node, ydoc, scopeYtext, cmId);
                        if (ann) effects.push(addAnnotation.of(ann));
                    });

                    if (effects.length > 0) {
                        this.view.dispatch({
                            effects,
                            annotations: [
                                yjsAnnotationSync.of(true),
                                Transaction.addToHistory.of(false),
                            ],
                        });
                    }
                });
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
                        } else if (effect.is(_updateActiveRevisionVersion)) {
                            // Propagate active-version-switch to the shared Y.Map so
                            // peers re-render with the same active version.
                            const yjsId = this.idMap.getYjsId(effect.value.annotationId);
                            if (!yjsId) continue;
                            const node = scopeAnnotations.get(yjsId);
                            if (!node) continue;
                            ydoc.transact(() => {
                                node.set("activeVersionIndex", effect.value.to);
                            }, "local");
                        } else if (effect.is(_addVersionToRevision)) {
                            // Add a new version's Y.Map entry to the revision's
                            // `versions` Y.Map. Remote peers rebuild from observeDeep.
                            const yjsId = this.idMap.getYjsId(effect.value.annotationId);
                            if (!yjsId) continue;
                            const node = scopeAnnotations.get(yjsId);
                            if (!node) continue;
                            const versions = node.get("versions");
                            if (!(versions instanceof Y.Map)) continue;
                            // Read the current annotation to learn the insertion index
                            // and the full versions list (post-effect state).
                            const ann = this.view.state.field(annotationField)[
                                effect.value.annotationId
                            ];
                            if (!ann || !isAnnotationOfType(ann, "revision")) continue;
                            const at =
                                effect.value.at ??
                                (ann.versions.length > 0 ? ann.versions.length - 1 : 0);
                            ydoc.transact(() => {
                                // Rebuild versions map to reflect the new ordering,
                                // since Y.Map keys are stringified indices.
                                const existingEntries: Array<[string, Y.Map<unknown>]> = [];
                                versions.forEach((v, k) => {
                                    if (v instanceof Y.Map) existingEntries.push([k, v]);
                                });
                                existingEntries.sort((a, b) => Number(a[0]) - Number(b[0]));

                                // Build the new version's Y.Map subtree.
                                const v = effect.value.newVersion;
                                const newVersionNode = new Y.Map<unknown>();
                                const vtext = new Y.Text();
                                if (v.doc.length > 0) vtext.insert(0, v.doc);
                                newVersionNode.set("text", vtext);
                                if (v.label !== undefined)
                                    newVersionNode.set("label", v.label);
                                newVersionNode.set(
                                    "annotations",
                                    new Y.Map<YjsAnnotationNode>(),
                                );

                                // Splice into the new order.
                                const reordered: Array<[string, Y.Map<unknown>]> = [];
                                let inserted = false;
                                for (const [, yNode] of existingEntries) {
                                    if (reordered.length === at && !inserted) {
                                        reordered.push([String(reordered.length), newVersionNode]);
                                        inserted = true;
                                    }
                                    reordered.push([String(reordered.length), yNode]);
                                }
                                if (!inserted) {
                                    reordered.push([String(reordered.length), newVersionNode]);
                                }

                                // Replace the versions map contents with the new order.
                                // Y.Map has no splice primitive; we clear and re-add by key.
                                const keysToDelete: string[] = [];
                                versions.forEach((_, k) => keysToDelete.push(k));
                                for (const k of keysToDelete) versions.delete(k);
                                for (const [k, v2] of reordered) versions.set(k, v2);

                                // active index may have shifted — write it explicitly.
                                node.set("activeVersionIndex", ann.activeVersionIndex);
                            }, "local");
                        } else if (effect.is(_deleteVersionFromRevision)) {
                            // Remove a version entry and compact the remaining keys.
                            const yjsId = this.idMap.getYjsId(effect.value.annotationId);
                            if (!yjsId) continue;
                            const node = scopeAnnotations.get(yjsId);
                            if (!node) continue;
                            const versions = node.get("versions");
                            if (!(versions instanceof Y.Map)) continue;
                            const ann = this.view.state.field(annotationField)[
                                effect.value.annotationId
                            ];
                            if (!ann || !isAnnotationOfType(ann, "revision")) continue;

                            ydoc.transact(() => {
                                // Collect surviving entries by numeric key, excluding the
                                // deleted index, then re-key them densely.
                                const entries: Array<[number, Y.Map<unknown>]> = [];
                                versions.forEach((v, k) => {
                                    const idx = Number(k);
                                    if (idx !== effect.value.versionId && v instanceof Y.Map) {
                                        entries.push([idx, v]);
                                    }
                                });
                                entries.sort((a, b) => a[0] - b[0]);
                                const keysToDelete: string[] = [];
                                versions.forEach((_, k) => keysToDelete.push(k));
                                for (const k of keysToDelete) versions.delete(k);
                                entries.forEach(([, v], i) => versions.set(String(i), v));
                                node.set("activeVersionIndex", ann.activeVersionIndex);
                            }, "local");
                        }
                    }
                }
                // NOTE: Revision version text is owned by the subtree Y.Text
                // (Plan 8.5c-01 wires createYjsBinding there). Structural ops
                // above propagate via the `versions` Y.Map; remote peers rebuild
                // the CM annotation via the observeDeep path.
            }

            destroy() {
                this.destroyed = true;
                scopeAnnotations.unobserveDeep(this.deepObserver);
                // idMap lifecycle is owned by the caller when externally provided;
                // nested editors create their own local maps.
            }
        },
    );
}
