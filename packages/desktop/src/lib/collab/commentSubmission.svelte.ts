import type { EditorView } from "@codemirror/view";
import { createSubscriber } from "svelte/reactivity";

import type { CommentOperation } from "./yjsProvider";

type PrepareComment = (annotationId: number, message: string) => CommentOperation;

class SubmissionState {
    pending = $state(false);
    error = $state<string | null>(null);

    private attempt: { message: string; send: CommentOperation } | undefined;

    async send(message: string, prepare: () => CommentOperation): Promise<boolean> {
        if (this.pending) return false;
        this.pending = true;
        this.error = null;
        try {
            if (!this.attempt || this.attempt.message !== message)
                this.attempt = { message, send: prepare() };
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

type SubmissionScope = {
    scope: object;
    keyForAnnotationId: (annotationId: number) => string | undefined;
    onAccepted?: (annotationId: number, target: string) => void;
};
type CommentSubmissions = SubmissionScope & { prepare: PrepareComment };
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
const scopedSubmissions = new WeakMap<object, Map<string, SubmissionState>>();

function registryFor(view: EditorView): SubmissionRegistry {
    let registry = submissions.get(view);
    if (!registry) {
        registry = new SubmissionRegistry();
        submissions.set(view, registry);
    }
    return registry;
}

export function registerCommentSubmissions(
    view: EditorView,
    prepare: PrepareComment,
    target: SubmissionScope,
): () => void {
    const registry = registryFor(view);
    const registration: CommentSubmissions = { prepare, ...target };
    registry.current = registration;
    registry.notify?.();
    return () => {
        if (registry.current !== registration) return;
        registry.current = undefined;
        registry.notify?.();
    };
}

type CommentSubmission = {
    readonly pending: boolean;
    readonly error: string | null;
    send: (message: string) => Promise<boolean>;
};

export function getCommentSubmission(
    view: EditorView | undefined,
    annotationId: number,
): CommentSubmission | undefined {
    const registry = view ? registryFor(view) : undefined;
    registry?.subscribe();
    const registered = registry?.current;
    if (!registered) return undefined;
    const target = registered.keyForAnnotationId(annotationId);
    if (target === undefined) return undefined;
    let annotations = scopedSubmissions.get(registered.scope);
    if (!annotations) {
        annotations = new Map();
        scopedSubmissions.set(registered.scope, annotations);
    }
    let submission = annotations.get(target);
    if (!submission) {
        submission = new SubmissionState();
        annotations.set(target, submission);
    }
    const state = submission;
    return {
        get pending() {
            return state.pending;
        },
        get error() {
            return state.error;
        },
        async send(message): Promise<boolean> {
            if (registered.keyForAnnotationId(annotationId) !== target) return false;
            const accepted = await state.send(message, () =>
                registered.prepare(annotationId, message),
            );
            if (!accepted || registered.keyForAnnotationId(annotationId) !== target) return false;
            registered.onAccepted?.(annotationId, target);
            return true;
        },
    };
}
