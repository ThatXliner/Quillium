<!--
    ChangelogModal.svelte — Discord-style "What's New" overlay.

    Shown on startup when the current minor version has an unseen
    changelog entry, or manually via the Settings header button.
    Renders markdown content with the existing renderMarkdown() utility.

    Props:
      date     — display string like "April 2026"
      content  — markdown string rendered to HTML
      version  — "major.minor" string for PostHog event
      ondismiss — called when the user closes the modal
-->
<script lang="ts">
import { X } from "lucide-svelte";
import { renderMarkdown } from "$lib/ai/utils";
import { capture } from "$lib/posthog";

const {
    date,
    content,
    version,
    ondismiss,
}: {
    date: string;
    content: string;
    version: string;
    ondismiss: () => void;
} = $props();

let html = $state("");

$effect(() => {
    renderMarkdown(content).then((result) => {
        html = result;
    });
});

function dismiss() {
    capture("changelog_viewed", { version });
    ondismiss();
}
</script>

<div class="fixed inset-0 z-[9999]" role="dialog" aria-modal="true" aria-label="What's New">
    <button
        type="button"
        class="absolute inset-0 bg-black/55 border-0 p-0 cursor-default"
        aria-label="Close"
        tabindex="-1"
        onclick={dismiss}
    ></button>

    <div
        class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[440px] max-h-[70vh] backdrop-blur-md bg-gray-300/85 border border-white/40 shadow-xl rounded-2xl flex flex-col overflow-hidden"
        role="document"
    >
        <!-- Header -->
        <div class="flex items-start justify-between px-6 pt-6 pb-0 shrink-0">
            <div>
                <h3 class="text-[15px] font-semibold text-black/80 leading-tight">What's New</h3>
                <p class="text-[11px] text-black/35 mt-0.5">{date}</p>
            </div>
            <button
                onclick={dismiss}
                aria-label="Close"
                class="flex items-center justify-center w-7 h-7 rounded-lg bg-black/[0.06] text-black/40 hover:text-black/60 hover:bg-black/[0.1] transition-colors -mt-0.5"
            >
                <X size={15} />
            </button>
        </div>

        <!-- Scrollable content -->
        <div class="flex-1 overflow-y-auto px-6 pt-4 pb-6">
            <div class="changelog-content text-xs text-black/55 leading-relaxed">
                {@html html}
            </div>
        </div>
    </div>
</div>

<style>
    .changelog-content :global(p) {
        margin: 0 0 12px 0;
        line-height: 1.8;
    }
    .changelog-content :global(p:last-child) {
        margin-bottom: 0;
    }
    .changelog-content :global(strong) {
        color: rgba(0, 0, 0, 0.7);
    }
    .changelog-content :global(a) {
        color: #3b82f6;
        text-decoration: underline;
    }
    .changelog-content :global(a:hover) {
        color: #2563eb;
    }
</style>
