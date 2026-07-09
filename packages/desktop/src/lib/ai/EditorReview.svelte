<!--
    EditorReview.svelte — Unified one-click editor surface.

    Scaffolds the package's "editor in the margin" UX on top of the current
    annotation-first feedback stream. The typed editor contract determines focus,
    risk, policy posture, and replacement permission before the request reaches
    the model.
-->
<script lang="ts">
import {
    beginAiTask,
    createAiChat,
    endAiTask,
    runMultiPersonaStreams,
    useAiChatEffects,
} from "$lib/ai/chatFactory";
import { streamFeedback } from "$lib/ai/clientStreams";
import { personaModes, setPersonasForMode } from "$lib/ai/settings.svelte";
import {
    type DocumentRiskLevel,
    type EditorFocus,
    type PolicyPosture,
    buildEditorRequest,
    computeReplacementPermission,
} from "$lib/ai/editor";
import { renderMarkdown } from "$lib/ai/utils";
import { appEventBus } from "$lib/events/appEventBus";
import posthog from "$lib/posthog";
import { getEnabledPersonas } from "$lib/readers/settings.svelte";
import { documentContent, selectedText } from "$lib/stores";
import { ShieldCheckIcon, SparklesIcon, UsersIcon } from "lucide-svelte";

type FocusOption = {
    id: EditorFocus;
    label: string;
};

const focusOptions: FocusOption[] = [
    { id: "reader_view", label: "Reader View" },
    { id: "voice_guard", label: "Voice Guard" },
    { id: "specificity", label: "Specificity" },
    { id: "structure", label: "Structure" },
    { id: "clarity", label: "Clarity" },
    { id: "line_notes", label: "Line Notes" },
    { id: "grammar_only", label: "Grammar Only" },
    { id: "policy_safety", label: "Policy Safety" },
    { id: "challenge", label: "Challenge" },
];

const documentRiskOptions: Array<{ value: DocumentRiskLevel; label: string }> = [
    { value: "ordinary", label: "Ordinary" },
    { value: "high_stakes", label: "High stakes" },
    { value: "college_application", label: "College app" },
];

const policyOptions: Array<{ value: PolicyPosture; label: string }> = [
    { value: "normal", label: "Normal" },
    { value: "unknown", label: "Unknown" },
    { value: "grammar_only", label: "Grammar only" },
    { value: "no_substantive_ai_content", label: "No substantive AI" },
    { value: "custom", label: "Custom policy" },
];

let input = $state("Look at this and leave the highest-leverage margin notes.");
let selectedFocuses = $state<EditorFocus[]>([
    "reader_view",
    "voice_guard",
    "specificity",
    "clarity",
]);
let documentRiskLevel = $state<DocumentRiskLevel>("ordinary");
let policyPosture = $state<PolicyPosture>("normal");
let personaInFlight = $state(false);

const { chat, clearChat } = createAiChat({ mode: "feedback" });

let replacementPermission = $derived(
    computeReplacementPermission({
        documentRiskLevel,
        policyPosture,
        focus: selectedFocuses,
    }),
);
let protectedMode = $derived(documentRiskLevel !== "ordinary" || policyPosture !== "normal");
let hasConversationActivity = $derived(
    chat.messages.length > 0 || chat.status !== "ready" || personaInFlight || !!chat.error,
);

useAiChatEffects(chat);

$effect(() => {
    const unsub = appEventBus.on("stop-ai", () => {
        personaInFlight = false;
    });
    return unsub;
});

function toggleFocus(focus: EditorFocus) {
    if (selectedFocuses.includes(focus)) {
        if (selectedFocuses.length === 1) return;
        selectedFocuses = selectedFocuses.filter((item) => item !== focus);
        return;
    }
    selectedFocuses = [...selectedFocuses, focus];
}

function clearConversation() {
    clearChat();
    personaInFlight = false;
}

function targetLabel(): string {
    return $selectedText ? "the selected text" : "the current draft";
}

