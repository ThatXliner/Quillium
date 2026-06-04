<!--
    MobileFormatBar.svelte — Keyboard accessory toolbar for touch / small viewports.

    Quillium's core is annotation (comments, revisions), NOT formatting, so the
    bar leads with those actions. Markdown formatting is tucked behind an "Aa"
    button that opens a popover — reachable, but off the critical path.

    The desktop equivalents are keyboard shortcuts (Mod-Alt-m comment,
    Mod-Alt-k revision, Mod-b/i headings, …) which are unreachable without a
    hardware keyboard, so on mobile we surface them as buttons that float
    directly on top of the on-screen keyboard — the pattern Obsidian uses.

    Positioning: the iOS/Android software keyboard does NOT resize the layout
    viewport in a WKWebView, so `position: fixed; bottom: 0` would sit BEHIND the
    keyboard (including iOS's own prediction/accessory row). We track
    `window.visualViewport` (which DOES shrink while the keyboard is open) and pin
    the bar to the top of the keyboard via
    `bottom = layoutHeight - (viewport.height + viewport.offsetTop)`. The bar
    follows the keyboard up/down and hides when it closes.

    Buttons use `onpointerdown` + `preventDefault` so tapping them does NOT blur
    the editor (which would dismiss the keyboard and collapse the selection).

    Actions target whichever CodeMirror view is focused — the main editor, an
    inline revision editor, or a revision modal editor — resolved via
    EditorView.findFromDOM on the focused node. This keeps the bar present (and
    correct) inside nested editors instead of vanishing.

    Two layouts: keyboard up → full-width strip flush on top of the keyboard;
    keyboard down / floating / hardware → a compact corner pill (so iOS's
    floating keyboard pill doesn't show through a full-width gap).

    Desktop is untouched: the bar only renders when `enabled` (a mobile flag from
    +page.svelte) is true AND a CodeMirror editor is focused.
-->
<script lang="ts">
import { type MarkdownFormat, formatMarkdownSelection } from "$lib/editor/markdownFormatting";
import { createCommentCommand, createRevisionCommand } from "$lib/editor/plugins/annotations";
import { EditorView } from "@codemirror/view";
import {
    BoldIcon,
    CodeIcon,
    GitBranchPlusIcon,
    Heading1Icon,
    Heading2Icon,
    ItalicIcon,
    ListIcon,
    MessageSquarePlusIcon,
    QuoteIcon,
    StrikethroughIcon,
    TypeIcon,
    XIcon,
} from "lucide-svelte";

let { enabled = false }: { enabled?: boolean } = $props();

// Distance from the bottom of the layout viewport to the top of the keyboard.
// 0 means no on-screen keyboard (hardware keyboard, floating/minimized
// keyboard, or keyboard closed) — the bar then pins to the bottom of the screen.
let keyboardBottom = $state(0);
// The CodeMirror view that currently has focus — the MAIN editor, an inline
// revision editor, or a revision modal editor (all separate EditorView
// instances). Resolved from the focused DOM node so the bar follows focus into
// nested editors instead of vanishing. null when no editor is focused.
let activeView = $state<EditorView | null>(null);
let formatOpen = $state(false);

// Visible whenever any editor has focus — NOT gated on the on-screen keyboard,
// so it still shows with a hardware/floating keyboard (which barely shrinks the
// visual viewport). Position handles the keyboard-up vs keyboard-down cases.
const visible = $derived(enabled && !!activeView);

// Two layouts:
//   keyboard up   → full-width bar flush on top of the keyboard.
//   keyboard down → a compact rounded pill in the bottom-left corner, so it
//                   reads as one Quillium control instead of spanning the width
//                   with iOS's floating keyboard pill wedged in the gap.
const compact = $derived(keyboardBottom === 0);

// When the keyboard is up we sit flush on top of it. When it's down/floating we
// pin to the screen bottom, clearing the home-indicator safe area AND iOS's
// floating keyboard pill (~3.5rem tall) so we sit above it.
const FLOATING_PILL_CLEARANCE = "4rem";
const barBottom = $derived(
    keyboardBottom > 0
        ? `${keyboardBottom}px`
        : `calc(env(safe-area-inset-bottom, 0px) + ${FLOATING_PILL_CLEARANCE})`,
);
const popoverBottom = $derived(
    keyboardBottom > 0
        ? `${keyboardBottom + 48}px`
        : `calc(env(safe-area-inset-bottom, 0px) + ${FLOATING_PILL_CLEARANCE} + 3rem)`,
);

function syncKeyboard() {
    const vv = window.visualViewport;
    if (!vv) {
        keyboardBottom = 0;
        return;
    }
    // Pixels the visual viewport is shorter than the layout viewport == the
    // keyboard (plus any browser chrome) overlapping the bottom.
    const overlap = window.innerHeight - (vv.height + vv.offsetTop);
    // Small threshold filters out rounding / address-bar jitter.
    keyboardBottom = overlap > 80 ? overlap : 0;
}

function syncFocus() {
    const el = document.activeElement;
    const cmRoot = el?.closest<HTMLElement>(".cm-editor");
    activeView = cmRoot ? EditorView.findFromDOM(cmRoot) : null;
    if (!activeView) formatOpen = false;
    // Re-measure on focus changes too: switching to/from a floating or hardware
    // keyboard doesn't always emit a visualViewport resize.
    syncKeyboard();
}

$effect(() => {
    if (!enabled) return;
    const vv = window.visualViewport;
    vv?.addEventListener("resize", syncKeyboard);
    vv?.addEventListener("scroll", syncKeyboard);
    document.addEventListener("focusin", syncFocus);
    document.addEventListener("focusout", syncFocus);
    syncKeyboard();
    syncFocus();
    return () => {
        vv?.removeEventListener("resize", syncKeyboard);
        vv?.removeEventListener("scroll", syncKeyboard);
        document.removeEventListener("focusin", syncFocus);
        document.removeEventListener("focusout", syncFocus);
    };
});

function runFormat(format: MarkdownFormat) {
    activeView && formatMarkdownSelection(activeView, format);
}

function runComment() {
    const view = activeView;
    if (!view) return;
    createCommentCommand(view);
    view.focus();
}

function runRevision() {
    const view = activeView;
    if (!view) return;
    createRevisionCommand(view);
    view.focus();
}

function dismissKeyboard() {
    (document.activeElement as HTMLElement | null)?.blur();
}

const FORMATS: { format: MarkdownFormat; title: string; icon: typeof BoldIcon }[] = [
    { format: "heading1", title: "Heading 1", icon: Heading1Icon },
    { format: "heading2", title: "Heading 2", icon: Heading2Icon },
    { format: "bold", title: "Bold", icon: BoldIcon },
    { format: "italic", title: "Italic", icon: ItalicIcon },
    { format: "strikethrough", title: "Strikethrough", icon: StrikethroughIcon },
    { format: "code", title: "Code", icon: CodeIcon },
    { format: "blockquote", title: "Blockquote", icon: QuoteIcon },
    { format: "bulletList", title: "Bullet list", icon: ListIcon },
];
</script>

{#if visible}
    {#if formatOpen}
        <div
            class="format-popover"
            class:compact
            style="bottom: {popoverBottom};"
            role="toolbar"
            aria-label="Formatting"
        >
            {#each FORMATS as { format, title, icon: Icon } (format)}
                <button
                    type="button"
                    {title}
                    onpointerdown={(e) => {
                        e.preventDefault();
                        runFormat(format);
                    }}
                >
                    <Icon size={20} />
                </button>
            {/each}
        </div>
    {/if}

    <div
        class="mobile-format-bar"
        class:compact
        style="bottom: {barBottom};"
        role="toolbar"
        aria-label="Editor actions"
    >
        <button
            type="button"
            class="primary"
            onpointerdown={(e) => {
                e.preventDefault();
                runComment();
            }}
        >
            <MessageSquarePlusIcon size={18} />
            <span>Comment</span>
        </button>
        <button
            type="button"
            class="primary"
            onpointerdown={(e) => {
                e.preventDefault();
                runRevision();
            }}
        >
            <GitBranchPlusIcon size={18} />
            <span>Revision</span>
        </button>

        {#if compact}
            <span class="divider"></span>
        {:else}
            <span class="spacer"></span>
        {/if}

        <button
            type="button"
            class="icon"
            class:active={formatOpen}
            title="Formatting"
            aria-pressed={formatOpen}
            onpointerdown={(e) => {
                e.preventDefault();
                formatOpen = !formatOpen;
            }}
        >
            <TypeIcon size={20} />
        </button>
        <button
            type="button"
            class="icon"
            title="Dismiss"
            onpointerdown={(e) => {
                e.preventDefault();
                dismissKeyboard();
            }}
        >
            <XIcon size={20} />
        </button>
    </div>
{/if}

<style>
    .mobile-format-bar {
        position: fixed;
        left: 0;
        right: 0;
        z-index: 60;
        display: flex;
        align-items: center;
        gap: 0.25rem;
        padding: 0.25rem 0.5rem;
        background: rgba(255, 255, 255, 0.85);
        backdrop-filter: blur(12px);
        border-top: 1px solid rgba(0, 0, 0, 0.08);
        box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.06);
        /* never trap touch gestures meant for the keyboard */
        touch-action: none;
    }

    /* Keyboard-down: a self-contained pill centered at the bottom (above iOS's
       floating keyboard pill) instead of a full-width strip (which leaves that
       pill showing through the middle gap). */
    .mobile-format-bar.compact {
        left: 50%;
        right: auto;
        transform: translateX(-50%);
        width: fit-content;
        max-width: calc(100vw - 1.5rem);
        gap: 0.125rem;
        padding: 0.25rem;
        border: 1px solid rgba(0, 0, 0, 0.08);
        border-radius: 0.875rem;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
        background: rgba(255, 255, 255, 0.92);
    }

    .spacer {
        flex: 1;
    }

    .divider {
        flex: 0 0 auto;
        width: 1px;
        height: 1.25rem;
        margin: 0 0.125rem;
        background: rgba(0, 0, 0, 0.12);
    }

    button {
        flex: 0 0 auto;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 0.5rem;
        color: rgba(0, 0, 0, 0.72);
        background: transparent;
        transition: background-color 0.12s ease;
    }
    button:active {
        background: rgba(0, 0, 0, 0.08);
    }

    button.primary {
        gap: 0.375rem;
        height: 2.25rem;
        padding: 0 0.75rem;
        font-size: 0.875rem;
        font-weight: 500;
    }

    button.icon {
        width: 2.25rem;
        height: 2.25rem;
    }
    button.icon.active {
        background: rgba(0, 0, 0, 0.08);
    }

    .format-popover {
        position: fixed;
        left: 0;
        right: 0;
        z-index: 60;
        display: flex;
        align-items: center;
        gap: 0.25rem;
        padding: 0.25rem 0.5rem;
        overflow-x: auto;
        scrollbar-width: none;
        background: rgba(255, 255, 255, 0.92);
        backdrop-filter: blur(12px);
        border-top: 1px solid rgba(0, 0, 0, 0.06);
        touch-action: none;
    }
    .format-popover::-webkit-scrollbar {
        display: none;
    }
    .format-popover button {
        width: 2.25rem;
        height: 2.25rem;
    }

    /* Match the centered compact pill so the popover reads as part of it. */
    .format-popover.compact {
        left: 50%;
        right: auto;
        transform: translateX(-50%);
        width: fit-content;
        max-width: calc(100vw - 1.5rem);
        gap: 0.125rem;
        padding: 0.25rem;
        border: 1px solid rgba(0, 0, 0, 0.08);
        border-radius: 0.875rem;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
    }
</style>
