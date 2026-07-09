<!-- DocumentContext.svelte — Compact writer-owned brief for editorial decisions. -->
<script lang="ts">
import {
    DEFAULT_DOCUMENT_CONTEXT,
    type DocumentKind,
    documentContext,
    saveDocumentContext,
} from "$lib/ai/settings.svelte";
import posthog from "$lib/posthog";
import { RotateCcwIcon } from "lucide-svelte";

const documentKinds: Array<{ value: DocumentKind; label: string }> = [
    { value: "general", label: "General writing" },
    { value: "college_application", label: "College application" },
    { value: "academic", label: "Academic or graded" },
    { value: "professional", label: "Professional" },
    { value: "personal", label: "Personal writing" },
    { value: "fiction", label: "Fiction" },
];

function updateDocumentType(event: Event): void {
    documentContext.documentType = (event.currentTarget as HTMLSelectElement).value as DocumentKind;
    saveDocumentContext();
    posthog.capture("document_context_changed", {
        field: "document_type",
        value: documentContext.documentType,
    });
}

function save(): void {
    saveDocumentContext();
}

function clearAll(): void {
    Object.assign(documentContext, DEFAULT_DOCUMENT_CONTEXT);
    saveDocumentContext();
    posthog.capture("context_cleared");
}
</script>

<div class="flex h-full flex-col overflow-y-auto p-4">
    <div class="flex items-start justify-between gap-3 border-b border-black/8 pb-3">
        <div>
            <p class="text-xs font-semibold text-black/62">Writing brief</p>
            <p class="mt-0.5 text-[10px] text-black/34">Used when Quillium decides what matters.</p>
        </div>
        <button
            type="button"
            onclick={clearAll}
            class="flex items-center gap-1 rounded px-1.5 py-1 text-[10px] text-black/30 hover:bg-white/50 hover:text-black/55"
        >
            <RotateCcwIcon size={11} />
            Reset
        </button>
    </div>

    <div class="mt-4 space-y-4">
        <label class="field">
            <span>What are you writing?</span>
            <select value={documentContext.documentType} onchange={updateDocumentType}>
                {#each documentKinds as kind}
                    <option value={kind.value}>{kind.label}</option>
                {/each}
            </select>
        </label>

        <label class="field">
            <span>Who will read it?</span>
            <input
                bind:value={documentContext.audience}
                onblur={save}
                placeholder="A hiring manager, classmates, newsletter readers..."
            />
        </label>

        <label class="field">
            <span>What should happen for the reader?</span>
            <textarea
                bind:value={documentContext.purpose}
                onblur={save}
                rows={3}
                placeholder="Understand the argument, feel the tension, trust the proposal..."
            ></textarea>
        </label>

        <label class="field">
            <span>Requirements</span>
            <textarea
                bind:value={documentContext.constraints}
                onblur={save}
                rows={3}
                placeholder="Prompt, word limit, rubric, house style, claims that need support..."
            ></textarea>
        </label>

        <label class="field">
            <span>Keep intact</span>
            <input
                bind:value={documentContext.preserve}
                onblur={save}
                placeholder="Direct tone, technical terms, fragmented rhythm..."
            />
        </label>

        <details class="border-t border-black/8 pt-3">
            <summary class="cursor-pointer text-[10px] font-medium text-black/38">Other notes</summary>
            <textarea
                bind:value={documentContext.freeform}
                onblur={save}
                rows={4}
                placeholder="Anything else Quillium should know"
                class="mt-2"
            ></textarea>
        </details>
    </div>
</div>

<style>
    .field {
        display: flex;
        flex-direction: column;
        gap: 6px;
        color: rgb(0 0 0 / 42%);
        font-size: 10px;
        font-weight: 600;
    }

    input,
    textarea,
    select {
        width: 100%;
        border: 1px solid rgb(0 0 0 / 11%);
        border-radius: 5px;
        background: rgb(255 255 255 / 62%);
        padding: 8px 9px;
        color: rgb(0 0 0 / 68%);
        font-size: 12px;
        font-weight: 400;
        line-height: 1.45;
        outline: none;
    }

    input:focus,
    textarea:focus,
    select:focus {
        border-color: #2f8f78;
    }

    textarea {
        resize: vertical;
    }
</style>
