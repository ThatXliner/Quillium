<!--
    PreviewPanel.svelte — Right half of the library page. Full-height,
    shows document title, stats, preview text, and "Open" CTA.
-->
<script lang="ts">
import type { DocumentMeta } from "$lib/db/types";
import { FileText, ExternalLink } from "lucide-svelte";

interface Props {
    doc: DocumentMeta | null;
    onOpen: () => void;
}

const { doc, onOpen }: Props = $props();

function formatDate(ms: number): string {
    return new Date(ms).toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
    });
}
</script>

<div class="h-full flex flex-col bg-white/50 border-l border-black/8">
    {#if doc}
        <div class="flex-shrink-0 px-8 pt-8 pb-5 border-b border-black/5">
            <h2 class="text-xl font-semibold text-black/80 leading-snug break-words">{doc.title}</h2>
            <p class="text-xs text-black/40 mt-1.5">Last edited {formatDate(doc.updatedAt)}</p>
        </div>

        <div class="flex-1 overflow-y-auto px-8 py-6">
            <!-- Stats row -->
            <div class="flex gap-4 mb-6">
                <div class="flex-1 rounded-xl bg-gray-50 border border-gray-100 p-4 text-center">
                    <p class="text-2xl font-semibold text-black/70">{doc.wordCount.toLocaleString()}</p>
                    <p class="text-xs text-black/40 mt-1">words</p>
                </div>
                <div class="flex-1 rounded-xl bg-gray-50 border border-gray-100 p-4 text-center">
                    <p class="text-2xl font-semibold text-black/70">
                        {new Date(doc.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </p>
                    <p class="text-xs text-black/40 mt-1">created</p>
                </div>
            </div>

            <!-- Preview text -->
            <div class="rounded-xl bg-gray-50 border border-gray-100 p-5">
                <p class="text-sm text-black/60 leading-relaxed whitespace-pre-wrap">
                    {doc.previewText || "No preview available."}
                </p>
            </div>
        </div>

        <div class="flex-shrink-0 px-8 pb-8 pt-4 border-t border-black/5">
            <button
                onclick={onOpen}
                class="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-full bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium shadow-sm transition-colors"
            >
                <ExternalLink size={16} />
                Open document
            </button>
        </div>
    {:else}
        <div class="flex-1 flex flex-col items-center justify-center gap-3 p-8 text-center">
            <div class="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center">
                <FileText size={22} class="text-black/30" />
            </div>
            <p class="text-sm text-black/40">Select a document to preview it here.</p>
        </div>
    {/if}
</div>
