<!--
    DocumentGrid.svelte — Grid/list view switcher for document cards.
-->
<script lang="ts">
import type { DocumentMeta, SearchHit } from "$lib/db/types";
import DocumentCard from "./DocumentCard.svelte";

interface Props {
    documents: DocumentMeta[];
    selectedIds: Set<string>;
    viewMode: "grid" | "list";
    trashMode: boolean;
    /** Active content-search hits keyed by document id (snippets/highlights). */
    hits?: Map<string, SearchHit>;
    onSelect: (id: string, e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => void;
    onOpen: (id: string) => void;
    onTrash: (id: string) => void;
    onRestore: (id: string) => void;
    onDeletePermanent: (id: string) => void;
    onOpenInNewWindow: (id: string) => void;
    onTagClick?: (tag: string) => void;
}

const {
    documents,
    selectedIds,
    viewMode,
    trashMode,
    hits,
    onSelect,
    onOpen,
    onTrash,
    onRestore,
    onDeletePermanent,
    onOpenInNewWindow,
    onTagClick,
}: Props = $props();
</script>

{#if viewMode === "grid"}
    <div class="grid grid-cols-2 xl:grid-cols-3 gap-4">
        {#each documents as doc (doc.id)}
            <DocumentCard
                {doc}
                {viewMode}
                {trashMode}
                hit={hits?.get(doc.id) ?? null}
                selected={selectedIds.has(doc.id)}
                onSelect={(e) => onSelect(doc.id, e)}
                onOpen={() => onOpen(doc.id)}
                onTrash={() => onTrash(doc.id)}
                onRestore={() => onRestore(doc.id)}
                onDeletePermanent={() => onDeletePermanent(doc.id)}
                onOpenInNewWindow={() => onOpenInNewWindow(doc.id)}
                {onTagClick}
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
                hit={hits?.get(doc.id) ?? null}
                selected={selectedIds.has(doc.id)}
                onSelect={(e) => onSelect(doc.id, e)}
                onOpen={() => onOpen(doc.id)}
                onTrash={() => onTrash(doc.id)}
                onRestore={() => onRestore(doc.id)}
                onDeletePermanent={() => onDeletePermanent(doc.id)}
                onOpenInNewWindow={() => onOpenInNewWindow(doc.id)}
                {onTagClick}
            />
        {/each}
    </div>
{/if}
