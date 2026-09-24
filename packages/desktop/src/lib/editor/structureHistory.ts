/**
 * structureHistory.ts — Session undo/redo for document structure.
 * Database restores stay separate from draft-scoped CodeMirror history. A depth
 * boundary lets newer prose edits undo before a deletion. Loading another draft
 * resets that boundary; navigation itself is not an undoable content edit.
 */
import { historyField, isolateHistory, redoDepth, undoDepth } from "@codemirror/commands";
import { Transaction } from "@codemirror/state";
import type { EditorView, ViewUpdate } from "@codemirror/view";

export type StructureHistoryEntry = {
    undo: () => Promise<void>;
    redo: () => Promise<void>;
    depth?: number;
};

export class StructureHistory {
    #done: StructureHistoryEntry[] = [];
    #undone: StructureHistoryEntry[] = [];
    #documentId: string | null = null;
    #busy = false;
    #draftId: string | null = null;
    #lastDepth = 0;
    #session = 0;
    #redoGeneration = 0;
    #disposed = false;

    constructor(
        private readonly context: () => {
            documentId: string | null;
            draftId: string | null;
            view: EditorView | null;
        },
        private readonly onError: (error: unknown) => void,
    ) {}

    #syncDocument(): void {
        const { documentId } = this.context();
        if (documentId === this.#documentId) return;
        this.#documentId = documentId;
        this.#session++;
        this.#done = [];
        this.clearRedo();
    }

    #depth(): number {
        const view = this.context().view;
        return view ? undoDepth(view.state) : 0;
    }

    #isolate(): void {
        this.context().view?.dispatch({ annotations: isolateHistory.of("full") });
    }

    clearRedo(): void {
        this.#redoGeneration++;
        this.#undone = [];
    }

    dispose(): void {
        this.#disposed = true;
        this.#session++;
        this.#done = [];
        this.clearRedo();
    }

    record(documentId: string, entry: StructureHistoryEntry): void {
        this.#syncDocument();
        if (this.#disposed || documentId !== this.#documentId) return;
        entry.depth = this.#depth();
        this.#lastDepth = entry.depth;
        this.#done.push(entry);
        this.clearRedo();
        this.#isolate();
    }

    /** Called after a draft load, including a lock-state reload. */
    loaded(): void {
        this.#syncDocument();
        const { draftId } = this.context();
        const depth = this.#depth();
        for (const entry of [...this.#done, ...this.#undone]) {
            // Reconstructed same-draft history may be empty (session-only
            // history policy). Never retain an unreachable pre-load depth.
            entry.depth =
                draftId === this.#draftId
                    ? Math.max(0, (entry.depth ?? 0) + depth - this.#lastDepth)
                    : depth;
        }
        const view = this.context().view;
        const reachableDepth = depth + (view ? redoDepth(view.state) : 0);
        for (const entry of [...this.#done, ...this.#undone]) {
            entry.depth = Math.min(entry.depth ?? 0, reachableDepth);
        }
        this.#draftId = draftId;
        this.#lastDepth = depth;
        this.#isolate();
    }

    observe(update: ViewUpdate): void {
        this.#syncDocument();
        this.#lastDepth = undoDepth(update.state);
        for (const tr of update.transactions) {
            if (tr.isUserEvent("undo") || tr.isUserEvent("redo")) continue;
            const before = undoDepth(tr.startState);
            const after = undoDepth(tr.state);
            if (after < before) {
                // CodeMirror trims old events when a new event exceeds its
                // history limit. Keep the boundary relative to the retained stack.
                const dropped = before + 1 - after;
                for (const entry of [...this.#done, ...this.#undone]) {
                    entry.depth = Math.max(0, (entry.depth ?? 0) - dropped);
                }
            }
        }
        if (
            update.transactions.some(
                (tr) =>
                    tr.annotation(Transaction.addToHistory) !== false &&
                    !tr.isUserEvent("undo") &&
                    !tr.isUserEvent("redo") &&
                    (tr.docChanged ||
                        undoDepth(tr.state) !== undoDepth(tr.startState) ||
                        redoDepth(tr.state) !== redoDepth(tr.startState)),
            )
        )
            this.clearRedo();
    }

    async undo(entry?: StructureHistoryEntry): Promise<boolean> {
        return this.#run(false, entry);
    }

    async redo(): Promise<boolean> {
        return this.#run(true);
    }

    async #run(redo: boolean, requested?: StructureHistoryEntry): Promise<boolean> {
        this.#syncDocument();
        const source = redo ? this.#undone : this.#done;
        const entry = requested ?? source.at(-1);
        // An old toast must not restore a child ahead of its deleted parent.
        if (this.#disposed || !entry || entry !== source.at(-1)) return false;
        if (this.#busy) return true;
        const session = this.#session;
        const redoGeneration = this.#redoGeneration;
        this.#busy = true;
        try {
            await (redo ? entry.redo() : entry.undo());
            // Navigation during IPC must not insert an old document's entry
            // into the new document's history.
            this.#syncDocument();
            if (session !== this.#session || this.#disposed) return true;
            source.splice(source.indexOf(entry), 1);
            entry.depth = this.#depth();
            if (redo) this.#done.push(entry);
            else if (redoGeneration === this.#redoGeneration) this.#undone.push(entry);
            this.#isolate();
        } catch (error) {
            this.onError(error); // Keep the entry available for retry.
        } finally {
            this.#busy = false;
        }
        return true;
    }

    handleKeydown(event: KeyboardEvent): void {
        if (event.defaultPrevented || event.altKey || event.isComposing) return;
        if (!(event.metaKey || event.ctrlKey)) return;
        const key = event.key.toLowerCase();
        if (key !== "z" && key !== "y") return;
        const target = event.target;
        if (target instanceof Element) {
            const editor = target.closest(".cm-editor");
            if (target.closest("input, textarea, select")) return;
            if (!editor && target.closest('[contenteditable]:not([contenteditable="false"])'))
                return;
            const dialog = target.closest('dialog, [role="dialog"]');
            if (dialog && !dialog.hasAttribute("data-editor-history")) return;
            if (!editor && !dialog && target !== document.body && !target.closest(".editor-shell"))
                return;
        }
        this.#syncDocument();
        const view = this.context().view;
        // A Live Room replaces CodeMirror history with Yjs. Its personal undo
        // authority must keep these shortcuts; the explicit toast still works.
        if (view && !view.state.field(historyField, false)) return;
        const redo = key === "y" || event.shiftKey;
        const entry = (redo ? this.#undone : this.#done).at(-1);
        if (!entry) return;
        // Newer typing belongs to CodeMirror until it reaches this boundary.
        if (!this.#busy && this.#depth() !== entry.depth) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        void (redo ? this.redo() : this.undo());
    }

    listen(): () => void {
        const handle = (event: KeyboardEvent) => this.handleKeydown(event);
        // Capture precedes both CodeMirror and the button-focus fallback.
        window.addEventListener("keydown", handle, true);
        return () => {
            window.removeEventListener("keydown", handle, true);
            this.dispose();
        };
    }
}
