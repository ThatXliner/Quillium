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
    trashMode: boolean;
    onSelect: (id: string) => void;
    onOpen: (id: string) => void;
    onTrash: (id: string) => void;
    onRestore: (id: string) => void;
    onDeletePermanent: (id: string) => void;
}

const { documents, selectedId, viewMode, trashMode, onSelect, onOpen, onTrash, onRestore, onDeletePermanent }: Props =
    $props();
</script>

{#if viewMode === "grid"}
    <div class="grid grid-cols-2 xl:grid-cols-3 gap-4">
        {#each documents as doc (doc.id)}
            <DocumentCard
                {doc}
                {viewMode}
                {trashMode}
                selected={selectedId === doc.id}
                onSelect={() => onSelect(doc.id)}
                onOpen={() => onOpen(doc.id)}
                onTrash={() => onTrash(doc.id)}
                onRestore={() => onRestore(doc.id)}
                onDeletePermanent={() => onDeletePermanent(doc.id)}
            />
        {/each}
    </div>
{:else}
    <div class="flex flex-col gap-2">
        {#each documents as doc (doc.id)}
            <DocumentCard
                {doc}
                {viewMode}
                {trashMode}
                selected={selectedId === doc.id}
                onSelect={() => onSelect(doc.id)}
                onOpen={() => onOpen(doc.id)}
                onTrash={() => onTrash(doc.id)}
                onRestore={() => onRestore(doc.id)}
                onDeletePermanent={() => onDeletePermanent(doc.id)}
            />
        {/each}
    </div>
{/if}
