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
    /** Keyboard shortcut hint rendered after the body text using the Kbd component. */
    shortcutHint?: { prefix?: string; keys: string[] };
    requirement?: "createRevision" | "openRevisionModal";
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
        body: "Your main drafting canvas. Everything else stays at the edges so you can stay in flow.",
        position: "left",
    },
    {
        id: "nested-create-revision",
        section: "nested",
        selector: "#editor-document",
        title: "Create Nested Revisions",
        body: "Let's create our first revision.",
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
        id: "ai-overview",
        section: "ai",
        selector: "#ai-sidebar",
        title: "Quillium in the Margin",
        body: "Quillium reads the current draft, decides what kind of attention is useful, and leaves a few anchored notes without taking over the writing.",
        position: "right",
    },
    {
        id: "ai-review",
        section: "ai",
        selector: "#quillium-review-button",
        title: "Review the Draft",
        body: "Quillium infers the writing stage automatically. Open it to review now, add a specific concern, or adjust the writing brief and reader perspectives.",
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
