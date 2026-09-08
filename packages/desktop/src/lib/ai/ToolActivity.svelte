<script lang="ts">
import { getToolName, isToolUIPart, type UIMessage } from "ai";
let { part, active = false }: { part: UIMessage["parts"][number]; active?: boolean } = $props();
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
    createComment: "Create comment",
    createSuggestion: "Create suggestion",
    createRevision: "Create revision",
    noAction: "No editorial change",
};
function format(value: unknown): string {
    return typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? "None");
}
</script>

<svelte:window onkeydown={updateModifier} onkeyup={updateModifier} onblur={hideDetails} />
<svelte:document onvisibilitychange={hideDetails} />

{#if tool}
    {@const name = getToolName(tool)}
    {@const status = tool.state === "output-available" ? "Result received" : tool.state === "output-error" ? "Failed" : tool.state === "output-denied" ? "Denied" : active ? "Running…" : "No result recorded"}
    <details bind:open={expanded} class="my-2 rounded-lg border border-black/10 bg-white/30 text-xs text-black/70" data-tool-call={tool.toolCallId}>
        <summary title="Hold Command and click to inspect tool details" class="px-3 py-2 {commandHeld ? 'cursor-pointer' : 'list-none'}"
            onclick={(event) => { commandHeld = event.metaKey; if (!commandHeld) { event.preventDefault(); expanded = false; } }}><span class="font-medium">{names[name] || name}</span><span class="ml-2 text-black/60">{status}</span></summary>
        {#if commandHeld}
        <div class="space-y-3 border-t border-black/5 px-3 py-3">
            <div><p class="mb-1 font-medium">Input</p><pre class="max-h-52 overflow-auto whitespace-pre-wrap break-words font-mono">{format(tool.input)}</pre></div>
            {#if tool.state === "output-available"}
                <div><p class="mb-1 font-medium">Result</p><pre class="max-h-52 overflow-auto whitespace-pre-wrap break-words font-mono">{format(tool.output)}</pre></div>
                <p class="text-black/60">This is the tool response. Editor changes are checked separately before being applied.</p>
            {:else if tool.state === "output-error"}
                <p class="text-red-700">{tool.errorText}</p>
            {/if}
            <p class="break-all text-black/50">{name} · {tool.toolCallId}</p>
        </div>
        {/if}
    </details>
{/if}
