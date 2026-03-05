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
    selector: string | null;
    title: string;
    body: string;
    position: "right" | "left" | "top" | "bottom" | "center";
};

export const steps: Step[] = [
    {
        selector: null,
        title: "Welcome to Quillium",
        body: "A focused writing space built for long-form work. Let's take a quick tour of what's here.",
        position: "center",
    },
    {
        selector: "#ai-sidebar",
        title: "Your AI Writing Companion",
        body: "Each button has a job: Chat for thinking, Feedback for critique, Revise for rewrites, and Context for steering all AI responses.",
        position: "right",
    },
    {
        selector: "#ai-tab-chat",
        title: "Chat with AI",
        body: "Use Chat for open-ended work: brainstorming, outlining, asking questions, or exploring options before you commit to edits.",
        position: "right",
    },
    {
        selector: "#ai-tab-feedback",
        title: "Get Instant Feedback",
        body: "Use Feedback for editorial diagnosis: what is working, what is weak, and why. It gives direction without rewriting your draft.",
        position: "right",
    },
    {
        selector: "#ai-tab-revise",
        title: "AI-Powered Revision",
        body: "Use Revise when you want replacement text. Select a passage and generate concrete rewrite options you can directly compare.",
        position: "right",
    },
    {
        selector: "#ai-tab-context",
        title: "Set Document Context",
        body: "Define goal, tone, audience, and constraints here. Chat, Feedback, and Revise use this context to stay aligned with your intent.",
        position: "right",
    },
    {
        selector: "#editor-document",
        title: "Your Writing Space",
        body: "Try the annotation commands: Cmd/Ctrl+Alt+M creates a comment, and Cmd/Ctrl+Alt+K creates a revision. Revisions are infinitely nestable, so you can open a revision and create another inside it as deep as you need.",
        position: "left",
    },
    {
        selector: "#status-bar",
        title: "Track Your Progress",
        body: "Word count, character count, and save status — always visible, never in the way.",
        position: "bottom",
    },
    {
        selector: null,
        title: "You're all set",
        body: "Start writing whenever you're ready. You can replay this tour anytime using the ? button in the status bar.",
        position: "center",
    },
];
