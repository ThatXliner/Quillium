/**
 * steps.ts — Tutorial step definitions for the guided tour overlay.
 *
 * Each step targets a DOM element via CSS selector and provides
 * content (title + body) and a preferred tooltip position relative
 * to the highlighted element. Tutorial.svelte iterates through
 * these steps in order, spotlighting each selector in turn.
 *
 * To add a new step, append an entry to the `steps` array with
 * a CSS selector matching an element that has an `id` attribute
 * in the rendered page.
 */

export type Step = {
    id: string;
    section: "core" | "ai" | "nested" | "shortcuts";
    selector: string | null;
    title: string;
    body: string;
    position: "right" | "left" | "top" | "bottom" | "center";
    /** If true, the tooltip renders an inline keyboard shortcuts reference table. */
    showShortcuts?: boolean;
    requirement?:
        | "createRevision"
        | "openRevisionModal"
        | "createNestedRevision"
        | "openNestedRevisionModal";
};

export const steps: Step[] = [
    {
        id: "welcome",
        section: "core",
        selector: null,
        title: "Welcome to Quillium",
        body: "A focused writing space for long-form work. Here's a quick tour.",
        position: "center",
    },
    {
        id: "writing-space",
        section: "core",
        selector: "#editor-document",
        title: "Your Writing Space",
        body: "Your main drafting canvas. Annotations and AI stay at the edges so you can stay in flow.",
        position: "left",
    },
    {
        id: "nested-create-revision",
        section: "nested",
        selector: "#editor-document",
        title: "Create Nested Revisions",
        body: "Select text in the main editor and press Ctrl (Windows/Linux) or Cmd (macOS) + Alt + K to create your first revision.",
        requirement: "createRevision",
        position: "left",
    },
    {
        id: "nested-open-modal",
        section: "nested",
        selector: null,
        title: "Expand the Revision Modal",
        body: "In that new revision card, click the expand button to open the full revision modal.",
        requirement: "openRevisionModal",
        position: "left",
    },
    {
        id: "nested-create-inside-modal",
        section: "nested",
        selector: ".revision-modal .revision-modal-editor",
        title: "Create a Revision Inside the Modal",
        body: "In the revision modal editor, select text and press Ctrl/Cmd + Alt + K again to create a nested revision.",
        requirement: "createNestedRevision",
        position: "left",
    },
    {
        id: "nested-open-second-modal",
        section: "nested",
        selector: null,
        title: "Expand the Nested Revision",
        body: "In the modal's annotation sidebar, open the nested revision with its expand button. This is infinite nesting in action.",
        requirement: "openNestedRevisionModal",
        position: "left",
    },
    {
        id: "ai-overview",
        section: "ai",
        selector: "#ai-sidebar",
        title: "Your AI Writing Companion",
        body: "Chat for thinking, Feedback for evaluating structure, Revise for sentence-level craft, Context for setting your goal.",
        position: "right",
    },
    {
        id: "ai-chat",
        section: "ai",
        selector: "#ai-tab-chat",
        title: "Chat with AI",
        body: "Open-ended work: brainstorming, outlining, asking questions, or exploring options before committing to edits.",
        position: "right",
    },
    {
        id: "ai-feedback",
        section: "ai",
        selector: "#ai-tab-feedback",
        title: "Get Instant Feedback",
        body: "Evaluate whether your content and structure are working — argument, pacing, goals. Set Document Context first so the AI knows what you're aiming for.",
        position: "right",
    },
    {
        id: "ai-revise",
        section: "ai",
        selector: "#ai-tab-revise",
        title: "Revise & Edit",
        body: "Sentence-level craft: tightening prose, word choice, rhythm, clarity. The content is assumed right — this is about how it's written.",
        position: "right",
    },
    {
        id: "ai-context",
        section: "ai",
        selector: "#ai-tab-context",
        title: "Set Document Context",
        body: "Describe your goal, audience, and tone. Feedback uses this to evaluate whether your writing is working — not just whether it reads well in isolation.",
        position: "right",
    },
    {
        id: "status",
        section: "core",
        selector: "#status-bar",
        title: "Track Your Progress",
        body: "Word count, character count, save status — always visible, never in the way.",
        position: "bottom",
    },
    {
        id: "keyboard-shortcuts",
        section: "shortcuts",
        selector: "#status-bar",
        title: "Keyboard Shortcuts",
        body: "Quillium is designed to be keyboard-first. Here's a quick reference.",
        showShortcuts: true,
        position: "bottom",
    },
    {
        id: "done",
        section: "core",
        selector: null,
        title: "You're all set",
        body: "Start writing. Replay this tour anytime with the ? button in the status bar.",
        position: "center",
    },
];
