<!--
    DraftStack.svelte — The "pile of papers" draft navigation overlay.

    Shown when the current document has ancestors or siblings in the draft tree.

    The stack renders as layered paper edges peeking out from behind the main
    editor card. Clicking an edge navigates to that draft document.

    When branching has occurred, a full tree view is shown instead of the
    linear stack. The tree is flattened into a depth-annotated list for
    rendering (Svelte 5 snippets cannot recurse).

    Props:
      - currentDocId: the document currently open in the editor
      - onNavigate(docId): called when the user selects a different draft
-->
<script lang="ts">
import { onMount } from "svelte";
import { GitBranch, FileText } from "lucide-svelte";
import { getDocumentChildren, getDocumentMeta } from "$lib/db";
import type { DocumentMeta } from "$lib/db/types";
import { hasBranching, linearChain, type DraftNode } from "./draftTree";

const { currentDocId, onNavigate } = $props<{
    currentDocId: string;
    onNavigate: (docId: string) => void;
}>();

let tree = $state<DraftNode | null>(null);
let loading = $state(true);
let showTree = $state(false);

// Walk up to find the root ancestor of the current document.
async function findRoot(docId: string): Promise<DocumentMeta> {
    const doc = await getDocumentMeta(docId);
    if (!doc) throw new Error(`Document ${docId} not found`);
    if (!doc.parentDocumentId) return doc;
    return findRoot(doc.parentDocumentId);
}

// Recursively build the tree from a root document.
async function buildTree(doc: DocumentMeta, depth: number): Promise<DraftNode> {
    const children = await getDocumentChildren(doc.id);
    const childNodes = await Promise.all(children.map((c) => buildTree(c, depth + 1)));
    return { doc, children: childNodes, depth };
}

// Flatten a DraftNode tree into a depth-annotated list (pre-order traversal).
function flattenTree(node: DraftNode): DraftNode[] {
    return [node, ...node.children.flatMap(flattenTree)];
}

async function load() {
    loading = true;
    try {
        const root = await findRoot(currentDocId);
        tree = await buildTree(root, 0);
        showTree = hasBranching(tree);
    } catch (e) {
        console.error("[DraftStack] load failed:", e);
    } finally {
        loading = false;
    }
}

onMount(() => {
    load();
});

const chain = $derived(tree ? linearChain(tree, currentDocId) : []);

const stackEdges = $derived.by(() => {
    if (!tree || chain.length === 0) return [];
    return chain.slice(0, -1).slice(-3).reverse();
});

const flatRows = $derived(tree ? flattenTree(tree) : []);
</script>

{#if !loading && tree && chain.length > 1}
    <div class="draft-stack-controls flex items-center gap-1.5 mb-1">
        <span class="text-[11px] text-black/40 font-medium">
            Draft {chain.length}
        </span>
        {#if hasBranching(tree)}
            <button
                onclick={() => (showTree = !showTree)}
                title={showTree ? "Show stack" : "Show branch tree"}
                class="flex items-center gap-1 text-[11px] text-black/40 hover:text-black/70 transition-colors px-1.5 py-0.5 rounded hover:bg-black/5"
            >
                <GitBranch size={11} />
                {showTree ? "Stack" : "Tree"}
            </button>
        {/if}
    </div>

    {#if showTree}
        <!-- Tree view: flattened pre-order list with depth-based indentation -->
        <div class="draft-tree bg-white/80 backdrop-blur-sm border border-black/[0.08] rounded-xl shadow-lg p-2 w-56">
            {#each flatRows as row (row.doc.id)}
                {@const isCurrent = row.doc.id === currentDocId}
                <div style="padding-left: {row.depth * 12}px;">
                    <button
                        onclick={() => !isCurrent && onNavigate(row.doc.id)}
                        class="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-lg text-[12px] transition-colors
                               {isCurrent
                                   ? 'bg-blue-50 text-blue-700 font-medium cursor-default'
                                   : 'text-black/60 hover:bg-black/[0.04] hover:text-black/80 cursor-pointer'}"
                    >
                        <FileText size={12} class="shrink-0" />
                        <span class="truncate flex-1">{row.doc.title}</span>
                        {#if isCurrent}
                            <span class="text-[10px] text-blue-400 shrink-0">current</span>
                        {/if}
                    </button>
                </div>
            {/each}
        </div>
    {:else}
        <!-- Stack view: layered paper edges peeking behind the card -->
        <div class="draft-stack-edges relative" aria-label="Draft stack">
            {#each stackEdges as edge, i (edge.doc.id)}
                {@const offset = (stackEdges.length - i) * 4}
                <button
                    onclick={() => onNavigate(edge.doc.id)}
                    title="Go to: {edge.doc.title}"
                    aria-label="Open draft: {edge.doc.title}"
                    class="absolute left-0 right-0 bg-white/60 border border-black/[0.08] rounded-lg
                           cursor-pointer hover:bg-white/90 transition-colors
                           flex items-center gap-2 px-3 py-1.5 text-[11px] text-black/50 hover:text-black/80"
                    style="bottom: {offset}px; z-index: {i};"
                >
                    <FileText size={11} />
                    <span class="truncate max-w-[120px]">{edge.doc.title}</span>
                </button>
            {/each}
        </div>
    {/if}
{/if}
