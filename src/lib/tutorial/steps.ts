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
        body: "This panel gives you access to AI tools — chat, feedback, and revision — without breaking your flow.",
        position: "right",
    },
    {
        selector: "#ai-tab-chat",
        title: "Chat with AI",
        body: "Ask questions about your writing, brainstorm ideas, or have a conversation about your work.",
        position: "right",
    },
    {
        selector: "#ai-tab-feedback",
        title: "Get Instant Feedback",
        body: "Share your prose and get thoughtful feedback on clarity, tone, pacing, and more.",
        position: "right",
    },
    {
        selector: "#ai-tab-revise",
        title: "AI-Powered Revision",
        body: "Select a passage and ask AI to rewrite it — sharper, gentler, or in a different voice.",
        position: "right",
    },
    {
        selector: "#editor-document",
        title: "Your Writing Space",
        body: "The editor is the center of everything. Distraction-free by design, with rich annotation support.",
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
