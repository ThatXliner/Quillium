<!--
    DraftStack.svelte

    Renders a physical fan of paper sheets behind the active editor card.
    Each sheet is a full-size white card offset left+up from the one above.
    A fixed-width hit strip on the left peeking edge of each sheet is the
    hover/click target — strips don't overlap so you can slide down the fan.
    Hover pulls that sheet out further and shows a content preview popover.
-->
<script lang="ts">
import { GitBranch, FileText } from "lucide-svelte";
import { getDocumentChildren, getDocumentMeta } from "$lib/db";
import type { DocumentMeta } from "$lib/db/types";
import { hasBranching, linearChain, type DraftNode } from "./draftTree";
import GhostCard from "./GhostCard.svelte";

const { currentDocId, onNavigate, onSwipe } = $props<{
    currentDocId: string;
    onNavigate: (docId: string) => void;
    onSwipe: (exitTransform: string, durationMs: number) => void;
}>();

let tree = $state<DraftNode | null>(null);
let loading = $state(true);
let showTree = $state(false);
let hoveredGhostId = $state<string | null>(null);
let swiping = $state(false);

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

function linearTip(node: DraftNode): DraftNode[] {
    if (node.children.length !== 1) return [node];
    return [node, ...linearTip(node.children[0])];
}

function findNode(node: DraftNode, id: string): DraftNode | null {
    if (node.doc.id === id) return node;
    for (const child of node.children) {
        const found = findNode(child, id);
        if (found) return found;
    }
    return null;
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
    swiping = false;
    load();
});

const ancestors = $derived.by(() => {
    if (!tree) return [];
    const chain = linearChain(tree, currentDocId);
    return chain.slice(0, -1).reverse();
});

const descendants = $derived.by(() => {
    if (!tree) return [];
    const node = findNode(tree, currentDocId);
    if (!node || node.children.length === 0) return [];
    return linearTip(node).slice(1);
});

const deck = $derived(
    [...ancestors.slice().reverse(),
     ...(tree ? [findNode(tree, currentDocId)!] : []),
     ...descendants,
    ].filter(Boolean) as DraftNode[]
);
const deckIndex = $derived(deck.findIndex((n) => n.doc.id === currentDocId));

const ghosts = $derived(ancestors.slice(0, 3));
const flatRows = $derived(tree ? flattenTree(tree) : []);
const branched = $derived(tree ? hasBranching(tree) : false);

const SWIPE_MS = 300;

// Per-layer offset: how far each sheet peeks out from the one above
// Layer 1 = closest ancestor (just behind the active card)
const OFFSET_X = 10; // px left per layer (collapsed)
const OFFSET_Y = 8;  // px up per layer
const HOVER_EXTRA_X = 24; // additional px left when hovered

// Hit strip: fixed width column on the left peeking edge of each sheet.
// Must be <= OFFSET_X so strips don't overlap each other.
const HIT_W = 10; // px — exactly the per-layer offset, so strips are adjacent

function navigateWithSwipe(targetId: string) {
    if (swiping) return;
    swiping = true;
    onSwipe("translateX(115%) rotate(5deg)", SWIPE_MS);
    setTimeout(() => onNavigate(targetId), SWIPE_MS);
}
</script>

