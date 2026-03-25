<!--
    DraftStack.svelte — Physical pile-of-papers stack behind the editor card.

    Ghost cards peek out to the left (ancestors). Below the card, a nav bar
    lets you flip through the linear chain (flip view) or see the full tree
    (tree view). The toggle between flip/tree only appears on linear chains;
    branched trees always show tree view.
-->
<script lang="ts">
import { GitBranch, FileText, ChevronLeft, ChevronRight, Network } from "lucide-svelte";
import { getDocumentChildren, getDocumentMeta } from "$lib/db";
import type { DocumentMeta } from "$lib/db/types";
import { hasBranching, linearChain, type DraftNode } from "./draftTree";

const { currentDocId, onNavigate } = $props<{
    currentDocId: string;
    onNavigate: (docId: string) => void;
}>();

let tree = $state<DraftNode | null>(null);
let loading = $state(true);
let showNav = $state(false);   // whether the bottom nav panel is open
let flipView = $state(true);   // flip vs tree (only relevant when !branched)
let hoveredGhostId = $state<string | null>(null);

async function findRoot(docId: string): Promise<DocumentMeta> {
    const doc = await getDocumentMeta(docId);
    if (!doc) throw new Error(`Document ${docId} not found`);
    if (!doc.parentDocumentId) return doc;
    return findRoot(doc.parentDocumentId);
}

async function buildTree(doc: DocumentMeta, depth: number): Promise<DraftNode> {
    const children = await getDocumentChildren(doc.id);
    const childNodes = await Promise.all(children.map((c) => buildTree(c, depth + 1)));
    return { doc, children: childNodes, depth };
}

function flattenTree(node: DraftNode): DraftNode[] {
    return [node, ...node.children.flatMap(flattenTree)];
}

/** Returns the linear chain from root to the deepest single-child descendant. */
function linearTip(node: DraftNode): DraftNode[] {
    if (node.children.length !== 1) return [node];
    return [node, ...linearTip(node.children[0])];
}

async function load() {
    loading = true;
    try {
        const root = await findRoot(currentDocId);
        tree = await buildTree(root, 0);
    } catch (e) {
        console.error("[DraftStack] load failed:", e);
    } finally {
        loading = false;
    }
}

$effect(() => {
    void currentDocId;
    load();
});

// Ancestors: path from immediate parent up to root, closest first.
const ancestors = $derived.by(() => {
    if (!tree) return [];
    const chain = linearChain(tree, currentDocId);
    return chain.slice(0, -1).reverse();
});

// Descendants: path from current doc down to the deepest single-child tip.
const descendants = $derived.by(() => {
    if (!tree) return [];
    const currentNode = findNode(tree, currentDocId);
    if (!currentNode || currentNode.children.length === 0) return [];
    // Only follow the linear tip — stop at any branch point.
    return linearTip(currentNode).slice(1);
});

function findNode(node: DraftNode, id: string): DraftNode | null {
    if (node.doc.id === id) return node;
    for (const child of node.children) {
        const found = findNode(child, id);
        if (found) return found;
    }
    return null;
}

// Full linear chain for flip view: ancestors (oldest→nearest) + current + descendants
const flipChain = $derived([...ancestors.slice().reverse(), ...(tree ? [findNode(tree, currentDocId)!] : []), ...descendants].filter(Boolean) as DraftNode[]);
const currentIndexInChain = $derived(flipChain.findIndex((n) => n.doc.id === currentDocId));

const ghosts = $derived(ancestors.slice(0, 3));
const flatRows = $derived(tree ? flattenTree(tree) : []);
const branched = $derived(tree ? hasBranching(tree) : false);

// If branched, always tree view.
const showFlipToggle = $derived(!branched && flipChain.length > 1);
const effectiveFlipView = $derived(!branched && flipView);

const PEEK = 10;
const PEEK_HOVER = 28;
const STACK_DOWN = 5;
</script>

