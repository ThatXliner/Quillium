import type { Snippet } from "svelte";

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

export type SuggestionDiffOperation = {
    type: "equal" | "delete" | "insert";
    text: string;
};

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
    group?: RevisionVersionGroupView;
};
