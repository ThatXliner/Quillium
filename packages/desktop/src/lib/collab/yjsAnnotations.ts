import {
    _addVersionToRevision,
    _deleteVersionFromRevision,
    _updateActiveRevisionVersion,
    _updateRevisionVersionDoc,
    _updateRevisionVersionLabel,
    _updateRevisionVersionState,
    addAnnotation,
    annotationField,
    nestedEditorEdit,
    removeAnnotation,
    updateThread,
} from "$lib/editor/plugins/annotations/annotationField";
import {
    type Annotation as AnnotationType,
    type GenericAnnotation,
    type ThreadMessage,
    activeVersionIndex,
    isAnnotationOfType,
} from "$lib/editor/plugins/annotations/models";
import { Annotation, Transaction } from "@codemirror/state";
/**
 * yjsAnnotations.ts -- Yjs <-> CodeMirror annotation sync plugin (scoped).
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  CANONICAL-SOURCE INVARIANT (v1.1)
 * ─────────────────────────────────────────────────────────────────────────
 *  Yjs is canonical. The CodeMirror `annotationField` is a DERIVED PROJECTION
 *  of the Yjs `annotations` Y.Map. Reads of annotation state for sync purposes
 *  go through `yjsAnnotationToCodeMirror(yMap)`; user writes go through Yjs first
 *  inside `ydoc.transact(fn, "local")` and the CM dispatch is the projection.
 *  Owner bootstrap data uses the untracked `"init"` origin.
 *
 *  This file does NOT enforce that contract for the entire codebase yet (Phases
 *  3–5 do that). It is the SOLE writer of `annotationField` on the read path
 *  and it MUST never write to Yjs from inside an observer callback. The Phase 1
 *  convergence property test (HARNESS-02) is the runtime enforcement of the
 *  projection invariant.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  FOUR-GUARD ORIGIN DISCIPLINE
 * ─────────────────────────────────────────────────────────────────────────
 *  Feedback loops between CM transactions and Y updates are prevented by four
 *  guard sites that MUST stay in lockstep. If any guard is removed or its
 *  predicate weakened, expect O(N²) relay traffic and the SYNC-06 feedback-
 *  loop test to fail loudly.
 *
 *    Guard 1 -- src/lib/collab/yjsBinding.ts:39 (Y.Text observer)
 *      Skips the CM dispatch when `yTransaction.origin === "local"` (the write
 *      came from this peer's CM binding, not from a remote update).
 *
 *    Guard 2 -- src/lib/collab/yjsAnnotations.ts:74 (Y.Map observer, this file)
 *      Same shape: skips CM dispatch when `tr.origin === "local"`.
 *
 *    Guard 3 -- src/lib/collab/yjsAnnotations.ts:254 (CM update listener, this file)
 *      Skips Y.Map writes when the CM transaction carries the
 *      `yjsAnnotationSync` annotation (i.e., the transaction was DISPATCHED BY
 *      Guard 2's projection, so writing back to Y would echo).
 *
 *    Guard 4 -- src/lib/collab/yjsBinding.ts:77 (CM update listener, Y.Text side)
 *      Same shape on the Y.Text side: skips Y.Text writes when the CM
 *      transaction is itself a remote-applied projection (carries the
 *      `yjsAnnotation` marker).
 *
 *  Run `grep -n 'origin === "local"' src/lib/collab/{yjsBinding,yjsAnnotations}.ts`
 *  and `grep -n 'yjsAnnotationSync' src/lib/collab/yjsAnnotations.ts` to locate
 *  the live guard sites. Phase 3 may move them; update the line refs above when
 *  it does. The COUNT (four) and the SHAPE (two origin-skips on each side, two
 *  annotation-skips on each side) is the invariant; the line numbers are for
 *  navigation, not enforcement.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  Role / dependency notes (preserved from prior comment block):
 *
 *  Per D-90/D-92: Annotations are recursive Y.Map nodes; this plugin syncs
 *  ONE scope (pair of Y.Text + Y.Map) to a CodeMirror EditorView. Plan 8.5c-01
 *  mounts an instance per nested editor subtree.
 *  Per D-93: Comment threads are Y.Array (append-only); Y.Array.push is the
 *  mutation primitive.
 *  Per #269: Revision versions are id-native in Yjs. The versions map is keyed
 *  by VersionState.id, `order` stores display order, and `activeVersionId` is
 *  the active pointer. The read path still tolerates older index-keyed rooms.
 *
 *  Origin tagging:
 *    - ydoc.transact(..., "local")  : user writes this plugin originated
 *    - ydoc.transact(..., "init")   : owner bootstrap writes (not undoable)
 *    - Transactions tagged with yjsAnnotationSync(true) : dispatches this plugin
 *      originated on the CM side (skip to avoid loops)
 *
 *  Threat mitigations:
 *    T-08.5-03-01: Observer ignores any event whose tr.origin === "local".
 *    T-08.5-03-02: Remote payloads pass through yjsAnnotationToCodeMirror which
 *                  returns null on malformed data; null entries are skipped.
 */
