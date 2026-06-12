<script lang="ts">
import {
    ArrowRightIcon,
    BookOpenIcon,
    FileTextIcon,
    InfoIcon,
    MousePointer2Icon,
    NotebookTabsIcon,
    MessageSquareTextIcon,
    ScanTextIcon,
} from "lucide-svelte";
import {
    activeAnnotation,
    annotations,
    documentContent,
    selectedText,
    selectedTextRange,
} from "$lib/stores";
import { documentContext } from "$lib/ai/settings.svelte";
import { buildAnnotationContextInputs } from "./annotationContext";
import {
    buildAiContextPacket,
    contextScopeDetail,
    contextScopeLabel,
    getContextAwareActions,
    type ContextAction,
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
        documentContext: { freeform: documentContext.freeform },
        annotationContext,
    }),
);
const actions = $derived(getContextAwareActions(mode, packet));
const activeSources = $derived(packet.sources.filter((source) => source.active));
const showContextSummary = $derived(
    packet.scope !== "document" ||
        packet.omittedDocumentChars > 0 ||
        packet.includedAnnotationCount > 0 ||
        packet.writerContext.length > 0,
);
const contextInfoLabel = $derived(`${contextScopeLabel(packet)}. ${contextScopeDetail(packet)}`);

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
    {:else}
        <div class="flex justify-end">
            <button
                type="button"
                aria-label="Context: {contextInfoLabel}"
                title={contextInfoLabel}
                class="inline-flex h-6 w-6 items-center justify-center rounded-md text-black/25 transition-colors hover:bg-white/60 hover:text-black/45 focus:outline-none focus:ring-2 {theme.ring}"
            >
                <InfoIcon size={13} />
            </button>
        </div>
    {/if}

    <div class="grid gap-1.5">
        {#each actions as action (action.id)}
            <button
                type="button"
                onclick={() => onAction(action)}
                {disabled}
                class="group w-full rounded-lg border border-black/10 bg-white/80 px-2.5 py-2 text-left shadow-sm transition-all
                    disabled:opacity-45 disabled:cursor-not-allowed {theme.hover}
                    focus:outline-none focus:ring-2 {theme.ring}"
            >
                <div class="flex items-start gap-2">
                    <div class="min-w-0 flex-1">
                        <div class="text-xs font-semibold text-black/75 truncate">{action.label}</div>
                        <div class="text-[10px] leading-snug text-black/40">{action.detail}</div>
                    </div>
                    <ArrowRightIcon
                        size={13}
                        class="mt-0.5 shrink-0 text-black/25 transition-transform group-hover:translate-x-0.5 group-hover:text-black/45"
                    />
                </div>
            </button>
        {/each}
    </div>
</div>
