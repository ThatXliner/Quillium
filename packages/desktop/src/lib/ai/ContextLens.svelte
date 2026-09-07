<script lang="ts">
import { getEffectiveDocumentContext } from "$lib/ai/settings.svelte";
import { appSettings, updateSettings } from "$lib/settings.svelte";
import HelpModal from "$lib/ui/HelpModal.svelte";
import InfoButton from "$lib/ui/InfoButton.svelte";
import { getActionHelpTab } from "./helpContent";
import {
    activeAnnotation,
    annotations,
    documentContent,
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
    ScanTextIcon,
} from "lucide-svelte";
import { buildAnnotationContextInputs } from "./annotationContext";
import {
    type ContextAction,
    buildAiContextPacket,
    contextScopeDetail,
    contextScopeLabel,
    getContextAwareActions,
    shouldShowContextSummary,
} from "./context";

const {
    mode,
    disabled = false,
    onAction,
}: {
    mode: "chat" | "feedback" | "revise";
    disabled?: boolean;
    onAction: (action: ContextAction) => void | Promise<void>;
} = $props();

const annotationContext = $derived(
    buildAnnotationContextInputs({
        annotations: $annotations,
        documentContent: $documentContent,
        selectedText: $selectedText,
        selectedTextRange: $selectedTextRange,
        activeAnnotation: $activeAnnotation,
    }),
);

const packet = $derived(
    buildAiContextPacket({
        mode,
        documentContent: $documentContent,
        selectedText: $selectedText,
        selectedTextRange: $selectedTextRange,
        documentContext: getEffectiveDocumentContext(),
        annotationContext,
    }),
);
const actions = $derived(getContextAwareActions(mode, packet));
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

const theme = $derived(
    mode === "feedback"
        ? {
              text: "text-green-800",
              subtext: "text-green-700/65",
              border: "border-green-200/70",
              bg: "bg-green-50/70",
              hover: "hover:bg-green-50",
              icon: "bg-green-100 text-green-700",
              ring: "focus:ring-green-500",
          }
        : mode === "revise"
          ? {
                text: "text-purple-800",
                subtext: "text-purple-700/65",
                border: "border-purple-200/70",
                bg: "bg-purple-50/70",
                hover: "hover:bg-purple-50",
                icon: "bg-purple-100 text-purple-700",
                ring: "focus:ring-purple-500",
            }
          : {
                text: "text-blue-800",
                subtext: "text-blue-700/65",
                border: "border-blue-200/70",
                bg: "bg-blue-50/70",
                hover: "hover:bg-blue-50",
                icon: "bg-blue-100 text-blue-700",
                ring: "focus:ring-blue-500",
            },
);

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

<div class="p-3 border-b border-black/10 space-y-2.5">
    {#if showContextSummary}
        <div class="rounded-lg border {theme.border} {theme.bg} p-2.5">
            <div class="flex items-start gap-2">
                <div class="mt-0.5 shrink-0 rounded-md p-1.5 {theme.icon}">
                    <ScopeIcon size={14} />
                </div>
                <div class="min-w-0 flex-1">
                    <div class="text-xs font-semibold {theme.text}">{contextScopeLabel(packet)}</div>
                    <div class="text-[10px] leading-snug {theme.subtext}">
                        {contextScopeDetail(packet)}
                    </div>
                </div>
                <button
                    type="button"
                    onclick={hideContextSummary}
                    aria-label="Hide context summary (collapse into the info icon)"
                    title="Hide — collapse into the info icon"
                    class="-mt-0.5 -mr-0.5 flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5
                        text-[10px] font-medium {theme.subtext} hover:bg-white/60
                        focus:outline-none focus:ring-2 {theme.ring} transition-colors"
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
                        disabled:opacity-45 disabled:cursor-not-allowed {theme.hover}
                        focus:outline-none focus:ring-2 {theme.ring}"
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

{#if actionHelpTab}
    <HelpModal
        title={mode === "chat" ? "Chat actions" : mode === "feedback" ? "Feedback actions" : "Revision actions"}
        tabs={actions.map(getActionHelpTab)}
        initialTab={actionHelpTab}
        footer={mode === "chat"
            ? "The answer appears in chat. Your draft and annotations stay unchanged."
            : mode === "feedback"
              ? "Feedback appears in the panel and may add comments anchored to your writing. Your draft's wording stays unchanged."
              : "AI proposes edits for you to review. You choose which changes to accept."}
        onclose={() => (actionHelpTab = null)}
    />
{/if}
