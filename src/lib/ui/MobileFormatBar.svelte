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

    Desktop is untouched: the bar only renders when `enabled` (a mobile flag from
    +page.svelte) is true AND the editor is focused with the keyboard open.
-->
<script lang="ts">
import { type MarkdownFormat, formatMarkdownSelection } from "$lib/editor/markdownFormatting";
import { createCommentCommand, createRevisionCommand } from "$lib/editor/plugins/annotations";
import { editorView } from "$lib/stores";
import {
    BoldIcon,
    ChevronDownIcon,
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
} from "lucide-svelte";

let { enabled = false }: { enabled?: boolean } = $props();

// Distance from the bottom of the layout viewport to the top of the keyboard.
// 0 means no on-screen keyboard (hardware keyboard, floating/minimized
// keyboard, or keyboard closed) — the bar then pins to the bottom of the screen.
let keyboardBottom = $state(0);
let editorFocused = $state(false);
let formatOpen = $state(false);

// Visible whenever the editor has focus — NOT gated on the on-screen keyboard,
// so it still shows with a hardware/floating keyboard (which barely shrinks the
// visual viewport). Position handles the keyboard-up vs keyboard-down cases.
const visible = $derived(enabled && editorFocused);

// When the keyboard is up we sit flush on top of it. When it's down/floating we
// pin to the screen bottom but clear the home-indicator safe area.
const barBottom = $derived(
    keyboardBottom > 0 ? `${keyboardBottom}px` : "env(safe-area-inset-bottom, 0px)",
);
const popoverBottom = $derived(
    keyboardBottom > 0
        ? `${keyboardBottom + 48}px`
        : "calc(env(safe-area-inset-bottom, 0px) + 48px)",
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
    editorFocused = !!$editorView && !!el && $editorView.dom.contains(el);
    if (!editorFocused) formatOpen = false;
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
    $editorView && formatMarkdownSelection($editorView, format);
}

function runComment() {
    const view = $editorView;
    if (!view) return;
    createCommentCommand(view);
    view.focus();
}

function runRevision() {
    const view = $editorView;
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

        <span class="spacer"></span>

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
            title="Hide keyboard"
            onpointerdown={(e) => {
                e.preventDefault();
                dismissKeyboard();
            }}
        >
            <ChevronDownIcon size={20} />
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

    .spacer {
        flex: 1;
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
</style>
