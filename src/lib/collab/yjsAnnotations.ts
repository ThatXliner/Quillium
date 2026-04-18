/**
 * yjsAnnotations.ts -- Bidirectional Y.Map <-> annotationField sync.
 *
 * Per SYNC-05: Annotations sync between collaborators via Yjs shared types.
 *
 * Architecture:
 * - Y.Map stores YjsAnnotation objects with RelativePosition anchors
 * - CodeMirror annotationField stores GenericAnnotation with EditorSelection
 * - This ViewPlugin bridges the two with bidirectional sync
 *
 * Origin tracking:
 * - Y.Map changes with origin "local" are CM-originated (skip in observer)
 * - CM transactions with yjsAnnotationSync annotation are Yjs-originated (skip in update)
 *
 * Revision sync:
 * - Internal revision effects (_updateActiveRevisionVersion, _addVersionToRevision, etc.)
 *   are NOT exported from annotationField.ts. Instead, syncRevisionChanges() detects
 *   changes by comparing old/new annotationField state on every docChanged transaction.
 * - The Y.Map observer handles incoming revision updates from remote peers via
 *   the existing "update" action path (remove + re-add with updated data).
 *
 * Threat mitigations:
 *   T-08-03: yjsAnnotationToCodeMirror validates and converts; null returned for invalid data
 *   T-08-05: JSON.parse for remote versions wrapped in try-catch; malformed returns empty array
 *   T-08-06: Remote activeVersionIndex bounds-checked against versions array length
 *
 * Key dependencies:
 *   - yjs for Y.Map, Y.Doc
 *   - @codemirror/view for ViewPlugin
 *   - ./annotationSchema for converters and ID mapping
 *   - ../editor/plugins/annotations/annotationField for StateEffects
 */
import { ViewPlugin, type ViewUpdate, type EditorView } from "@codemirror/view";
import { Annotation } from "@codemirror/state";
import type * as Y from "yjs";
import {
    codeMirrorToYjsAnnotation,
    yjsAnnotationToCodeMirror,
    AnnotationIdMap,
} from "./annotationSchema";
import type { YjsAnnotation } from "./types";
import {
    addAnnotation,
    removeAnnotation,
    updateThread,
    annotationField,
} from "$lib/editor/plugins/annotations/annotationField";
import { isAnnotationOfType } from "$lib/editor/plugins/annotations/models";

/** Annotation to mark transactions originating from Y.Map sync (prevents feedback loop) */
export const yjsAnnotationSync = Annotation.define<boolean>();

/**
 * Create ViewPlugin for Y.Map <-> annotationField sync.
 *
 * @param ytext - Y.Text for RelativePosition resolution
 * @param ymap - Y.Map<YjsAnnotation> to sync with
 * @param clientId - Client ID for annotation ID generation
 * @returns ViewPlugin that maintains bidirectional sync
 */
