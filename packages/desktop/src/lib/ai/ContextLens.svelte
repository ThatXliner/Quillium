<script lang="ts">
import type { Snippet } from "svelte";
import ChatPopover from "./ChatPopover.svelte";
import { getEffectiveDocumentContext } from "$lib/ai/settings.svelte";
import { appSettings, updateSettings } from "$lib/settings.svelte";
import HelpModal from "$lib/ui/HelpModal.svelte";
import InfoButton from "$lib/ui/InfoButton.svelte";
import { getActionHelpTab } from "./helpContent";
import {
    activeAnnotation,
    annotations,
    documentContent,
    editorView,
    selectedText,
    selectedTextRange,
} from "$lib/stores";
import {
    ArrowRightIcon,
    BookOpenIcon,
    EyeOffIcon,
    FileTextIcon,
    MessageSquareTextIcon,
    MousePointer2Icon,
    NotebookTabsIcon,
    ListPlusIcon,
    ScanTextIcon,
} from "lucide-svelte";
import { editorialContextView } from "$lib/ai/editorialTarget";
import { annotationField } from "$lib/editor/plugins/annotations";
import { getActiveAnnotation } from "$lib/editor/plugins/annotations/utils";
import { buildAnnotationContextInputs } from "./annotationContext";
import {
    type ContextAction,
    buildAiContextPacket,
    contextScopeDetail,
    contextScopeLabel,
    getContextAwareActions,
    shouldShowContextSummary,
} from "./context";

let {
    mode,
    disabled = false,
    onAction,
    compact = false,
    active = true,
    startersOnly = false,
    actionsOpen = $bindable(false),
    children,
}: {
    mode?: "chat" | "feedback" | "revise";
    compact?: boolean;
    active?: boolean;
    startersOnly?: boolean;
    actionsOpen?: boolean;
    children?: Snippet;
    disabled?: boolean;
    onAction: (action: ContextAction) => void | Promise<void>;
} = $props();

// Follow the same focused editor as send-time capture, including nested versions.
const contextView = $derived.by(() => {
    // setState on draft load replaces root state without an update-listener event.
    // Root mirrors also trigger this check when a nested view was invalidated.
    void $documentContent;
    void $annotations;
    const snapshot = $editorialContextView;
    return snapshot &&
        snapshot.rootView === $editorView &&
        snapshot.view.state === snapshot.state &&
        snapshot.isCurrent()
        ? snapshot
        : null;
});
const contextState = $derived(contextView?.branchPath.length ? contextView.state : undefined);
const contextText = $derived(contextState?.doc.toString() ?? $documentContent);
const contextSelection = $derived(contextState?.selection.main);
const contextSelectedText = $derived(
    contextState && contextSelection
        ? contextState.sliceDoc(contextSelection.from, contextSelection.to)
        : $selectedText,
);
const contextRange = $derived(
    contextSelection
        ? contextSelection.empty
            ? undefined
            : { from: contextSelection.from, to: contextSelection.to }
        : $selectedTextRange,
);
const contextTargetLabel = $derived(
    contextView?.branchPath.length ? "Focused revision version" : "Current draft",
);
const annotationContext = $derived(
    buildAnnotationContextInputs({
        annotations: contextState ? contextState.field(annotationField, false) : $annotations,
        documentContent: contextText,
        selectedText: contextSelectedText,
        selectedTextRange: contextRange,
        activeAnnotation: contextState ? getActiveAnnotation(contextState) : $activeAnnotation,
    }),
);