{#if !loading && (ghosts.length > 0 || descendants.length > 0)}

    <!--
        Sheet stack. Rendered deepest-first (highest index = furthest back),
        so z-index stacking is natural: layer 1 is closest to the surface.
        Each sheet is full-size (inset-0) translated left+up.
        The visual and hit areas are separated so hit strips never overlap.
    -->
    {#each ghosts as ghost, i (ghost.doc.id)}
        {@const layer = i + 1}
        {@const isHovered = hoveredGhostId === ghost.doc.id}
        {@const baseX = -(layer * OFFSET_X)}
        {@const extraX = isHovered ? -HOVER_EXTRA_X : 0}
        {@const tx = baseX + extraX}
        {@const ty = -(layer * OFFSET_Y)}

        <!-- Visual sheet: full-size, sits behind the active card -->
        <div
            aria-hidden="true"
            class="absolute inset-0 bg-white rounded-lg pointer-events-none"
            style="
                transform: translate({tx}px, {ty}px);
                z-index: {isHovered ? 8 : 8 - i};
                box-shadow: -2px -2px 12px rgba(0,0,0,0.07), 0 2px 8px rgba(0,0,0,0.06);
                transition: transform 180ms cubic-bezier(0.25, 1, 0.5, 1);
            "
        ></div>

        <!--
            Hit strip: fixed HIT_W column at the sheet's left peeking edge.
            Position is based on baseX only (not extraX) so it never moves —
            cursor stays inside it during the hover pull animation.
            Strip for layer N starts at baseX and is HIT_W wide, so:
              layer 1: x = -10, w = 10  → covers -10..0
              layer 2: x = -20, w = 10  → covers -20..-10
              layer 3: x = -30, w = 10  → covers -30..-20
            Perfectly adjacent, zero overlap.
        -->
        <button
            onmouseenter={() => (hoveredGhostId = ghost.doc.id)}
            onmouseleave={() => (hoveredGhostId = null)}
            onclick={() => navigateWithSwipe(ghost.doc.id)}
            aria-label="Open draft: {ghost.doc.title}"
            class="absolute pointer-events-auto cursor-pointer"
            style="
                top: {ty}px;
                bottom: 0;
                left: {baseX}px;
                width: {HIT_W}px;
                z-index: {isHovered ? 9 : 9 - i};
                background: transparent;
                border: none;
                outline: none;
            "
        ></button>

        <!-- Preview popover: appears to the left of the pulled sheet -->
        {#if isHovered}
            <div
                class="absolute pointer-events-none overflow-hidden rounded-xl bg-white
                       border border-black/[0.07]"
                style="
                    top: {ty}px;
                    right: calc(100% + {-tx + 12}px);
                    width: 240px;
                    height: 320px;
                    z-index: 50;
                    box-shadow: -4px 4px 28px rgba(0,0,0,0.14);
                    animation: popover-in 150ms cubic-bezier(0.34, 1.4, 0.64, 1) both;
                "
            >
                <GhostCard docId={ghost.doc.id} />
                <div class="absolute bottom-0 inset-x-0 h-10 pointer-events-none"
                     style="background: linear-gradient(to bottom, transparent, rgba(255,255,255,0.95));"></div>
                <span class="absolute bottom-2 left-3 text-[10px] font-medium text-black/35 select-none">
                    {ghost.doc.title}
                </span>
            </div>
        {/if}
    {/each}

    <!-- Badge -->
    <div class="absolute -top-7 left-0 pointer-events-auto z-20">
        {#if branched}
            <button
                onclick={() => (showTree = !showTree)}
                class="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium
                       bg-white/70 backdrop-blur-sm border border-black/[0.08] shadow-sm
                       text-black/50 hover:text-black/80 transition-colors"
            >
                <GitBranch size={11} />
                Draft {ancestors.length + 1}
            </button>
        {:else}
            <span class="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium
                         bg-white/70 backdrop-blur-sm border border-black/[0.08] shadow-sm text-black/40">
                <FileText size={11} />
                Draft {ancestors.length + 1}
                {#if deck.length > 1}
                    <span class="text-black/25">· {deckIndex + 1}/{deck.length}</span>
                {/if}
            </span>
        {/if}

        {#if showTree && branched}
            <div class="absolute top-full mt-1 left-0
                        bg-white border border-black/[0.08] rounded-xl shadow-xl p-2 w-52 z-30">
                {#each flatRows as row (row.doc.id)}
                    {@const isCurrent = row.doc.id === currentDocId}
                    <div style="padding-left: {row.depth * 12}px;">
                        <button
                            onclick={() => { if (!isCurrent) { onNavigate(row.doc.id); showTree = false; } }}
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

{/if}

<style>
    @keyframes popover-in {
        from { opacity: 0; transform: translateX(8px) scale(0.97); }
        to   { opacity: 1; transform: translateX(0) scale(1); }
    }
</style>
