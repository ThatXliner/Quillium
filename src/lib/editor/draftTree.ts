/**
 * draftTree.ts — Pure tree helpers for the per-tab draft tree (#160).
 *
 * Drafts within a tab form a tree via parentDraftId. These helpers build
 * the tree from a flat DraftMeta list and flatten it back into DFS order
 * for indented rendering. No Svelte/DOM dependencies.
 */
import type { DraftMeta } from "$lib/db/types";

export type DraftNode = {
    draft: DraftMeta;
    children: DraftNode[];
    depth: number;
};

/**
 * Builds the draft tree for one tab. Drafts whose parent is missing from
 * the list (or null) become roots. Siblings are ordered by creation time.
 */
export function buildDraftTree(drafts: DraftMeta[]): DraftNode[] {
    const byId = new Map<string, DraftNode>();
    for (const draft of drafts) {
        byId.set(draft.id, { draft, children: [], depth: 0 });
    }
    const roots: DraftNode[] = [];
    const sorted = [...drafts].sort((a, b) => a.createdAt - b.createdAt);
    for (const draft of sorted) {
        const node = byId.get(draft.id);
        if (!node) continue;
        const parent = draft.parentDraftId ? byId.get(draft.parentDraftId) : undefined;
        if (parent) {
            parent.children.push(node);
        } else {
            roots.push(node);
        }
    }
    // Depths are assigned after linking so orphaned subtrees stay consistent.
    const assignDepth = (node: DraftNode, depth: number) => {
        node.depth = depth;
        for (const child of node.children) assignDepth(child, depth + 1);
    };
    for (const root of roots) assignDepth(root, 0);
    return roots;
}

/** Flattens the tree into DFS order (parent before children). */
export function flattenDraftTree(roots: DraftNode[]): DraftNode[] {
    const out: DraftNode[] = [];
    const visit = (node: DraftNode) => {
        out.push(node);
        for (const child of node.children) visit(child);
    };
    for (const root of roots) visit(root);
    return out;
}

/** True when the draft can be deleted: a leaf that isn't the tab's last draft. */
export function isDeletableDraft(draftId: string, drafts: DraftMeta[]): boolean {
    if (drafts.length <= 1) return false;
    return !drafts.some((d) => d.parentDraftId === draftId);
}
