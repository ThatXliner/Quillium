<!--
    HarperTooltip.svelte — Floating tooltip for Harper grammar/spelling diagnostics.

    Listens for hover on .cm-lintRange elements in the editor, reads diagnostic
    data from the CodeMirror lint state, and renders a popover styled identically
    to the DictionaryPopover.
-->
<script lang="ts">
import { editorView } from "$lib/stores";
import { forEachDiagnostic, type Diagnostic, type Action } from "./lint";

let visible = $state(false);
let posX = $state(0);
let posY = $state(0);
let diagnostic = $state<Diagnostic | null>(null);
let diagFrom = $state(0);
let diagTo = $state(0);
let tooltipEl = $state<HTMLDivElement | undefined>();
let tooltipsDisabled = $state(false);
let hasSquiggles = $state(false);
let muteTabX = $state(0);
let muteTabY = $state(0);
let suppressedFrom = $state(-1);
let suppressedTo = $state(-1);

function showForElement(target: HTMLElement) {
    if (tooltipsDisabled) return;
    const view = $editorView;
    if (!view) return;

    const pos = view.posAtDOM(target);
    if (pos < 0) return;

    let found: { diagnostic: Diagnostic; from: number; to: number } | null = null;
    forEachDiagnostic(view.state, (d, from, to) => {
        if (pos >= from && pos <= to && !found) {
            found = { diagnostic: d, from, to };
        }
    });

    if (!found) return;

    // If this is the same word that was X-dismissed, don't reopen
    if (found.from === suppressedFrom && found.to === suppressedTo) return;

    // Clicking a different word clears the suppression
    suppressedFrom = -1;
    suppressedTo = -1;

    diagnostic = found.diagnostic;
    diagFrom = found.from;
    diagTo = found.to;

    const rect = target.getBoundingClientRect();

    posX = rect.left;
    posY = rect.bottom + 4;
    visible = true;

    requestAnimationFrame(() => {
        if (!tooltipEl) return;
        const w = tooltipEl.clientWidth;
        const h = tooltipEl.clientHeight;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        posX = Math.min(Math.max(posX, 8), vw - w - 8);
        if (posY + h > vh - 8) {
            posY = rect.top - h - 4;
        }
    });
}

function dismiss() {
    visible = false;
    diagnostic = null;
}

function dismissAndSuppress() {
    suppressedFrom = diagFrom;
    suppressedTo = diagTo;
    dismiss();
}

function ignoreDiagnostic() {
    if (diagnostic?.ignore) {
        diagnostic.ignore();
    }
    dismiss();
    const view = $editorView;
    if (view) {
        view.dispatch({ changes: [] });
    }
}

function applySuggestion(action: Action) {
    const view = $editorView;
    if (!view || !diagnostic) return;
    action.apply(view, diagFrom, diagTo);
    dismiss();
}

function handleClick(e: MouseEvent) {
    const target = (e.target as HTMLElement).closest?.(".cm-lintRange") as HTMLElement | null;
    if (target) {
        showForElement(target);
    } else if (visible && !tooltipEl?.contains(e.target as Node)) {
        dismiss();
    }
}

function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && visible) dismiss();
}

// Listen for click on the editor
$effect(() => {
    const view = $editorView;
    if (!view) return;

    const editorDom = view.dom;
    editorDom.addEventListener("click", handleClick);

    return () => {
        editorDom.removeEventListener("click", handleClick);
    };
});

// Dismiss on scroll
$effect(() => {
    if (!visible) return;
    const scrollEl = document.querySelector("#editor-document");
    if (!scrollEl) return;
    const onScroll = () => dismiss();
    scrollEl.addEventListener("scroll", onScroll);
    return () => scrollEl.removeEventListener("scroll", onScroll);
});

// Track whether there are any squiggles in the document
$effect(() => {
    const view = $editorView;
    if (!view) {
        hasSquiggles = false;
        return;
    }
    let count = 0;
    forEachDiagnostic(view.state, () => {
        count++;
    });
    hasSquiggles = count > 0;
});