function buildReviewMessage() {
    const request = buildEditorRequest({
        surface: "one_click_editor",
        selectedText: $selectedText || undefined,
        userIntent: input,
        focus: selectedFocuses,
        documentRiskLevel,
        policyPosture,
        maxAnnotations: 5,
        persona: { enabledForThisSurface: personaModes.editor },
    });

    return `Run Quillium Editor on ${targetLabel()}.

Use this typed request:
${JSON.stringify(request, null, 2)}

Return results as margin annotations by using the available tools. For protected writing, do not create substantive replacement prose or revision versions; use comments with questions, diagnosis, reader-view feedback, voice warnings, specificity prompts, and writer-executed revision strategies.`;
}

async function sendEditorRequest(trigger: string) {
    if (chat.status !== "ready" || personaInFlight || !$documentContent.trim()) return;

    const message = buildReviewMessage();
    const personas = personaModes.editor ? getEnabledPersonas() : [];

    posthog.capture("ai_editor_requested", {
        has_selection: !!$selectedText,
        trigger,
        focus: selectedFocuses,
        document_risk_level: documentRiskLevel,
        policy_posture: policyPosture,
        replacement_permission: replacementPermission,
        persona_count: personas.length,
    });

    if (personas.length === 0) {
        chat.sendMessage({ text: message });
        return;
    }

    personaInFlight = true;
    const task = beginAiTask("editor-personas");
    try {
        await runMultiPersonaStreams({
            personas,
            streamFn: streamFeedback,
            messages: [{ id: "1", role: "user", parts: [{ type: "text", text: message }] }],
            mode: "editor",
        });
    } finally {
        personaInFlight = false;
        endAiTask(task);
    }
}

function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    sendEditorRequest("manual");
}

function togglePersonaMode() {
    const next = !personaModes.editor;
    setPersonasForMode("editor", next);
    posthog.capture("persona_mode_toggled", { mode: "editor", enabled: next });
}

function updateDocumentRisk(event: Event) {
    documentRiskLevel = (event.currentTarget as HTMLSelectElement).value as DocumentRiskLevel;
}

function updatePolicyPosture(event: Event) {
    policyPosture = (event.currentTarget as HTMLSelectElement).value as PolicyPosture;
}
</script>