{#if !loading && (ghosts.length > 0 || descendants.length > 0)}
    <!-- Ghost cards: ancestors peeking left, each lifts individually on hover -->
    {#if ghosts.length > 0}
        <div class="absolute inset-0 pointer-events-none">
            {#each ghosts as ghost, i (ghost.doc.id)}
                {@const layer = i + 1}
                {@const isHovered = hoveredGhostId === ghost.doc.id}
                {@const peek = isHovered ? PEEK_HOVER : layer * PEEK}
                {@const down = layer * STACK_DOWN}
                <button
                    onmouseenter={() => (hoveredGhostId = ghost.doc.id)}
                    onmouseleave={() => (hoveredGhostId = null)}
                    onclick={() => onNavigate(ghost.doc.id)}
                    title={ghost.doc.title}
                    aria-label="Open draft: {ghost.doc.title}"
                    class="absolute inset-0 bg-white rounded-lg cursor-pointer pointer-events-auto overflow-hidden"
                    style="
                        transform: translate(-{peek}px, {down}px);
                        z-index: {isHovered ? 15 : 9 - i};
                        box-shadow: 0 1px 3px rgba(0,0,0,0.10), 0 4px 16px rgba(0,0,0,0.08);
                        transition: transform 220ms cubic-bezier(0.34, 1.3, 0.64, 1),
                                    box-shadow 220ms ease,
                                    z-index 0ms;
                    "
                >
                    <span
                        class="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] font-medium
                               select-none pointer-events-none transition-opacity duration-150 whitespace-nowrap"
                        style="opacity: {isHovered ? 0.55 : 0}; color: rgba(0,0,0,0.45);"
                    >
                        {ghost.doc.title}
                    </span>
                </button>
            {/each}
        </div>
    {/if}

    <!-- Badge + nav toggle: top-left of the editor -->
    <div class="absolute -top-7 left-0 pointer-events-auto z-20 flex items-center gap-1.5">
        <button
            onclick={() => (showNav = !showNav)}
            class="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium
                   bg-white/70 backdrop-blur-sm border border-black/[0.08] shadow-sm
                   text-black/50 hover:text-black/80 transition-colors"
        >
            {#if branched}<GitBranch size={11} />{:else}<FileText size={11} />{/if}
            Draft {ancestors.length + 1}
        </button>
    </div>

    <!-- Bottom nav panel -->
    {#if showNav}
        <div class="absolute top-full mt-2 left-0 right-0 z-30 pointer-events-auto">
            <div class="bg-white border border-black/[0.08] rounded-xl shadow-xl overflow-hidden">

                <!-- Toggle bar (only for linear chains) -->
                {#if showFlipToggle}
                    <div class="flex border-b border-black/[0.06]">
                        <button
                            onclick={() => (flipView = true)}
                            class="flex-1 flex items-center justify-center gap-1.5 py-2 text-[11px] font-medium transition-colors
                                   {effectiveFlipView
                                       ? 'text-black/70 bg-black/[0.03]'
                                       : 'text-black/35 hover:text-black/55'}"
                        >
                            <ChevronLeft size={12} /><ChevronRight size={12} />
                            Flip through
                        </button>
                        <div class="w-px bg-black/[0.06]"></div>
                        <button
                            onclick={() => (flipView = false)}
                            class="flex-1 flex items-center justify-center gap-1.5 py-2 text-[11px] font-medium transition-colors
                                   {!effectiveFlipView
                                       ? 'text-black/70 bg-black/[0.03]'
                                       : 'text-black/35 hover:text-black/55'}"
                        >
                            <Network size={12} />
                            Tree
                        </button>
                    </div>
                {/if}

                <!-- Flip view: prev/next + position strip -->
                {#if effectiveFlipView}
                    <div class="flex items-center gap-1 px-2 py-2">
                        <!-- Prev -->
                        <button
                            onclick={() => {
                                if (currentIndexInChain > 0) onNavigate(flipChain[currentIndexInChain - 1].doc.id);
                            }}
                            disabled={currentIndexInChain <= 0}
                            class="p-1 rounded-lg text-black/40 hover:text-black/70 hover:bg-black/[0.04]
                                   transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
                            aria-label="Previous draft"
                        >
                            <ChevronLeft size={14} />
                        </button>

                        <!-- Chain pills -->
                        <div class="flex-1 flex items-center gap-1 overflow-x-auto scrollbar-none px-1">
                            {#each flipChain as node, i (node.doc.id)}
                                {@const isCurrent = node.doc.id === currentDocId}
                                <button
                                    onclick={() => { if (!isCurrent) onNavigate(node.doc.id); }}
                                    title={node.doc.title}
                                    class="shrink-0 flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium
                                           transition-colors whitespace-nowrap
                                           {isCurrent
                                               ? 'bg-blue-50 text-blue-700 cursor-default'
                                               : 'text-black/45 hover:bg-black/[0.04] hover:text-black/70 cursor-pointer'}"
                                >
                                    <span class="text-[9px] opacity-50">{i + 1}</span>
                                    <span class="max-w-[100px] truncate">{node.doc.title}</span>
                                </button>
                                {#if i < flipChain.length - 1}
                                    <ChevronRight size={10} class="shrink-0 text-black/20" />
                                {/if}
                            {/each}
                        </div>

                        <!-- Next -->
                        <button
                            onclick={() => {
                                if (currentIndexInChain < flipChain.length - 1) onNavigate(flipChain[currentIndexInChain + 1].doc.id);
                            }}
                            disabled={currentIndexInChain >= flipChain.length - 1}
                            class="p-1 rounded-lg text-black/40 hover:text-black/70 hover:bg-black/[0.04]
                                   transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
                            aria-label="Next draft"
                        >
                            <ChevronRight size={14} />
                        </button>
                    </div>

                <!-- Tree view -->
                {:else}
                    <div class="p-2">
                        {#each flatRows as row (row.doc.id)}
                            {@const isCurrent = row.doc.id === currentDocId}
                            <div style="padding-left: {row.depth * 12}px;">
                                <button
                                    onclick={() => {
                                        if (!isCurrent) { onNavigate(row.doc.id); showNav = false; }
                                    }}
                                    class="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-lg
                                           text-[12px] transition-colors
                                           {isCurrent
                                               ? 'bg-blue-50 text-blue-700 font-medium cursor-default'
                                               : 'text-black/60 hover:bg-black/[0.04] hover:text-black/80 cursor-pointer'}"
                                >
                                    <FileText size={11} class="shrink-0" />
                                    <span class="truncate flex-1">{row.doc.title}</span>
                                    {#if isCurrent}<span class="text-[10px] text-blue-400 shrink-0">now</span>{/if}
                                </button>
                            </div>
                        {/each}
                    </div>
                {/if}

            </div>
        </div>
    {/if}
{/if}
