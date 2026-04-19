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
    _updateRevisionVersionDoc,
    _updateRevisionVersionLabel,
    _updateRevisionVersionState,
} from "$lib/editor/plugins/annotations/annotationField";
import {
    isAnnotationOfType,
    type GenericAnnotation,
    type Annotation as AnnotationType,
} from "$lib/editor/plugins/annotations/models";

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
            private clientId = clientId;

            constructor(private view: EditorView) {
                this._syncIdMapFromCM();
                this._syncInitialToYjs(); // Owner: push CM annotations to Yjs
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
                // Skip if this dispatch originated from our observeDeep (avoid infinite loop)
                if (update.transactions.some((tr) => tr.annotation(yjsAnnotationSync))) return;

                // Skip if no annotation effects in this transaction
                // (optimization: avoid diff on pure text changes)
                const hasAnnotationEffect = update.transactions.some((tr) =>
                    tr.effects.some(
                        (e) =>
                            e.is(addAnnotation) ||
                            e.is(removeAnnotation) ||
                            e.is(updateThread) ||
                            e.is(_updateActiveRevisionVersion) ||
                            e.is(_addVersionToRevision) ||
                            e.is(_deleteVersionFromRevision) ||
                            e.is(_updateRevisionVersionDoc) ||
                            e.is(_updateRevisionVersionLabel) ||
                            e.is(_updateRevisionVersionState),
                    ),
                );
                if (!hasAnnotationEffect) return;

                this.diffAndReconcile(update);
            }

            /**
             * Diff CM annotationField against Yjs Y.Map and write delta.
             * Single unified write path - no per-effect branching.
             */
            private diffAndReconcile(update: ViewUpdate) {
                const ydoc = scopeYtext.doc;
                if (!ydoc) return;

                const cmAnns = update.state.field(annotationField);
                const cmIds = new Set(Object.keys(cmAnns).map(Number));

                // Build set of CM IDs currently in Yjs
                const yjsIds = new Set<number>();
                scopeAnnotations.forEach((_node, yjsKey) => {
                    const cmId = this.idMap.getCmId(yjsKey);
                    if (cmId !== undefined) yjsIds.add(cmId);
                });

                ydoc.transact(() => {
                    // 1. Remove from Yjs: in Yjs but not in CM
                    for (const cmId of yjsIds) {
                        if (!cmIds.has(cmId)) {
                            const yjsKey = this.idMap.getYjsId(cmId);
                            if (yjsKey) {
                                scopeAnnotations.delete(yjsKey);
                                this.idMap.remove(yjsKey);
                            }
                        }
                    }

                    // 2. Add to Yjs: in CM but not in Yjs
                    for (const cmId of cmIds) {
                        if (!yjsIds.has(cmId)) {
                            const ann = cmAnns[cmId];
                            if (!ann) continue;

                            const yjsKey = this.idMap.getOrCreateYjsId(cmId, this.clientId);
                            const node = codeMirrorToYjsAnnotation(ann, scopeYtext, this.clientId, ydoc);
                            node.set("id", yjsKey); // Ensure Yjs ID matches the key
                            scopeAnnotations.set(yjsKey, node);
                        }
                    }

                    // 3. Update existing: check for field changes
                    for (const cmId of cmIds) {
                        if (yjsIds.has(cmId)) {
                            const ann = cmAnns[cmId];
                            const yjsKey = this.idMap.getYjsId(cmId);
                            if (!ann || !yjsKey) continue;

                            const node = scopeAnnotations.get(yjsKey);
                            if (!node) continue;

                            this.syncAnnotationFields(ann, node, ydoc);
                        }
                    }
                }, "local");
            }

            /**
             * Sync specific mutable fields from CM annotation to Yjs node.
             * Handles: thread, activeVersionIndex, version text, version label.
             */
            private syncAnnotationFields(
                ann: GenericAnnotation,
                node: YjsAnnotationNode,
                ydoc: Y.Doc,
            ) {
                // Thread sync (all annotation types)
                const threadArr = node.get("thread") as Y.Array<MessageObject> | undefined;
                if (threadArr) {
                    const cmThread = ann.thread;
                    const yjsThread = threadArr.toArray();
                    // Append-only: if CM has more messages, push the new ones
                    if (cmThread.length > yjsThread.length) {
                        const newMessages = cmThread.slice(yjsThread.length);
                        threadArr.push(newMessages.map((m) => ({ ...m })));
                    }
                }

                // Revision-specific fields
                if (isAnnotationOfType(ann, "revision")) {
                    // activeVersionIndex
                    const cmIndex = ann.activeVersionIndex;
                    const yjsIndex = node.get("activeVersionIndex") as number | undefined;
                    if (cmIndex !== yjsIndex) {
                        node.set("activeVersionIndex", cmIndex);
                    }

                    // Version management (add/delete/update)
                    const versionsMap = node.get("versions") as Y.Map<Y.Map<unknown>> | undefined;
                    if (versionsMap) {
                        this.syncRevisionVersions(ann, versionsMap, ydoc);
                    }
                }
            }

            /**
             * Sync revision versions between CM and Yjs.
             * Handles: add version, delete version, version text, version label.
             */
            private syncRevisionVersions(
                ann: AnnotationType<"revision">,
                versionsMap: Y.Map<Y.Map<unknown>>,
                _ydoc: Y.Doc,
            ) {
                const cmVersions = ann.versions;
                const yjsKeys = new Set(versionsMap.keys());

                // Add new versions
                for (let i = 0; i < cmVersions.length; i++) {
                    const key = String(i);
                    if (!yjsKeys.has(key)) {
                        const versionNode = new Y.Map<unknown>();
                        const vtext = new Y.Text();
                        if (cmVersions[i].doc.length > 0) {
                            vtext.insert(0, cmVersions[i].doc);
                        }
                        versionNode.set("text", vtext);
                        if (cmVersions[i].label !== undefined) {
                            versionNode.set("label", cmVersions[i].label);
                        }
                        versionNode.set("annotations", new Y.Map<YjsAnnotationNode>());
                        versionsMap.set(key, versionNode);
                    }
                }

                // Delete removed versions
                for (const key of yjsKeys) {
                    const idx = Number(key);
                    if (idx >= cmVersions.length) {
                        versionsMap.delete(key);
                    }
                }

                // Sync version text and labels
                for (let i = 0; i < cmVersions.length; i++) {
                    const key = String(i);
                    const vNode = versionsMap.get(key);
                    if (!vNode) continue;

                    // Version text - character-level sync
                    const vtext = vNode.get("text") as Y.Text | undefined;
                    if (vtext) {
                        this.syncVersionText(cmVersions[i].doc, vtext);
                    }

                    // Version label
                    const cmLabel = cmVersions[i].label;
                    const yjsLabel = vNode.get("label") as string | undefined;
                    if (cmLabel !== yjsLabel) {
                        if (cmLabel !== undefined) {
                            vNode.set("label", cmLabel);
                        } else if (yjsLabel !== undefined) {
                            vNode.delete("label");
                        }
                    }
                }
            }

            /**
             * Sync version text using character-level diff.
             * Computes minimal diff to preserve CRDT history.
             */
            private syncVersionText(cmText: string, ytext: Y.Text) {
                const yjsText = ytext.toString();
                if (cmText === yjsText) return;

                // Compute minimal diff using prefix/suffix matching
                const minLen = Math.min(cmText.length, yjsText.length);
                let prefix = 0;
                while (prefix < minLen && cmText[prefix] === yjsText[prefix]) prefix++;

                let suffix = 0;
                while (
                    suffix < minLen - prefix &&
                    cmText[cmText.length - 1 - suffix] === yjsText[yjsText.length - 1 - suffix]
                )
                    suffix++;

                const deleteFrom = prefix;
                const deleteTo = yjsText.length - suffix;
                const insertText = cmText.slice(prefix, cmText.length - suffix);

                if (deleteTo > deleteFrom) ytext.delete(deleteFrom, deleteTo - deleteFrom);
                if (insertText) ytext.insert(deleteFrom, insertText);
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
