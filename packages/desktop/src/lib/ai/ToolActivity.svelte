<script lang="ts">
import { Check, CircleAlert, LoaderCircle, Circle } from "lucide-svelte";
import { getToolName, isToolUIPart, type UIMessage } from "ai";
let {
    part,
    active = false,
    outcomes = {},
    metadata,
}: {
    part: UIMessage["parts"][number];
    active?: boolean;
    outcomes?: Record<string, unknown>;
    metadata?: unknown;
} = $props();
function application(id: string): { status: "applied" | "skipped"; reason?: string } | undefined {
    const saved =
        metadata && typeof metadata === "object" && "toolApplications" in metadata
            ? metadata.toolApplications
            : undefined;
    const value =
        outcomes[id] ??
        (saved && typeof saved === "object" ? (saved as Record<string, unknown>)[id] : undefined);
    if (
        !value ||
        typeof value !== "object" ||
        !("status" in value) ||
        (value.status !== "applied" && value.status !== "skipped")
    )
        return;
    return {
        status: value.status,
        reason: "reason" in value && typeof value.reason === "string" ? value.reason : undefined,
    };
}
let commandHeld = $state(false);
let expanded = $state(false);
function updateModifier(event: KeyboardEvent) {
    commandHeld = event.metaKey;
    if (!commandHeld) expanded = false;
}
function hideDetails() {
    commandHeld = false;
    expanded = false;
}
const tool = $derived(isToolUIPart(part) ? part : null);
const names: Record<string, string> = {
    createComment: "Comment",
    createSuggestion: "Suggestion",
    createRevision: "Revision",
    noAction: "Review",
};
function format(value: unknown): string {
    return typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? "None");
}
</script>

<svelte:window onkeydown={updateModifier} onkeyup={updateModifier} onblur={hideDetails} />
<svelte:document onvisibilitychange={hideDetails} />

{#if tool}
    {@const name = getToolName(tool)}
    {@const outcome = application(tool.toolCallId)}
    {@const label = names[name] || "Assistant action"}
    {@const failed = outcome?.status === "skipped" || (!outcome && (tool.state === "output-error" || tool.state === "output-denied"))}
    {@const running = !outcome && active && tool.state !== "output-available" && !failed}
    {@const summary = outcome?.status === "applied" ? `${label} added` : failed ? `Couldn't ${names[name] ? "add" : "complete"} ${label.toLowerCase()}` : name === "noAction" && tool.state === "output-available" ? "Review complete · no changes suggested" : running ? `Preparing ${label.toLowerCase()}…` : tool.state === "output-available" ? `${label} requested` : `${label} interrupted`}
    <details bind:open={expanded} class="my-1 text-xs text-black/60" data-tool-call={tool.toolCallId}>
        <summary title="Hold Command and click to inspect tool details" class="flex items-center gap-2 rounded-md py-1.5 list-none {commandHeld ? 'cursor-pointer hover:bg-black/5' : ''}"
            onclick={(event) => { commandHeld = event.metaKey; if (!commandHeld) { event.preventDefault(); expanded = false; } }}>
            {#if outcome?.status === "applied" || name === "noAction" && tool.state === "output-available"}<Check size={14} aria-hidden="true" />
            {:else if failed}<CircleAlert size={14} aria-hidden="true" />
            {:else if running}<LoaderCircle size={14} class="animate-spin motion-reduce:animate-none" aria-hidden="true" />
            {:else}<Circle size={12} aria-hidden="true" />{/if}
            <span>{summary}</span>
        </summary>
        {#if commandHeld}
        <div class="space-y-3 rounded-lg border border-black/10 bg-white/30 px-3 py-3">
            {#if outcome}<p>Editor outcome: {outcome.status}{outcome.reason ? ` · ${outcome.reason}` : ""}</p>{/if}
            <div><p class="mb-1 font-medium">Input</p><pre class="max-h-52 overflow-auto whitespace-pre-wrap break-words font-mono">{format(tool.input)}</pre></div>
            {#if tool.state === "output-available"}
                <div><p class="mb-1 font-medium">Result</p><pre class="max-h-52 overflow-auto whitespace-pre-wrap break-words font-mono">{format(tool.output)}</pre></div>
                {#if !outcome}<p class="text-black/60">This older activity has no saved editor outcome.</p>{/if}
            {:else if tool.state === "output-error"}
                <p class="text-red-700">{tool.errorText}</p>
            {/if}
            <p class="break-all text-black/50">{name} · {tool.toolCallId}</p>
        </div>
        {/if}
    </details>
{/if}
