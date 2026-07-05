<!--
    HarperTooltip.svelte — Floating tooltip for Harper grammar/spelling diagnostics.

    Listens for hover on .cm-lintRange elements in the editor, reads diagnostic
    data from the CodeMirror lint state, and renders a popover styled identically
    to the DictionaryPopover.
-->
<script lang="ts">
import { editorView } from "$lib/stores";
import { type Action, type Diagnostic, forEachDiagnostic, forceLinting } from "./lint";

let visible = $state(false);
let posX = $state(0);
let posY = $state(0);
let diagnostic = $state<Diagnostic | null>(null);
let diagFrom = $state(0);
let diagTo = $state(0);
let tooltipEl = $state<HTMLDivElement | undefined>();
let suppressedFrom = $state(-1);
let suppressedTo = $state(-1);

type DiagnosticMatch = { diagnostic: Diagnostic; from: number; to: number };

function findDiagnosticAtPosition(pos: number): DiagnosticMatch | null {
    const view = $editorView;
    if (!view) return null;

    let found: DiagnosticMatch | null = null;
    forEachDiagnostic(view.state, (d, from, to) => {
        if (pos >= from && pos <= to && !found) {
            found = { diagnostic: d, from, to };
        }
    });
    return found;
}

function showForElement(target: HTMLElement) {
    const view = $editorView;
    if (!view) return;

    const pos = view.posAtDOM(target);
    if (pos < 0) return;

    const match = findDiagnosticAtPosition(pos);
    if (!match) return;

    // If this is the same word that was X-dismissed, don't reopen
    if (match.from === suppressedFrom && match.to === suppressedTo) return;

    // Clicking a different word clears the suppression
    suppressedFrom = -1;
    suppressedTo = -1;

    diagnostic = match.diagnostic;
    diagFrom = match.from;
    diagTo = match.to;

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
        forceLinting(view);
    }
}

function applySuggestion(action: Action) {
    const view = $editorView;
    if (!view || !diagnostic) return;
    action.apply(view, diagFrom, diagTo);
    dismiss();
}

function diagnosticMessageHtml(d: Diagnostic): string {
    const view = $editorView;
    if (!view || !d.renderMessage) return d.message;
    const rendered = d.renderMessage(view);
    if (rendered instanceof HTMLElement) return rendered.innerHTML;
    const wrapper = document.createElement("span");
    wrapper.append(rendered.cloneNode(true));
    return wrapper.innerHTML;
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

let suggestionActions = $derived(diagnostic?.actions?.filter((a) => a.kind !== "dictionary") ?? []);
let dictionaryAction = $derived(diagnostic?.actions?.find((a) => a.kind === "dictionary") ?? null);
</script>

<svelte:window onkeydown={handleKeydown} />

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
                {@html diagnosticMessageHtml(diagnostic)}
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