// Dismiss tooltip when suggestions are disabled
$effect(() => {
    if (tooltipsDisabled && visible) dismiss();
});

// Position "Mute suggestions" tab at inside top-right of the document card
$effect(() => {
    if (!hasSquiggles) return;
    const card = document.getElementById("editor-document");
    if (!card) return;

    function update() {
        const rect = card!.getBoundingClientRect();
        muteTabX = rect.right;
        muteTabY = rect.top;
    }

    update();
    const parent = card.parentElement;
    if (parent) parent.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
        if (parent) parent.removeEventListener("scroll", update);
        window.removeEventListener("resize", update);
    };
});

let suggestionActions = $derived(diagnostic?.actions?.filter((a) => a.kind !== "dictionary") ?? []);
let dictionaryAction = $derived(diagnostic?.actions?.find((a) => a.kind === "dictionary") ?? null);
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- Mute suggestions tab — attached to top-right of document card -->
{#if hasSquiggles}
    <label
        class="fixed z-50 flex items-center gap-1.5 px-3 py-1.5
            text-[11px] text-gray-400 hover:text-gray-500
            bg-white rounded-tl-lg rounded-tr-lg
            border-l border-t border-r border-gray-200/60
            shadow-sm
            transition-colors cursor-pointer select-none
            -translate-x-full -translate-y-full"
        style="left: {muteTabX}px; top: {muteTabY}px;"
    >
        <input
            type="checkbox"
            bind:checked={tooltipsDisabled}
            class="accent-gray-400 w-3 h-3 cursor-pointer"
        />
        Mute suggestions
    </label>
{/if}

{#if visible && diagnostic}
    <!-- Tooltip -->
    <div
        bind:this={tooltipEl}
        class="harper-tooltip-popover fixed z-[100] w-72
            backdrop-blur-md bg-white/90 border border-white/40 shadow-xl rounded-2xl
            overflow-hidden"
        style="left: {posX}px; top: {posY}px;"
        role="tooltip"
    >
        <div class="p-3 flex flex-col gap-2">
            <!-- Category label + close button -->
            <div class="flex items-center justify-between">
                <span class="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                    {diagnostic.title}
                </span>
                <button
                    class="text-gray-300 hover:text-gray-500 transition-colors cursor-pointer -mr-1 -mt-1"
                    onclick={dismissAndSuppress}
                    aria-label="Close"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                </button>
            </div>

            <!-- Message -->
            <span class="text-[13px] text-gray-700 leading-snug [&_code]:whitespace-nowrap [&_code]:font-semibold">
                {#if diagnostic.renderMessage}
                    {@html diagnostic.renderMessage().innerHTML}
                {:else}
                    {diagnostic.message}
                {/if}
            </span>

            <!-- Action buttons -->
            <div class="flex flex-wrap gap-1">
                {#each suggestionActions as action}
                    <button
                        class="px-2 py-0.5 text-xs rounded-full border border-gray-200 bg-gray-50 text-gray-700
                            hover:bg-blue-500 hover:border-blue-500 hover:text-white transition-colors cursor-pointer"
                        onclick={() => applySuggestion(action)}
                    >
                        {action.name}
                    </button>
                {/each}
                {#if dictionaryAction}
                    {@const dictAction = dictionaryAction}
                    <button
                        class="px-2 py-0.5 text-xs rounded-full border border-gray-200 bg-gray-50 text-gray-500
                            hover:bg-gray-100 hover:border-gray-300 hover:text-gray-700 transition-colors cursor-pointer"
                        onclick={() => applySuggestion(dictAction)}
                    >
                        {dictAction.name}
                    </button>
                {/if}
            </div>

            <!-- Ignore -->
            <button
                class="text-xs text-gray-400 hover:text-gray-600 transition-colors cursor-pointer text-left"
                onclick={ignoreDiagnostic}
            >
                Ignore
            </button>
        </div>
    </div>
{/if}
