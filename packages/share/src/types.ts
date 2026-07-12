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
        /** Stable identity used by linked revision groups; absent on legacy flat shares. */
        versionId?: string;
        text: string;
        label?: string;
        /** Read-only presentation metadata for a linked version group. */
        group?: {
            id: string;
            label: string;
            memberCount: number;
            color: string;
        };
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
    draftId: string;
    state: Record<string, unknown>;
};

export type ReadonlyShareScope = "current-tab" | "all-tabs";

export type ReadonlyShareStateV2 = {
    kind: "quillium-readonly-share";
    version: 2;
    /** Missing only on early v2 payloads, which behaved like current-tab shares. */
    scope?: ReadonlyShareScope;
    activeTabId: string | null;
    tabs: ReadonlyShareTab[];
};

export function isReadonlyShareStateV2(value: unknown): value is ReadonlyShareStateV2 {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Partial<ReadonlyShareStateV2>;
    return (
        candidate.kind === "quillium-readonly-share" &&
        candidate.version === 2 &&
        Array.isArray(candidate.tabs)
    );
}

export function readonlyShareScopeOf(value: unknown): ReadonlyShareScope {
    if (!isReadonlyShareStateV2(value)) return "current-tab";
    return value.scope === "all-tabs" ? "all-tabs" : "current-tab";
}

export function includesReadonlyShareTab(
    scope: ReadonlyShareScope,
    tabId: string,
    currentTabId: string | null,
): boolean {
    return scope === "all-tabs" || tabId === currentTabId;
}

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