export function createAnnotationSyncPlugin(
    ytext: Y.Text,
    ymap: Y.Map<YjsAnnotation>,
    clientId: string,
) {
    return ViewPlugin.fromClass(
        class {
            private observer: (event: Y.YMapEvent<YjsAnnotation>, tr: Y.Transaction) => void;
            private destroyed = false;
            private idMap = new AnnotationIdMap();

            constructor(private view: EditorView) {
                // Initialize ID map from current CM annotations
                this._syncIdMapFromCM();

                // Y.Map -> CodeMirror
                this.observer = (event, yTransaction) => {
                    // Skip if destroyed or if this change originated from CM (origin === "local")
                    // 'local' origin is set by codeMirrorToYjsAnnotation paths to prevent loops
                    if (this.destroyed || yTransaction.origin === "local") return;

                    const ydoc = ytext.doc;
                    if (!ydoc) return;

                    const effects: (
                        | ReturnType<typeof addAnnotation.of>
                        | ReturnType<typeof removeAnnotation.of>
                    )[] = [];

                    for (const key of event.keysChanged) {
                        const change = event.changes.keys.get(key);
                        if (!change) continue;

                        if (change.action === "add" || change.action === "update") {
                            const yjsAnn = ymap.get(key);
                            if (!yjsAnn) continue;

                            const cmId = this.idMap.getOrCreateCmId(key);
                            const cmAnn = yjsAnnotationToCodeMirror(yjsAnn, ydoc, ytext, cmId);

                            if (cmAnn) {
                                // Check if this is an update (annotation exists) or add
                                const currentAnnotations = this.view.state.field(annotationField);
                                if (currentAnnotations[cmId]) {
                                    // Update: remove old, add new
                                    effects.push(removeAnnotation.of(currentAnnotations[cmId]));
                                }
                                effects.push(addAnnotation.of(cmAnn));
                            }
                        } else if (change.action === "delete") {
                            const cmId = this.idMap.getCmId(key);
                            if (cmId !== undefined) {
                                const currentAnnotations = this.view.state.field(annotationField);
                                const existingAnn = currentAnnotations[cmId];
                                if (existingAnn) {
                                    effects.push(removeAnnotation.of(existingAnn));
                                }
                                this.idMap.remove(key);
                            }
                        }
                    }

                    if (effects.length > 0) {
                        this.view.dispatch({
                            effects,
                            annotations: [yjsAnnotationSync.of(true)],
                        });
                    }
                };

                ymap.observe(this.observer);
            }

            private _syncIdMapFromCM() {
                const annotations = this.view.state.field(annotationField);
                // On initial load, existing annotations need Yjs IDs registered
                // This handles the case where local annotations exist before collab starts
                for (const idStr of Object.keys(annotations)) {
                    const cmId = Number(idStr);
                    // Generate a stable Yjs ID based on client and local ID
                    const yjsId = `${clientId}-init-${cmId}`;
                    this.idMap.register(yjsId, cmId);
                }
            }

            update(update: ViewUpdate) {
                // CodeMirror -> Y.Map
                // Skip if this transaction came from Y.Map sync (yjsAnnotationSync marked)
                if (update.transactions.some((tr) => tr.annotation(yjsAnnotationSync))) {
                    return;
                }

                const ydoc = ytext.doc;
                if (!ydoc) return;

                for (const tr of update.transactions) {
                    for (const effect of tr.effects) {
                        if (effect.is(addAnnotation)) {
                            const ann = effect.value;
                            // Check if we already have a Yjs ID for this annotation
                            let yjsId = this.idMap.getYjsId(ann.id);
                            if (!yjsId) {
                                // New local annotation - generate Yjs ID
                                yjsId = `${clientId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                                this.idMap.register(yjsId, ann.id);
                            }

                            const yjsAnn = codeMirrorToYjsAnnotation(ann, ytext, clientId);
                            // Override the auto-generated ID with our tracked Yjs ID
                            yjsAnn.id = yjsId;

                            const capturedYjsId = yjsId;
                            ydoc.transact(() => {
                                ymap.set(capturedYjsId, yjsAnn);
                            }, "local"); // 'local' origin tells observer to skip this
                        } else if (effect.is(removeAnnotation)) {
                            const ann = effect.value;
                            const yjsId = this.idMap.getYjsId(ann.id);
                            if (yjsId) {
                                const capturedYjsId = yjsId;
                                ydoc.transact(() => {
                                    ymap.delete(capturedYjsId);
                                }, "local");
                                this.idMap.remove(yjsId);
                            }
                        } else if (effect.is(updateThread)) {
                            const { annotationId, newThread } = effect.value;
                            const yjsId = this.idMap.getYjsId(annotationId);
                            if (yjsId) {
                                const existing = ymap.get(yjsId);
                                if (existing) {
                                    const capturedYjsId = yjsId;
                                    ydoc.transact(() => {
                                        ymap.set(capturedYjsId, {
                                            ...existing,
                                            thread: JSON.stringify(newThread),
                                        });
                                    }, "local");
                                }
                            }
                        }
                    }
                }

                // Detect revision-specific changes not covered by explicit effects:
                // - Internal effects (_updateActiveRevisionVersion, _addVersionToRevision, etc.)
                //   are not exported, so we compare old vs new annotation state.
                // - Phase 3 of annotationField also updates versions[active].doc from doc text.
                if (update.docChanged) {
                    this.syncRevisionChanges(update, ydoc);
                }
            }

            /**
             * Detect and sync revision changes that result from internal StateEffects
             * (version switches, new versions, Phase 3 doc-text pulls) which are not
             * exported and thus not catchable via effect.is() in update().
             *
             * Compares old and new annotationField state for each revision and pushes
             * changed activeVersionIndex or versions array to Y.Map.
             *
             * T-08-05 / T-08-06: Remote values are validated before use in the observer;
             * here we only write local (trusted) values to Y.Map.
             */
            private syncRevisionChanges(update: ViewUpdate, ydoc: Y.Doc) {
                const oldAnnotations = update.startState.field(annotationField);
                const newAnnotations = update.state.field(annotationField);

                for (const [idStr, newAnn] of Object.entries(newAnnotations)) {
                    if (!isAnnotationOfType(newAnn, "revision")) continue;

                    const cmId = Number(idStr);
                    const yjsId = this.idMap.getYjsId(cmId);
                    if (!yjsId) continue;

                    const existing = ymap.get(yjsId);
                    if (!existing) continue;

                    const oldAnn = oldAnnotations[cmId];
                    if (!oldAnn || !isAnnotationOfType(oldAnn, "revision")) continue;

                    const indexChanged = newAnn.activeVersionIndex !== oldAnn.activeVersionIndex;
                    // Compare versions as JSON strings — a structural equality check.
                    // This is safe because VersionState contains only plain JSON-serializable values.
                    const versionsChanged =
                        JSON.stringify(newAnn.versions) !== JSON.stringify(oldAnn.versions);

                    if (indexChanged || versionsChanged) {
                        const capturedYjsId = yjsId;
                        const capturedVersions = JSON.stringify(newAnn.versions);
                        const capturedIndex = newAnn.activeVersionIndex;
                        ydoc.transact(() => {
                            ymap.set(capturedYjsId, {
                                ...existing,
                                versions: capturedVersions,
                                activeVersionIndex: capturedIndex,
                            });
                        }, "local");
                    }
                }
            }

            destroy() {
                this.destroyed = true;
                ymap.unobserve(this.observer);
                this.idMap.clear();
            }
        },
    );
}
