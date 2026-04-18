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
import { Annotation } from "@codemirror/state";
import type * as Y from "yjs";

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

                    const changes: { from: number; to: number; insert: string }[] = [];
                    let pos = 0;

                    for (const delta of event.delta) {
                        if (delta.retain !== undefined) {
                            pos += delta.retain;
                        } else if (delta.insert !== undefined) {
                            const text = typeof delta.insert === "string" ? delta.insert : "";
                            changes.push({ from: pos, to: pos, insert: text });
                            pos += text.length;
                        } else if (delta.delete !== undefined) {
                            changes.push({ from: pos, to: pos + delta.delete, insert: "" });
                        }
                    }

                    if (changes.length > 0) {
                        this.view.dispatch({
                            changes,
                            annotations: [yjsAnnotation.of(true)],
                        });
                    }
                };

                ytext.observe(this.observer);
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
                        ydoc.transact(() => {
                            update.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
                                // Delete first, then insert at the same position
                                if (toA > fromA) {
                                    ytext.delete(fromA, toA - fromA);
                                }
                                if (inserted.length > 0) {
                                    ytext.insert(fromA, inserted.toString());
                                }
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
