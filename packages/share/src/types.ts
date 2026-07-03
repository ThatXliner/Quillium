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

export type ReadonlyShareTab = {
    id: string;
    label: string;
    draftId: string | null;
    content: string;
    annotations: SerializedAnnotation[];
};

export type ReadonlySharePayloadV2 = {
    kind: "quillium-readonly-share";
    version: 2;
    activeTabId: string | null;
    tabs: ReadonlyShareTab[];
};

export type DecodedReadonlySharePayload = {
    content: string;
    annotations: SerializedAnnotation[];
    activeTabId: string | null;
    tabs: ReadonlyShareTab[];
    isMultiTabPayload: boolean;
};

export type ReadonlyShareDocument = {
    token: string;
    title: string;
    excerpt: string;
    content: string;
    annotations: SerializedAnnotation[];
    activeTabId: string | null;
    tabs: ReadonlyShareTab[];
    authorName: string | null;
    publishedAt: string | null;
    canonicalUrl: string;
};