import { type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import * as Y from "yjs";
import {
    AnnotationIdMap,
    codeMirrorToYjsAnnotation,
    getRawAnnotationField,
    syncRawAnnotationsToYjsMap,
    yjsAnnotationToCodeMirror,
} from "./annotationSchema";
import { absoluteToRelative } from "./relativePosition";
import type { YjsAnnotationNode } from "./types";

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
            private nestedIdMaps = new WeakMap<Y.Map<YjsAnnotationNode>, AnnotationIdMap>();
            private nestedIdMapFor = (annotations: Y.Map<YjsAnnotationNode>): AnnotationIdMap => {
                let idMap = this.nestedIdMaps.get(annotations);
                if (!idMap) {
                    idMap = new AnnotationIdMap();
                    this.nestedIdMaps.set(annotations, idMap);
                }
                return idMap;
            };
            private clientId = clientId;
            private _initialSyncDone = false;
            private deepObserverAttached = false;

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
                            const threadArr = ev.target as Y.Array<ThreadMessage>;
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
                            const rebuilt = yjsAnnotationToCodeMirror(
                                node,
                                ydoc,
                                scopeYtext,
                                cmId,
                                { nestedIdMapFor: this.nestedIdMapFor },
                            );
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

                this._attachDeepObserverAfterInitialPull();
            }

            private _attachDeepObserverAfterInitialPull(): void {
                // RESEARCH §4 fix (b): attach deepObserver only AFTER the initial
                // pull microtask completes; otherwise a remote update arriving
                // between mount and the pull microtask races _syncInitialFromYjs
                // and produces 2x annotations on the joiner. See JOINER-05.
                queueMicrotask(() => {
                    if (this.destroyed) return;
                    scopeAnnotations.observeDeep(this.deepObserver);
                    this.deepObserverAttached = true;
                    this._syncInitialFromYjs();
                });
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
                if (this._initialSyncDone) return;
                this._initialSyncDone = true;

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

                            const node = codeMirrorToYjsAnnotation(
                                ann,
                                scopeYtext,
                                clientId,
                                ydoc,
                                { nestedIdMapFor: this.nestedIdMapFor },
                            );
                            node.set("id", yjsId);
                            scopeAnnotations.set(yjsId, node);
                            this.syncAnnotationFields(ann, node, ydoc);
                        }
                    }, "init");
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
                        const ann = yjsAnnotationToCodeMirror(node, ydoc, scopeYtext, cmId, {
                            nestedIdMapFor: this.nestedIdMapFor,
                        });
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

                // Check for nested editor edits (Phase 3 pulls doc text without an effect)
                const hasNestedEditorEdit = update.transactions.some(
                    (tr) => tr.annotation(nestedEditorEdit) !== undefined,
                );

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
                if (!hasAnnotationEffect && !hasNestedEditorEdit) return;

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
                            const node = codeMirrorToYjsAnnotation(
                                ann,
                                scopeYtext,
                                this.clientId,
                                ydoc,
                                { nestedIdMapFor: this.nestedIdMapFor },
                            );
                            node.set("id", yjsKey); // Ensure Yjs ID matches the key
                            scopeAnnotations.set(yjsKey, node);
                            this.syncAnnotationFields(ann, node, ydoc);
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
             * Handles: status, thread, activeVersionId, version order, version text, version label.
             */
            private syncAnnotationFields(
                ann: GenericAnnotation,
                node: YjsAnnotationNode,
                ydoc: Y.Doc,
            ) {
                this.syncAnnotationPositions(ann, node);

                if (node.get("status") !== ann.status) {
                    node.set("status", ann.status);
                }

                // Thread sync (all annotation types)
                const threadArr = node.get("thread") as Y.Array<ThreadMessage> | undefined;
                if (threadArr) {
                    const cmThread = ann.thread;
                    const yjsThread = threadArr.toArray();
                    // Append-only: if CM has more messages, push the new ones
                    if (cmThread.length > yjsThread.length) {
                        const newMessages = cmThread.slice(yjsThread.length);
                        threadArr.push(newMessages.map((m) => ({ ...m })));
                    } else if (cmThread.length < yjsThread.length) {
                        threadArr.delete(0, threadArr.length);
                        if (cmThread.length > 0) {
                            threadArr.push(cmThread.map((m) => ({ ...m })));
                        }
                    }
                }

                // Revision-specific fields
                if (isAnnotationOfType(ann, "revision")) {
                    const cmActiveVersionId = ann.versions.some((v) => v.id === ann.activeVersionId)
                        ? ann.activeVersionId
                        : ann.versions[0]?.id;
                    const yjsActiveVersionId = node.get("activeVersionId") as string | undefined;
                    if (
                        cmActiveVersionId !== undefined &&
                        cmActiveVersionId !== yjsActiveVersionId
                    ) {
                        node.set("activeVersionId", cmActiveVersionId);
                    }
                    if (node.get("activeVersionIndex") !== undefined) {
                        node.delete("activeVersionIndex");
                    }

                    // Version management (add/delete/update)
                    const versionsMap = node.get("versions") as Y.Map<Y.Map<unknown>> | undefined;
                    if (versionsMap) {
                        this.syncRevisionVersions(ann, node, versionsMap, ydoc);
                    }
                }
            }

            private syncAnnotationPositions(ann: GenericAnnotation, node: YjsAnnotationNode) {
                if (ann.selection.main.to > scopeYtext.length) return;

                const { startPos, endPos } = absoluteToRelative(scopeYtext, ann.selection);
                const currentStart = node.get("startPos");
                const currentEnd = node.get("endPos");

                if (!(currentStart instanceof Uint8Array) || !equalUint8(currentStart, startPos)) {
                    node.set("startPos", startPos);
                }
                if (!(currentEnd instanceof Uint8Array) || !equalUint8(currentEnd, endPos)) {
                    node.set("endPos", endPos);
                }
            }

            /**
             * Sync revision versions between CM and Yjs.
             * Handles: add version, delete version, version text, version label.
             */
            private syncRevisionVersions(
                ann: AnnotationType<"revision">,
                node: YjsAnnotationNode,
                versionsMap: Y.Map<Y.Map<unknown>>,
                ydoc: Y.Doc,
            ) {
                const cmVersions = ann.versions;
                const cmVersionIds = new Set(cmVersions.map((version) => version.id));
                const yjsKeys = new Set(versionsMap.keys());

                // Add new versions
                for (const version of cmVersions) {
                    if (!yjsKeys.has(version.id)) {
                        versionsMap.set(version.id, createYjsVersionNode(version));
                    }
                }

                // Delete removed versions
                for (const key of yjsKeys) {
                    if (!cmVersionIds.has(key)) {
                        versionsMap.delete(key);
                    }
                }

                this.syncVersionOrder(
                    node,
                    cmVersions.map((version) => version.id),
                );

                // Sync version text, labels, and nested annotation maps
                for (const version of cmVersions) {
                    const vNode = versionsMap.get(version.id);
                    if (!vNode) continue;
                    if (vNode.get("id") !== version.id) {
                        vNode.set("id", version.id);
                    }

                    // Version text - character-level sync
                    const vtext = vNode.get("text") as Y.Text | undefined;
                    if (vtext) {
                        this.syncVersionText(version.doc, vtext);
                    }

                    // Version label
                    const cmLabel = version.label;
                    const yjsLabel = vNode.get("label") as string | undefined;
                    if (cmLabel !== yjsLabel) {
                        if (cmLabel !== undefined) {
                            vNode.set("label", cmLabel);
                        } else if (yjsLabel !== undefined) {
                            vNode.delete("label");
                        }
                    }

                    let nestedAnnotations = vNode.get("annotations");
                    if (!(nestedAnnotations instanceof Y.Map)) {
                        nestedAnnotations = new Y.Map<YjsAnnotationNode>();
                        vNode.set("annotations", nestedAnnotations);
                    }
                    if (vtext) {
                        syncRawAnnotationsToYjsMap(
                            getRawAnnotationField(version),
                            nestedAnnotations as Y.Map<YjsAnnotationNode>,
                            vtext,
                            this.clientId,
                            ydoc,
                            this.nestedIdMapFor(nestedAnnotations as Y.Map<YjsAnnotationNode>),
                            { nestedIdMapFor: this.nestedIdMapFor },
                        );
                    }
                }
            }

            private syncVersionOrder(node: YjsAnnotationNode, desiredOrder: string[]): void {
                const existingOrder = node.get("order");
                const order =
                    existingOrder instanceof Y.Array
                        ? (existingOrder as Y.Array<string>)
                        : new Y.Array<string>();
                if (!(existingOrder instanceof Y.Array)) {
                    node.set("order", order);
                }

                const yjsOrder = order.toArray();
                if (arraysEqual(yjsOrder, desiredOrder)) return;

                if (order.length > 0) {
                    order.delete(0, order.length);
                }
                if (desiredOrder.length > 0) {
                    order.push(desiredOrder);
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
                if (this.deepObserverAttached) {
                    scopeAnnotations.unobserveDeep(this.deepObserver);
                }
                // idMap lifecycle is owned by the caller when externally provided;
                // nested editors create their own local maps.
            }
        },
    );
}

function equalUint8(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

function arraysEqual<T>(a: T[], b: T[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

function createYjsVersionNode(version: AnnotationType<"revision">["versions"][number]) {
    const versionNode = new Y.Map<unknown>();
    const vtext = new Y.Text();
    if (version.doc.length > 0) {
        vtext.insert(0, version.doc);
    }
    versionNode.set("id", version.id);
    versionNode.set("text", vtext);
    if (version.label !== undefined) {
        versionNode.set("label", version.label);
    }
    versionNode.set("annotations", new Y.Map<YjsAnnotationNode>());
    return versionNode;
}
