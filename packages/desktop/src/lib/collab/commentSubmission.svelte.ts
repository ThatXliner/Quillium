import type { EditorView } from "@codemirror/view";
import { createSubscriber } from "svelte/reactivity";

import type { CommentOperation } from "./yjsProvider";

type PrepareComment = (annotationId: number, message: string) => CommentOperation;

class CommentSubmission {
    pending = $state(false);
    error = $state<string | null>(null);

    private attempt: { message: string; send: CommentOperation } | undefined;

    constructor(private readonly prepare: (message: string) => CommentOperation) {}

    async send(message: string): Promise<boolean> {
        if (this.pending) return false;
        this.pending = true;
        this.error = null;
        try {
            if (!this.attempt || this.attempt.message !== message)
                this.attempt = { message, send: this.prepare(message) };
            await this.attempt.send();
            this.attempt = undefined;
            return true;
        } catch (error) {
            this.error = error instanceof Error ? error.message : "The comment was not accepted";
            return false;
        } finally {
            this.pending = false;
        }
    }
}

type CommentSubmissions = { prepare: PrepareComment; annotations: Map<number, CommentSubmission> };
class SubmissionRegistry {
    current: CommentSubmissions | undefined;
    notify: (() => void) | undefined;
    readonly subscribe = createSubscriber((update) => {
        this.notify = update;
        return () => {
            this.notify = undefined;
        };
    });
}
const submissions = new WeakMap<EditorView, SubmissionRegistry>();

function registryFor(view: EditorView): SubmissionRegistry {
    let registry = submissions.get(view);
    if (!registry) {
        registry = new SubmissionRegistry();
        submissions.set(view, registry);
    }
    return registry;
}

export function registerCommentSubmissions(view: EditorView, prepare: PrepareComment): () => void {
    const registry = registryFor(view);
    const registration: CommentSubmissions = { prepare, annotations: new Map() };
    registry.current = registration;
    registry.notify?.();
    return () => {
        if (registry.current !== registration) return;
        registry.current = undefined;
        registry.notify?.();
    };
}

export function getCommentSubmission(
    view: EditorView | undefined,
    annotationId: number,
): CommentSubmission | undefined {
    const registry = view ? registryFor(view) : undefined;
    registry?.subscribe();
    const registered = registry?.current;
    if (!registered) return undefined;
    let submission = registered.annotations.get(annotationId);
    if (!submission) {
        submission = new CommentSubmission((message) => registered.prepare(annotationId, message));
        registered.annotations.set(annotationId, submission);
    }
    return submission;
}
