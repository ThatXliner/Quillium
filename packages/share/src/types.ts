export type SerializedThreadMessage = {
    message: string;
    author: string;
    time: number;
};

export type SerializedAnnotationBase = {
    id: string;
    type: "comment" | "suggestion" | "revision";
    from: number;
    to: number;
    selectedText: string;
    thread: SerializedThreadMessage[];
};

export type SerializedCommentAnnotation = SerializedAnnotationBase & {
    type: "comment";
};

export type SerializedSuggestionAnnotation = SerializedAnnotationBase & {
    type: "suggestion";
    replacements: { text: string; rationale?: string }[];
    author?: string;
};

export type SerializedRevisionAnnotation = SerializedAnnotationBase & {
    type: "revision";
    activeVersionIndex: number;
    versions: {
        index: number;
        text: string;
        label?: string;
        annotations: SerializedAnnotation[];
    }[];
};

export type SerializedAnnotation =
    | SerializedCommentAnnotation
    | SerializedSuggestionAnnotation
    | SerializedRevisionAnnotation;

export type ReadonlyShareDocument = {
    token: string;
    title: string;
    excerpt: string;
    content: string;
    annotations: SerializedAnnotation[];
    /**
     * Serialized CodeMirror editor state (`state.toJSON(readonlySavedFields)`),
     * carrying doc + annotationField + versionGroupField. When present, the
     * share renders through the real read-only EditorView (exact annotation
     * fidelity + linked revisions). Absent for pre-migration shares, which fall
     * back to the flat `annotations` renderer.
     */
    state: Record<string, unknown> | null;
    authorName: string | null;
    publishedAt: string | null;
    canonicalUrl: string;
};
