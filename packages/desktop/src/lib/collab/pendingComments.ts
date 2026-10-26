import type { GenericAnnotation } from "$lib/editor/plugins/annotations/models";
import { EditorSelection } from "@codemirror/state";
import * as Y from "yjs";
import type { RoleContext } from "./roleContext";

type PendingComment = {
    annotation: Extract<GenericAnnotation, { _type: "comment" }>;
    start: Y.RelativePosition;
    end: Y.RelativePosition;
};

export class PendingComments {
    private readonly comments = new Map<string, PendingComment>();
    private readonly listeners = new Set<() => void>();

    constructor(private readonly context: RoleContext) {}

    ids(): Set<number> {
        const ids = new Set<number>();
        for (const key of this.comments.keys()) {
            const id = this.context.ids.getCmId(key);
            if (id !== undefined) ids.add(id);
        }
        return ids;
    }

    has(annotationId: number): boolean {
        const key = this.context.ids.getYjsId(annotationId);
        return key !== undefined && this.comments.has(key);
    }

    add(annotation: PendingComment["annotation"]): void {
        const key = this.context.ids.getOrCreateYjsId(annotation.id, "pending-comment");
        if (this.comments.has(key)) return;
        const range = annotation.selection.main;
        this.comments.set(key, {
            annotation,
            start: Y.createRelativePositionFromTypeIndex(this.context.text, range.from),
            end: Y.createRelativePositionFromTypeIndex(this.context.text, range.to),
        });
        this.publish();
    }

    remove(key: string): void {
        if (!this.comments.delete(key)) return;
        this.context.ids.remove(key);
        this.publish();
    }

    project(): GenericAnnotation[] {
        const doc = this.context.text.doc;
        if (!doc) return [];
        const annotations: GenericAnnotation[] = [];
        for (const [key, comment] of this.comments) {
            const id = this.context.ids.getCmId(key);
            const start = Y.createAbsolutePositionFromRelativePosition(comment.start, doc);
            const end = Y.createAbsolutePositionFromRelativePosition(comment.end, doc);
            if (
                id === undefined ||
                !start ||
                !end ||
                start.type !== this.context.text ||
                end.type !== this.context.text ||
                start.index > end.index
            )
                continue;
            annotations.push({
                ...comment.annotation,
                id,
                selection: EditorSelection.single(start.index, end.index),
            });
        }
        return annotations;
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private publish(): void {
        for (const listener of this.listeners) listener();
    }
}

const scopes = new WeakMap<RoleContext["annotations"], PendingComments>();
export function pendingCommentsFor(context: RoleContext): PendingComments {
    let pending = scopes.get(context.annotations);
    if (!pending) {
        pending = new PendingComments(context);
        scopes.set(context.annotations, pending);
    }
    return pending;
}