const packet = $derived(
    buildAiContextPacket({
        mode: mode ?? "chat",
        documentContent: contextText,
        selectedText: contextSelectedText,
        selectedTextRange: contextRange,
        documentContext: getEffectiveDocumentContext(),
        annotationContext,
    }),
);
const actions = $derived(mode ? getContextAwareActions(mode, packet) : [
    ...getContextAwareActions("chat", packet),
    ...getContextAwareActions("feedback", packet).map((action) => ({
        ...action,
        turn: action.turn ?? { task: "global-review" as const },
    })),
    ...getContextAwareActions("revise", packet).map((action) => ({
        ...action,
        turn: action.turn ?? { task: "local-rewrite" as const },
    })),
]);
const chipLabel = $derived([
    contextView?.branchPath.length ? (packet.scope === "selection" ? "Selection in revision" : "Revision version")
        : packet.scope === "selection" ? "Selection" : packet.scope === "empty" ? "No draft" : packet.omittedDocumentChars ? "Draft excerpt" : "Whole draft",
    packet.includedAnnotationCount ? `${packet.includedAnnotationCount} ${packet.includedAnnotationCount === 1 ? "note" : "notes"}` : "",
    packet.writerContext || packet.collegeBriefText ? "brief" : "",
].filter(Boolean).join(" · "));
let actionHelpTab = $state<string | null>(null);
const activeSources = $derived(packet.sources.filter((source) => source.active));
// Card is shown when the packet warrants a summary AND the writer hasn't
// collapsed it into the header info (ℹ) icon. Sidebar surfaces the same
// packet via that icon's popover whenever this card is hidden.
const showContextSummary = $derived(
    shouldShowContextSummary(packet) && !appSettings.collapseContextSummary,
);

function hideContextSummary() {
    updateSettings({ collapseContextSummary: true });
}

const ScopeIcon = $derived(packet.scope === "selection" ? ScanTextIcon : BookOpenIcon);

function sourceIcon(id: string) {
    if (id === "selection") return MousePointer2Icon;
    if (id === "surrounding") return ScanTextIcon;
    if (id === "annotations") return MessageSquareTextIcon;
    if (id === "writer-context") return NotebookTabsIcon;
    if (id === "editorial-decisions") return NotebookTabsIcon;
    return FileTextIcon;
}
</script>

