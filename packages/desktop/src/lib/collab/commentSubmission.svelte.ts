import type { EditorView } from "@codemirror/view";

type SubmitComment = (annotationId: number, message: string) => Promise<void>;

class CommentSubmission {
    pending = $state(false);
    error = $state<string | null>(null);

    constructor(private readonly submit: (message: string) => Promise<void>) {}

    async send(message: string): Promise<boolean> {
        if (this.pending) return false;
        this.pending = true;
        this.error = null;
        try {
            await this.submit(message);
            return true;
        } catch (error) {
            this.error = error instanceof Error ? error.message : "The comment was not accepted";
            return false;
        } finally {
            this.pending = false;
        }
    }
}

type CommentSubmissions = { submit: SubmitComment; annotations: Map<number, CommentSubmission> };
const submissions = new WeakMap<EditorView, CommentSubmissions>();

export function registerCommentSubmissions(view: EditorView, submit: SubmitComment): () => void {
    submissions.set(view, { submit, annotations: new Map() });
    return () => submissions.delete(view);
}

export function getCommentSubmission(
    view: EditorView | undefined,
    annotationId: number,
): CommentSubmission | undefined {
    const registered = view ? submissions.get(view) : undefined;
    if (!registered) return undefined;
    let submission = registered.annotations.get(annotationId);
    if (!submission) {
        submission = new CommentSubmission((message) => registered.submit(annotationId, message));
        registered.annotations.set(annotationId, submission);
    }
    return submission;
}
