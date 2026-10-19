/**
 * structureHistory.ts — Session undo/redo for document structure.
 * Database restores stay separate from draft-scoped CodeMirror history. A depth
 * boundary lets newer prose edits undo before a deletion. Loading another draft
 * resets that boundary; navigation itself is not an undoable content edit.
 */
import { historyField, isolateHistory, redoDepth, undoDepth } from "@codemirror/commands";
import { Transaction } from "@codemirror/state";
import type { EditorView, ViewUpdate } from "@codemirror/view";
import { historyKeyDirection, historyTarget } from "./historyShortcuts";

export type StructureHistoryEntry = {
    readonly undo: () => Promise<void>;
    readonly redo: () => Promise<void>;
};

type HistoryBoundary = { entry: StructureHistoryEntry; depth: number };

export class StructureHistory {
    #done: HistoryBoundary[] = [];
    #undone: HistoryBoundary[] = [];
    #documentId: string | null = null;
    #operation: { session: number } | null = null;
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
        private readonly onInvalidate: () => void = () => {},
    ) {}

    #syncDocument(): void {
        const { documentId } = this.context();
        if (documentId === this.#documentId) return;
        this.#documentId = documentId;
        this.#session++;
        this.#done = [];
        this.onInvalidate();
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
        this.onInvalidate();
        this.clearRedo();
    }

    record(documentId: string, entry: StructureHistoryEntry): void {
        this.#syncDocument();
        if (this.#disposed || documentId !== this.#documentId) return;
        const depth = this.#depth();
        this.#lastDepth = depth;
        this.#done.push({ entry, depth });
        this.clearRedo();
        this.#isolate();
    }

    loaded(): void {
        this.#syncDocument();
        const { draftId } = this.context();
        const depth = this.#depth();
        for (const entry of [...this.#done, ...this.#undone]) {
            // Reconstructed same-draft history may be empty (session-only
            // history policy). Never retain an unreachable pre-load depth.
            entry.depth =
                draftId === this.#draftId
                    ? Math.max(0, entry.depth + depth - this.#lastDepth)
                    : depth;
        }
        const view = this.context().view;
        const reachableDepth = depth + (view ? redoDepth(view.state) : 0);
        for (const entry of [...this.#done, ...this.#undone]) {
            entry.depth = Math.min(entry.depth, reachableDepth);
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
                    entry.depth = Math.max(0, entry.depth - dropped);
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

    async perform(operation: () => Promise<void>): Promise<boolean> {
        this.#syncDocument();
        if (this.#disposed || this.#operation) return false;
        const owner = { session: this.#session };
        this.#operation = owner;
        try {
            await operation();
        } finally {
            if (this.#operation === owner) this.#operation = null;
        }
        return true;
    }

    async undo(entry?: StructureHistoryEntry): Promise<boolean> {
        return this.#run(false, entry);
    }

    async redo(): Promise<boolean> {
        return this.#run(true);
    }

    async #run(redo: boolean, requested?: StructureHistoryEntry): Promise<boolean> {
        this.#syncDocument();
        if (this.#operation) return true;
        const source = redo ? this.#undone : this.#done;
        const boundary = source.at(-1);
        // An old toast must not restore a child ahead of its deleted parent.
        if (this.#disposed || !boundary || (requested && requested !== boundary.entry))
            return false;
        const redoGeneration = this.#redoGeneration;
        const locked = this.context().view?.state.readOnly ?? false;
        const owner = { session: this.#session };
        this.#operation = owner;
        try {
            await (redo ? boundary.entry.redo() : boundary.entry.undo());
            this.#syncDocument();
            if (owner.session !== this.#session || this.#disposed) return true;
            source.splice(source.indexOf(boundary), 1);
            // Locked prose cannot undo to the boundary until it is unlocked.
            if (!locked) boundary.depth = this.#depth();
            if (redo) this.#done.push(boundary);
            else if (redoGeneration === this.#redoGeneration) this.#undone.push(boundary);
            this.#isolate();
        } catch (error) {
            this.onError(error);
        } finally {
            if (this.#operation === owner) this.#operation = null;
        }
        return true;
    }

    #request(event: Event, direction: "undo" | "redo"): void {
        if (event.defaultPrevented) return;
        const view = this.context().view;
        if (!historyTarget(event.target, view)) return;
        // Live Rooms retain their installed Yjs authority.
        if (view && !view.state.field(historyField, false)) return;
        this.#syncDocument();
        const boundary = (direction === "redo" ? this.#undone : this.#done).at(-1);
        if (!this.#operation) {
            if (!boundary || (!view?.state.readOnly && this.#depth() !== boundary.depth)) return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!this.#operation) void (direction === "redo" ? this.redo() : this.undo());
    }

    handleKeydown(event: KeyboardEvent): void {
        const direction = historyKeyDirection(event);
        if (direction) this.#request(event, direction);
    }

    handleBeforeinput(event: InputEvent): void {
        if (event.isComposing) return;
        if (event.inputType === "historyUndo") this.#request(event, "undo");
        if (event.inputType === "historyRedo") this.#request(event, "redo");
    }

    listen(): () => void {
        const handle = (event: KeyboardEvent) => this.handleKeydown(event);
        const beforeinput = (event: InputEvent) => this.handleBeforeinput(event);
        // Capture precedes both CodeMirror and the button-focus fallback.
        window.addEventListener("keydown", handle, true);
        window.addEventListener("beforeinput", beforeinput, true);
        return () => {
            window.removeEventListener("keydown", handle, true);
            window.removeEventListener("beforeinput", beforeinput, true);
            this.dispose();
        };
    }
}