<div class="flex-1 flex flex-col min-h-0">
    <div class="border-b border-black/10 p-3 space-y-3 shrink-0">
        <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-1.5 text-xs font-semibold text-black/60">
                <SparklesIcon class="h-3.5 w-3.5" />
                Ask Editor
            </div>
            <button
                type="button"
                onclick={() => sendEditorRequest("primary")}
                disabled={chat.status !== "ready" || personaInFlight || !$documentContent.trim()}
                class="rounded-md bg-teal-600 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-45"
            >
                Review
            </button>
        </div>

        {#if protectedMode}
            <div class="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-[10px] leading-snug text-amber-800">
                <ShieldCheckIcon class="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>Protected writing: substantive rewrites stay in the margins. Grammar fixes only.</span>
            </div>
        {/if}

        <div class="grid grid-cols-2 gap-2">
            <label class="space-y-1">
                <span class="text-[10px] font-medium uppercase text-black/35">Risk</span>
                <select
                    value={documentRiskLevel}
                    onchange={updateDocumentRisk}
                    class="w-full rounded-md border border-black/10 bg-white/80 px-2 py-1.5 text-xs text-black/65 focus:outline-none focus:ring-2 focus:ring-teal-500"
                >
                    {#each documentRiskOptions as option}
                        <option value={option.value}>{option.label}</option>
                    {/each}
                </select>
            </label>
            <label class="space-y-1">
                <span class="text-[10px] font-medium uppercase text-black/35">Policy</span>
                <select
                    value={policyPosture}
                    onchange={updatePolicyPosture}
                    class="w-full rounded-md border border-black/10 bg-white/80 px-2 py-1.5 text-xs text-black/65 focus:outline-none focus:ring-2 focus:ring-teal-500"
                >
                    {#each policyOptions as option}
                        <option value={option.value}>{option.label}</option>
                    {/each}
                </select>
            </label>
        </div>

        <div class="flex flex-wrap gap-1.5">
            {#each focusOptions as focus}
                {@const active = selectedFocuses.includes(focus.id)}
                <button
                    type="button"
                    aria-pressed={active}
                    onclick={() => toggleFocus(focus.id)}
                    class="rounded-full border px-2 py-1 text-[10px] font-medium transition-colors {active
                        ? 'border-teal-500 bg-teal-50 text-teal-700'
                        : 'border-black/10 bg-white/65 text-black/45 hover:text-black/65'}"
                >
                    {focus.label}
                </button>
            {/each}
        </div>

        <div class="flex items-center justify-between rounded-md bg-white/55 px-2.5 py-2">
            <span class="flex items-center gap-1.5 text-[11px] text-black/50">
                <UsersIcon class="h-3.5 w-3.5" />
                Reader personas
            </span>
            <button
                type="button"
                role="switch"
                aria-checked={personaModes.editor}
                onclick={togglePersonaMode}
                title={personaModes.editor
                    ? "Personas on — each enabled reader responds in parallel"
                    : "Personas off — a single editor response"}
                class="relative inline-flex h-4 w-7 items-center rounded-full transition-colors {personaModes.editor
                    ? 'bg-teal-500'
                    : 'bg-black/15'}"
            >
                <span
                    class="inline-block h-3 w-3 transform rounded-full bg-white transition-transform {personaModes.editor
                        ? 'translate-x-3.5'
                        : 'translate-x-0.5'}"
                ></span>
            </button>
        </div>
    </div>

    <div class="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3">
        {#if !hasConversationActivity}
            <div class="flex h-full items-center justify-center text-center text-sm text-gray-400">
                {$selectedText ? "Ready to review the selection" : "Ready to review the draft"}
            </div>
        {/if}

        {#each chat.messages as message, messageIndex (messageIndex)}
            {#each message.parts as part, partIndex (partIndex)}
                {#if part.type === "text"}
                    {@const renderPromise = renderMarkdown(part.text)}
                    <div class="flex {message.role === 'user' ? 'justify-end' : 'justify-start'}">
                        <div
                            class="relative max-w-[85%] px-3 py-2 text-sm {message.role === 'user'
                                ? 'rounded-md bg-teal-600 text-white'
                                : 'rounded-md bg-gray-100 text-gray-800'}"
                        >
                            <div class="whitespace-pre-wrap break-words">
                                {#await renderPromise then rendered}
                                    {@html rendered}
                                {/await}
                            </div>
                        </div>
                    </div>
                {/if}
            {/each}
        {/each}

        {#if chat.status === "streaming" || chat.status === "submitted" || personaInFlight}
            <div class="flex justify-start">
                <div class="rounded-md bg-gray-100 px-3 py-2 text-sm text-gray-800">
                    <span class="inline-block animate-pulse">●</span>
                    <span class="ml-2">{personaInFlight ? "Personas reviewing..." : "Reviewing..."}</span>
                </div>
            </div>
        {/if}
    </div>

    <div class="border-t border-black/10 bg-white/30 p-3">
        {#if hasConversationActivity}
            <div class="mb-2 flex justify-end">
                <button
                    type="button"
                    onclick={clearConversation}
                    class="rounded px-1.5 py-0.5 text-[10px] text-black/30 transition-colors hover:bg-red-50 hover:text-red-400"
                >
                    New chat
                </button>
            </div>
        {/if}

        <form onsubmit={handleSubmit} class="flex flex-col gap-2">
            <input
                bind:value={input}
                name="editor-request"
                placeholder="Ask for margin notes..."
                disabled={chat.status !== "ready" || personaInFlight}
                class="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:cursor-not-allowed disabled:opacity-50"
                autocomplete="off"
            />
            <button
                type="submit"
                disabled={chat.status !== "ready" || personaInFlight || !input.trim() || !$documentContent.trim()}
                class="w-full rounded-md bg-teal-600 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
                Ask Editor
            </button>
        </form>
    </div>
</div>
