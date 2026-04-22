/**
 * yjsBinding.ts -- Custom Y.Text <-> CodeMirror 6 binding.
 *
 * Per D-72: Build custom binding since y-codemirror.next is unmaintained.
 * Bidirectional sync between Y.Text shared type and CodeMirror EditorState.
 *
 * Key patterns:
 * - Y.Text -> CodeMirror: observe() callback dispatches changes
 * - CodeMirror -> Y.Text: update() handler applies changes in transact()
 * - yjsAnnotation marks remote changes to prevent feedback loops
 * - 'local' origin for UndoManager tracking (per D-74)
 */
import { ViewPlugin, type ViewUpdate, type EditorView } from "@codemirror/view";
import { Annotation, Transaction } from "@codemirror/state";
import type * as Y from "yjs";
import { revisionInternalEdit } from "$lib/editor/plugins/annotations/annotationField";

/** Annotation to mark transactions originating from Y.Text (prevents feedback loop) */
export const yjsAnnotation = Annotation.define<boolean>();

/**
 * Create ViewPlugin for Y.Text <-> CodeMirror sync.
 *
 * @param ytext - Y.Text shared type to sync with
 * @returns ViewPlugin that maintains bidirectional sync
 */
export function createYjsBinding(ytext: Y.Text) {
    return ViewPlugin.fromClass(
        class {
            private observer: (event: Y.YTextEvent, tr: Y.Transaction) => void;
            private destroyed = false;

            constructor(private view: EditorView) {
                // Y.Text -> CodeMirror
                this.observer = (event, yTransaction) => {
                    // Skip if destroyed or if this change originated from CodeMirror (origin === "local")
                    // We use origin-based check instead of yTransaction.local because:
                    // - yTransaction.local is true for ALL changes made in this Y.Doc instance
                    // - origin allows us to distinguish CM-initiated changes from remote sync
                    if (this.destroyed || yTransaction.origin === "local") return;

                    // Yjs delta ops reference positions in the OLD (pre-change)
                    // document. CodeMirror's ChangeSpec also uses OLD coordinates
                    // (from/to). So we advance `pos` for retain AND delete (both
                    // consume old-doc chars), but NOT for insert (inserts produce
                    // new chars without consuming old ones).
                    const changes: { from: number; to: number; insert: string }[] = [];
                    let pos = 0;

                    for (const delta of event.delta) {
                        if (delta.retain !== undefined) {
                            pos += delta.retain;
                        } else if (delta.insert !== undefined) {
                            const text = typeof delta.insert === "string" ? delta.insert : "";
                            changes.push({ from: pos, to: pos, insert: text });
                        } else if (delta.delete !== undefined) {
                            changes.push({ from: pos, to: pos + delta.delete, insert: "" });
                            pos += delta.delete;
                        }
                    }

                    if (changes.length > 0) {
                        // Owner-side invariant: remote-text dispatches must NOT enter CM history
                        // (otherwise owner's Cmd-z replays joiner's edits). See JOINER criterion #7.
                        this.view.dispatch({
                            changes,
                            annotations: [
                                yjsAnnotation.of(true),
                                revisionInternalEdit.of(true),
                                Transaction.addToHistory.of(false),
                            ],
                        });
                    }
                };

                ytext.observe(this.observer);
                queueMicrotask(() => this.syncInitialYText());
            }

            private syncInitialYText() {
                if (this.destroyed) return;
                const authoritativeContent = ytext.toString();
                if (this.view.state.doc.toString() === authoritativeContent) return;

                // If Y.Text was populated before this plugin attached its observer,
                // replay it into CodeMirror as remote sync. This closes the joiner
                // race where provider sync completes with empty text, then the
                // owner's seed update arrives just before binding installation.
                this.view.dispatch({
                    changes: {
                        from: 0,
                        to: this.view.state.doc.length,
                        insert: authoritativeContent,
                    },
                    annotations: [
                        yjsAnnotation.of(true),
                        revisionInternalEdit.of(true),
                        Transaction.addToHistory.of(false),
                    ],
                });
            }

            update(update: ViewUpdate) {
                // CodeMirror -> Y.Text
                // Skip if this transaction came from Y.Text (has yjsAnnotation)
                if (
                    update.docChanged &&
                    !update.transactions.some((tr) => tr.annotation(yjsAnnotation))
                ) {
                    const ydoc = ytext.doc;
                    if (ydoc) {
                        // iterChanges reports fromA/toA in the ORIGINAL document
                        // coordinate space. Y.Text mutations use CURRENT coordinates,
                        // which shift as we mutate. Track the running length delta
                        // from earlier ops and offset each subsequent op by it so
                        // the final Y.Text state matches CodeMirror's B-space.
                        ydoc.transact(() => {
                            let delta = 0;
                            update.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
                                const from = fromA + delta;
                                const len = toA - fromA;
                                if (len > 0) {
                                    ytext.delete(from, len);
                                }
                                const insText = inserted.toString();
                                if (insText.length > 0) {
                                    ytext.insert(from, insText);
                                }
                                delta += insText.length - len;
                            });
                        }, "local"); // Origin for UndoManager (per D-74)
                    }
                }
            }

            destroy() {
                this.destroyed = true;
                ytext.unobserve(this.observer);
            }
        },
    );
}
