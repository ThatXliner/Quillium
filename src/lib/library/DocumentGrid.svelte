<!--
    DocumentGrid.svelte — Grid/list view switcher for document cards.
-->
<script lang="ts">
import type { DocumentMeta } from "$lib/db/types";
import DocumentCard from "./DocumentCard.svelte";

interface Props {
    documents: DocumentMeta[];
    selectedId: string | null;
    viewMode: "grid" | "list";
    onSelect: (id: string) => void;
    onOpen: (id: string) => void;
}

const { documents, selectedId, viewMode, onSelect, onOpen }: Props = $props();
</script>

{#if viewMode === "grid"}
    <div class="grid grid-cols-2 xl:grid-cols-3 gap-4">
        {#each documents as doc (doc.id)}
            <DocumentCard
                {doc}
                {viewMode}
                selected={selectedId === doc.id}
                onSelect={() => onSelect(doc.id)}
                onOpen={() => onOpen(doc.id)}
            />
        {/each}
    </div>
{:else}
    <div class="flex flex-col gap-2">
        {#each documents as doc (doc.id)}
            <DocumentCard
                {doc}
                {viewMode}
                selected={selectedId === doc.id}
                onSelect={() => onSelect(doc.id)}
                onOpen={() => onOpen(doc.id)}
            />
        {/each}
    </div>
{/if}
