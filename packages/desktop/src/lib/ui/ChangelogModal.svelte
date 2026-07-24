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
import { renderMarkdown } from "$lib/ai/utils";
import { capture } from "$lib/posthog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { X } from "lucide-svelte";

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

// Links come from raw markdown HTML ({@html}), so they're plain anchors —
// left alone, clicking one would navigate the app's own webview away.
// Intercept at the container and hand off to the OS default browser instead.
function handleContentClick(event: MouseEvent) {
    const anchor = (event.target as HTMLElement).closest("a");
    const href = anchor?.getAttribute("href");
    if (!href) return;
    event.preventDefault();
    void openUrl(href);
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
        class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[680px] max-w-[calc(100vw-2rem)] max-h-[85vh] bg-white shadow-2xl rounded-2xl flex flex-col overflow-hidden border border-black/[0.06]"
        role="document"
    >
        <!-- Header -->
        <div class="flex items-start justify-between px-9 pt-9 pb-0 shrink-0">
            <div>
                <h3 class="text-2xl font-bold text-black/85 leading-tight">What's New</h3>
                <p class="text-sm text-black/35 mt-1.5">{date}</p>
            </div>
            <button
                onclick={dismiss}
                aria-label="Close"
                class="flex items-center justify-center w-9 h-9 rounded-lg bg-black/[0.05] text-black/35 hover:text-black/60 hover:bg-black/[0.1] transition-colors"
            >
                <X size={18} />
            </button>
        </div>

        <!-- Scrollable content -->
        <div class="flex-1 overflow-y-auto px-9 pt-6 pb-9">
            <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
            <div
                class="changelog-content text-[15px] text-black/55 leading-relaxed"
                onclick={handleContentClick}
            >
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
    /* Section headers (`# `, `## `, `### `) for grouping a release's changes.
       `h1` is a bold black section title; `h2`/`h3` are smaller panel-title-style
       labels (see BRANDING.md) for subsections within one. */
    .changelog-content :global(h1),
    .changelog-content :global(h2),
    .changelog-content :global(h3) {
        font-weight: 600;
        line-height: 1.3;
        margin: 28px 0 10px 0;
    }
    .changelog-content :global(h1:first-child),
    .changelog-content :global(h2:first-child),
    .changelog-content :global(h3:first-child) {
        margin-top: 0;
    }
    .changelog-content :global(h1) {
        font-size: 20px;
        font-weight: 700;
        color: rgba(0, 0, 0, 0.85);
    }
    .changelog-content :global(h2) {
        font-size: 13px;
        color: rgba(0, 0, 0, 0.55);
    }
    .changelog-content :global(h3) {
        font-size: 13px;
        color: rgba(0, 0, 0, 0.55);
    }
    .changelog-content :global(strong) {
        color: rgba(0, 0, 0, 0.7);
    }
    .changelog-content :global(ul),
    .changelog-content :global(ol) {
        margin: 0 0 16px 0;
        padding-left: 22px;
    }
    .changelog-content :global(ul:last-child),
    .changelog-content :global(ol:last-child) {
        margin-bottom: 0;
    }
    .changelog-content :global(ul) {
        list-style: disc;
    }
    .changelog-content :global(ol) {
        list-style: decimal;
    }
    .changelog-content :global(li) {
        margin: 0 0 8px 0;
        line-height: 1.75;
    }
    .changelog-content :global(li:last-child) {
        margin-bottom: 0;
    }
    .changelog-content :global(li) :global(p) {
        margin-bottom: 8px;
    }
    .changelog-content :global(li) :global(p:last-child) {
        margin-bottom: 0;
    }
    .changelog-content :global(a) {
        color: #3b82f6;
        text-decoration: underline;
    }
    .changelog-content :global(a:hover) {
        color: #2563eb;
    }
    /* Feature images embedded via markdown (![alt](/changelog/<version>.png)).
       Rendered as a card inset within the body padding — rounded corners and a
       subtle border. Capture them with `bun run changelog:shot` — see
       CONTRIBUTING.md. */
    .changelog-content :global(img) {
        display: block;
        width: 100%;
        height: auto;
        margin: 6px 0 20px 0;
        border-radius: 12px;
        border: 1px solid rgba(0, 0, 0, 0.08);
        background: #f5f5f0;
    }
</style>
