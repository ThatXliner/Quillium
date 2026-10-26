import type { Snippet } from "svelte";
import type { DiffOp } from "../diff";

export type CardThreadSnippet = Snippet;

export type ThreadMessageView = {
    author: string;
    message: string;
    time: number;
};

export type ThreadMessagePersonaView = {
    emoji: string;
    background: string;
    border: string;
};

export type SuggestionReplacementView = {
    text: string;
    rationale?: string;
};

export type SuggestionDiffOperation = DiffOp;

export type RevisionVersionGroupView = {
    id: string;
    label: string;
    memberCount: number;
    color: string;
};

export type RevisionVersionView = {
    id: string;
    index: number;
    label?: string;
    text: string;
    active: boolean;
    identicalToPrevious?: boolean;
    group?: RevisionVersionGroupView;
};

export type RevisionBreadcrumbVersionView = {
    id: string;
    /** Resolved label shown in the trigger and version menu. */
    label: string;
    /** Raw user-authored label used to seed current-version rename UI. */
    editableLabel?: string;
};

export type RevisionBreadcrumbCrumbView = {
    id: string;
    label: string;
    current: boolean;
    selectedVersionId: string | null;
    versions: readonly RevisionBreadcrumbVersionView[];
};

export type AnnotationContextViewLayer = {
    before: string;
    revision: string;
    after: string;
    hasMoreBefore?: boolean;
    hasMoreAfter?: boolean;
};

/** @deprecated Prefer AnnotationContextViewLayer for new generalized context adapters. */
export type RevisionContextViewLayer = AnnotationContextViewLayer;
