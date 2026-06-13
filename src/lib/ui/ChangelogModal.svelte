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
        class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[480px] max-h-[75vh] bg-[color:var(--surface)] shadow-2xl rounded-2xl flex flex-col overflow-hidden border border-[color:var(--border)]"
        role="document"
    >
        <!-- Header -->
        <div class="flex items-start justify-between px-7 pt-7 pb-0 shrink-0">
            <div>
                <h3 class="text-xl font-bold text-[color:var(--text-strong)] leading-tight">What's New</h3>
                <p class="text-xs text-[color:var(--text-faint)] mt-1">{date}</p>
            </div>
            <button
                onclick={dismiss}
                aria-label="Close"
                class="flex items-center justify-center w-8 h-8 rounded-lg bg-[color:var(--surface-2)] text-[color:var(--text-faint)] hover:text-[color:var(--text-soft)] hover:bg-[color:var(--surface-3)] transition-colors"
            >
                <X size={16} />
            </button>
        </div>

        <!-- Scrollable content -->
        <div class="flex-1 overflow-y-auto px-7 pt-5 pb-7">
            <div class="changelog-content text-sm text-[color:var(--text-soft)] leading-relaxed">
                {@html html}
            </div>
        </div>
    </div>
</div>

<style>
    .changelog-content :global(p) {
        margin: 0 0 16px 0;
        line-height: 1.75;
    }
    .changelog-content :global(p:last-child) {
        margin-bottom: 0;
    }
    .changelog-content :global(strong) {
        color: var(--text);
    }
    .changelog-content :global(a) {
        color: #3b82f6;
        text-decoration: underline;
    }
    .changelog-content :global(a:hover) {
        color: #2563eb;
    }
</style>
