/**
 * scenarios.ts — Debug scenario definitions for the Quillium debug panel.
 *
 * Each scenario sets up the editor in a specific state useful for
 * manual testing without requiring AI API calls. Scenarios are pure
 * functions that receive an EditorView and dispatch the necessary
 * transactions to reach the target state.
 *
 * To add a new scenario: append an entry to the `scenarios` array.
 */

import type { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";
import { createComment, createSuggestion, createRevision } from "$lib/editor/plugins/annotations";
import { addAnnotation, annotationField } from "$lib/editor/plugins/annotations/annotationField";
import { createNewAnnotation } from "$lib/editor/plugins/annotations/models";

export type Scenario = {
    id: string;
    label: string;
    description: string;
    /** The document content to set before applying annotations. */
    doc: string;
    setup: (view: EditorView) => void;
};

// ── Shared sample document ────────────────────────────────────────────────────

const SAMPLE_DOC = `The old lighthouse keeper had watched storms roll in from the sea for forty years. Each one was different — some crept in slowly, giving him hours to prepare, while others arrived without warning, the sky turning green and angry before the wind even picked up.

He checked the lamp mechanism one last time, running his fingers along the brass gears the way a pianist touches keys before a concert. Everything had to work tonight.

The fog had been thick all week, and three ships were expected in the harbour before dawn.`;

// ── Scenarios ─────────────────────────────────────────────────────────────────

export const scenarios: Scenario[] = [
    {
        id: "single-comment",
        label: "Single comment",
        description: "One comment annotation on a passage",
        doc: SAMPLE_DOC,
        setup(view) {
            createComment({
                targetText: "the way a pianist touches keys before a concert",
                comment:
                    "Beautiful simile — consider whether it fits the character's background. Does the keeper have a musical history?",
                author: "Editor",
                view,
            });
        },
    },
    {
        id: "multi-comment",
        label: "Multiple comments",
        description: "Several comments spread across the document",
        doc: SAMPLE_DOC,
        setup(view) {
            createComment({
                targetText: "Each one was different",
                comment: "Vague opening. Could be more specific — what made them different?",
                author: "Editor",
                view,
            });
            createComment({
                targetText: "the sky turning green and angry",
                comment: "Strong image. 'Angry' risks anthropomorphism — intentional?",
                author: "Editor",
                view,
            });
            createComment({
                targetText: "three ships were expected in the harbour before dawn",
                comment: "This detail raises stakes nicely. Consider naming at least one ship.",
                author: "Editor",
                view,
            });
        },
    },
    {
        id: "single-suggestion",
        label: "Single suggestion",
        description: "One suggestion with two replacement options",
        doc: SAMPLE_DOC,
        setup(view) {
            createSuggestion({
                state: view.state,
                dispatch: (tr) => view.dispatch(tr),
                targetText:
                    "The old lighthouse keeper had watched storms roll in from the sea for forty years.",
                replacements: [
                    {
                        text: "For forty years, the lighthouse keeper had watched storms roll in from the sea.",
                        rationale: "Leads with time — creates immediacy",
                    },
                    {
                        text: "He had tended this lighthouse for forty years, long enough to know every shade of storm.",
                        rationale: "More intimate, emphasises his expertise",
                    },
                ],
                comment: "Opening sentence restructure options",
                author: "Editor",
            });
        },
    },
    {
        id: "multi-suggestion",
        label: "Multiple suggestions",
        description: "Two suggestions on different parts of the text",
        doc: SAMPLE_DOC,
        setup(view) {
            createSuggestion({
                state: view.state,
                dispatch: (tr) => view.dispatch(tr),
                targetText: "Each one was different",
                replacements: [
                    { text: "No two were alike", rationale: "Tighter phrasing" },
                    { text: "Each storm had its own character", rationale: "More evocative" },
                ],
                author: "Editor",
            });
            createSuggestion({
                state: view.state,
                dispatch: (tr) => view.dispatch(tr),
                targetText: "the sky turning green and angry",
                replacements: [
                    {
                        text: "the sky bruising to a sickly green",
                        rationale: "More visual, avoids anthropomorphism",
                    },
                    {
                        text: "the horizon going the colour of old copper",
                        rationale: "Unique colour reference",
                    },
                ],
                author: "Editor",
            });
        },
    },
    {
        id: "single-revision",
        label: "Single revision",
        description: "One revision with three alternative versions",
        doc: SAMPLE_DOC,
        setup(view) {
            createRevision({
                targetText:
                    "running his fingers along the brass gears the way a pianist touches keys before a concert",
                versions: [
                    {
                        label: "Mechanical",
                        text: "feeling each gear tooth catch and release under his thumb, every part exactly where it should be",
                    },
                    {
                        label: "Sparse",
                        text: "checking each part by feel alone, as he had done a thousand times before",
                    },
                ],
                threadMessage:
                    "The simile is evocative but may feel out of register for this character. Options: lean into the mechanical precision, or strip back to something starker.",
                author: "Editor",
                view,
            });
        },
    },
    {
        id: "mixed-annotations",
        label: "Mixed annotations",
        description: "Comments, suggestions, and a revision together",
        doc: SAMPLE_DOC,
        setup(view) {
            createComment({
                targetText: "The fog had been thick all week",
                comment: "Good atmospheric setup for the stakes. Could come earlier in the piece.",
                author: "Editor",
                view,
            });
            createSuggestion({
                state: view.state,
                dispatch: (tr) => view.dispatch(tr),
                targetText: "Each one was different",
                replacements: [{ text: "No two were alike", rationale: "More concise" }],
                author: "Editor",
            });
            createRevision({
                targetText: "the sky turning green and angry before the wind even picked up",
                versions: [
                    {
                        label: "Precise",
                        text: "the sky fading to the flat, yellowish-green that meant a fast-moving squall",
                    },
                    {
                        label: "Minimal",
                        text: "the sky changing colour hours before the wind shifted",
                    },
                ],
                threadMessage:
                    "Two directions: more meteorologically specific, or pared back to let the keeper's knowledge imply the detail.",
                author: "Editor",
                view,
            });
        },
    },
    {
        id: "nested-revision",
        label: "Nested revision setup",
        description:
            "A revision whose text itself contains an annotation — open the revision then use Cmd+Alt+K inside it to nest",
        doc: SAMPLE_DOC,
        setup(view) {
            createRevision({
                targetText:
                    "running his fingers along the brass gears the way a pianist touches keys before a concert",
                versions: [
                    {
                        label: "Extended",
                        text: "running his fingers along the brass gears, feeling each tooth engage with the precision of something built to outlast its maker — the way a pianist runs scales before the hall fills",
                    },
                ],
                threadMessage:
                    "Extended version with more detail. Open this revision and use Cmd+Alt+K to create a nested revision inside it.",
                author: "Editor",
                view,
            });
        },
    },
    {
        id: "pending-comment",
        label: "Pending comment",
        description:
            "An empty comment annotation waiting for user input (select text and trigger Cmd+Alt+M manually, or this creates one at a fixed position)",
        doc: SAMPLE_DOC,
        setup(view) {
            // Create a comment with an empty thread — this is the "pending" state
            // that the UI shows as an open comment box waiting for user input.
            const state = view.state;
            const target = "Each one was different";
            const from = state.doc.toString().indexOf(target);
            if (from === -1) return;
            const to = from + target.length;
            view.dispatch(
                state.update({
                    effects: [
                        addAnnotation.of(
                            createNewAnnotation(
                                state.field(annotationField),
                                EditorSelection.single(from, to),
                                "comment",
                            ),
                        ),
                    ],
                }),
            );
        },
    },
    {
        id: "dense-annotations",
        label: "Dense annotations",
        description: "Many overlapping annotations to test layout and panel overflow",
        doc: SAMPLE_DOC,
        setup(view) {
            const passages = [
                {
                    text: "forty years",
                    comment: "Establishes experience without backstory — good economy.",
                },
                {
                    text: "some crept in slowly",
                    comment: "Nice contrast with the fast arrivals. Could expand this.",
                },
                {
                    text: "giving him hours to prepare",
                    comment: "What does preparation look like? Worth a detail.",
                },
                {
                    text: "the sky turning green",
                    comment: "Meteorologically accurate — nice specificity.",
                },
                {
                    text: "angry before the wind even picked up",
                    comment: "Sequence is correct: colour change precedes wind shift.",
                },
                {
                    text: "checked the lamp mechanism",
                    comment: "Action shows routine without stating it explicitly.",
                },
            ];
            for (const { text, comment } of passages) {
                try {
                    createComment({ targetText: text, comment, author: "Editor", view });
                } catch {
                    // Skip if text not found after previous annotations shifted ranges
                }
            }
        },
    },
];