{#if startersOnly}
    <div class="mt-4 space-y-1">
        {#each actions.slice(0, 3) as action (action.id)}
            <button type="button" {disabled} class="block w-full rounded-lg border-b border-black/10 px-1 py-2 text-left text-xs text-black/75 hover:bg-white/40 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-blue-500" onclick={() => onAction(action)}>{action.label}</button>
        {/each}
    </div>
{:else if compact}
    <ChatPopover label="Sent with your next message" {active}>
        {#snippet trigger()}<ScopeIcon size={14} class="shrink-0" /><span class="truncate">{chipLabel}</span>{/snippet}
        <p class="font-medium">{contextTargetLabel}{packet.scope === "selection" ? " · selected passage" : ""}</p>
        <p class="mt-1 leading-relaxed text-black/65" data-next-turn-context>{contextView?.branchPath.length ? (packet.scope === "selection" ? "The selected passage in this revision version, with nearby text." : "The focused revision version is included as writing context.") : contextScopeDetail(packet)} Changes are noted when you send.</p>
        <ul class="mt-3 space-y-2">
            {#each activeSources.filter(source => source.id !== "selection" && source.id !== "surrounding" && source.id !== "document") as source (source.id)}
                {@const Icon = sourceIcon(source.id)}
                <li class="flex items-start gap-2"><Icon size={14} class="mt-0.5 shrink-0 text-black/55" /><div><span>{source.label}</span><p class="mt-0.5 leading-relaxed text-black/65">{source.detail}</p></div></li>
            {/each}
        </ul>
        <p class="mt-3 leading-relaxed text-black/65">Quillium can read other passages and notes when needed. Earlier replies reflect the writing as it was then.</p>
    </ChatPopover>
    <ChatPopover label="Starting points" {active} bind:open={actionsOpen}>
        {#snippet trigger()}<ListPlusIcon size={14} class="shrink-0" /><span class="sr-only">Starting points</span>{/snippet}
        <div class="space-y-1">
            {#each actions as action (action.id)}
                <button type="button" {disabled} class="block w-full rounded-lg px-2 py-2 text-left text-xs hover:bg-black/5 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-blue-500" onclick={() => onAction(action)}><span class="block font-medium">{action.label}</span><span class="mt-0.5 block text-black/65">{action.detail}</span></button>
            {/each}
        </div>
        {#if children}{@render children()}{/if}
    </ChatPopover>
{:else}
<div class="p-3 border-b border-black/10 space-y-2.5">
    <p class="text-[10px] leading-snug text-black/50" data-next-turn-context>
        Next turn: {contextTargetLabel.toLowerCase()}. Changes are noted when you send.
        Draft passages and annotation discussions can be read on demand.
        Earlier responses describe the writing as it was then.
    </p>
    {#if showContextSummary}
        <div class="rounded-lg border border-blue-200/70 bg-blue-50/70 p-2.5">
            <div class="flex items-start gap-2">
                <div class="mt-0.5 shrink-0 rounded-md p-1.5 bg-blue-100 text-blue-700">
                    <ScopeIcon size={14} />
                </div>
                <div class="min-w-0 flex-1">
                    <div class="text-xs font-semibold text-blue-800">{contextScopeLabel(packet)}</div>
                    <div class="text-[10px] leading-snug text-blue-700/65">
                        {contextScopeDetail(packet)}
                    </div>
                </div>
                <button
                    type="button"
                    onclick={hideContextSummary}
                    aria-label="Hide context summary (collapse into the info icon)"
                    title="Hide — collapse into the info icon"
                    class="-mt-0.5 -mr-0.5 flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5
                        text-[10px] font-medium text-blue-700/65 hover:bg-white/60
                        focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
                >
                    <EyeOffIcon size={11} />
                    Hide
                </button>
            </div>

            {#if activeSources.length > 0}
                <div class="mt-2 grid grid-cols-2 gap-1">
                    {#each activeSources as source (source.id)}
                        {@const SourceIcon = sourceIcon(source.id)}
                        <div
                            class="min-w-0 flex items-center gap-1 rounded-md bg-white/55 px-1.5 py-1 text-[10px] text-black/45"
                            title="{source.label}: {source.detail}"
                        >
                            <SourceIcon size={11} class="shrink-0 text-black/30" />
                            <span class="truncate">{source.label}</span>
                            <span class="ml-auto shrink-0 tabular-nums">{source.chars.toLocaleString()}</span>
                        </div>
                    {/each}
                </div>
            {/if}
        </div>
    {/if}

    <div class="grid gap-1.5">
        {#each actions as action (action.id)}
            <div class="flex items-center gap-1 rounded-lg border border-black/10 bg-white/80 pr-2 shadow-sm">
                <button
                    type="button"
                    onclick={() => onAction(action)}
                    {disabled}
                    class="group min-w-0 flex-1 rounded-lg px-2.5 py-2 text-left transition-all
                        disabled:opacity-45 disabled:cursor-not-allowed hover:bg-blue-50
                        focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                    <div class="flex items-center gap-2">
                        <div class="min-w-0 flex-1">
                            <div class="text-xs font-semibold text-black/75 truncate">{action.label}</div>
                            <div class="text-[10px] leading-snug text-black/40">{action.detail}</div>
                        </div>
                        <ArrowRightIcon
                            size={13}
                            class="shrink-0 text-black/25 transition-transform group-hover:translate-x-0.5 group-hover:text-black/45"
                        />
                    </div>
                </button>
                <InfoButton title={action.label} onclick={() => (actionHelpTab = action.id)} />
            </div>
        {/each}
    </div>
</div>

{/if}

{#if actionHelpTab}
    <HelpModal
        title="Writing actions"
        tabs={actions.map(getActionHelpTab)}
        initialTab={actionHelpTab}
        footer="Discuss your writing, add feedback, or request revisions in the same conversation. You choose which wording changes to accept."
        onclose={() => (actionHelpTab = null)}
    />
{/if}
