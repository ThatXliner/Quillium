/**
 * reviewTemplates.ts — Writer-facing presets for the unified Quillium review.
 *
 * Templates group stage, focus, and intent into understandable editorial jobs.
 * Writers can still adjust stage and focus afterwards; that becomes a custom setup.
 */

import type { EditorFocus, WritingStage } from "./editorContract";

export type ReviewStageChoice = WritingStage | "auto";

export type ReviewTemplate = {
    id: string;
    label: string;
    stage: ReviewStageChoice;
    focus: EditorFocus[];
    instruction: string;
};

export const BALANCED_REVIEW_FOCUS: EditorFocus[] = [
    "reader_view",
    "voice_guard",
    "specificity",
    "clarity",
];

export const REVIEW_TEMPLATES: ReviewTemplate[] = [
    {
        id: "balanced",
        label: "Balanced review",
        stage: "auto",
        focus: BALANCED_REVIEW_FOCUS,
        instruction:
            "Run a balanced editorial review and leave only the highest-leverage margin notes.",
    },
    {
        id: "develop-ideas",
        label: "Develop ideas",
        stage: "discovering",
        focus: ["reader_view", "specificity", "structure", "challenge"],
        instruction:
            "Test the central idea, identify promising material, and ask questions that help the writer discover what belongs.",
    },
    {
        id: "structure-flow",
        label: "Structure & flow",
        stage: "shaping",
        focus: ["reader_view", "structure", "specificity", "challenge"],
        instruction:
            "Review organization, progression, paragraph purpose, pacing, and missing connective material.",
    },
    {
        id: "voice-clarity",
        label: "Voice & clarity",
        stage: "refining",
        focus: ["reader_view", "voice_guard", "specificity", "clarity"],
        instruction:
            "Protect the writer's voice while flagging unclear, generic, or under-specified passages.",
    },
    {
        id: "line-edit",
        label: "Line edit",
        stage: "refining",
        focus: ["voice_guard", "clarity", "line_notes"],
        instruction:
            "Review sentence-level clarity, rhythm, redundancy, and word choice without flattening the voice.",
    },
    {
        id: "proofread",
        label: "Proofread",
        stage: "proofing",
        focus: ["grammar_only"],
        instruction: "Check only spelling, punctuation, grammar, consistency, and typos.",
    },
];

export function getReviewTemplate(id: string): ReviewTemplate | undefined {
    return REVIEW_TEMPLATES.find((template) => template.id === id);
}
