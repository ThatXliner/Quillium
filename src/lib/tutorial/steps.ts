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
    section: "core" | "ai" | "nested";
    selector: string | null;
    title: string;
    body: string;
    position: "right" | "left" | "top" | "bottom" | "center";
    requirement?: "createRevision" | "openRevisionModal" | "createNestedRevision" | "openNestedRevisionModal";
};

export const steps: Step[] = [
    {
        id: "welcome",
        section: "core",
        selector: null,
        title: "Welcome to Quillium",
        body: "A focused writing space built for long-form work. Let's take a quick tour of what's here.",
        position: "center",
    },
    {
        id: "ai-overview",
        section: "ai",
        selector: "#ai-sidebar",
        title: "Your AI Writing Companion",
        body: "Each button has a job: Chat for thinking, Feedback for evaluating content and structure, Revise for sentence-level craft, and Context for telling the AI what you're trying to accomplish.",
        position: "right",
    },
    {
        id: "ai-chat",
        section: "ai",
        selector: "#ai-tab-chat",
        title: "Chat with AI",
        body: "Use Chat for open-ended work: brainstorming, outlining, asking questions, or exploring options before you commit to edits.",
        position: "right",
    },
    {
        id: "ai-feedback",
        section: "ai",
        selector: "#ai-tab-feedback",
        title: "Get Instant Feedback",
        body: "Use Feedback to evaluate whether your content and structure are working — is the argument landing, is the pacing right, does this piece achieve its goal? Set Document Context first so the AI knows what you're trying to accomplish.",
        position: "right",
    },
    {
        id: "ai-revise",
        section: "ai",
        selector: "#ai-tab-revise",
        title: "Revise & Edit",
        body: "Use Revise for sentence-level craft: tightening prose, improving word choice, fixing rhythm and clarity. The content is assumed to be right — this is about how it's written.",
        position: "right",
    },
    {
        id: "ai-context",
        section: "ai",
        selector: "#ai-tab-context",
        title: "Set Document Context",
        body: "Describe your goal, audience, tone, and what the piece needs to accomplish. Feedback uses this to evaluate whether your writing is actually working — not just whether it reads well in isolation.",
        position: "right",
    },
    {
        id: "writing-space",
        section: "core",
        selector: "#editor-document",
        title: "Your Writing Space",
        body: "This is your main drafting canvas: write, edit, and shape the piece here, while annotations and AI stay nearby instead of interrupting your flow.",
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
        id: "status",
        section: "core",
        selector: "#status-bar",
        title: "Track Your Progress",
        body: "Word count, character count, and save status — always visible, never in the way.",
        position: "bottom",
    },
    {
        id: "done",
        section: "core",
        selector: null,
        title: "You're all set",
        body: "Start writing whenever you're ready. You can replay this tour anytime using the ? button in the status bar.",
        position: "center",
    },
];
