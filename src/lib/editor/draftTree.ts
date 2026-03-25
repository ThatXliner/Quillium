/**
 * draftTree.ts — Pure utility functions for building and traversing the
 * draft document tree used by DraftStack.svelte.
 *
 * These are extracted from DraftStack so they can be unit-tested without
 * a DOM or Tauri environment.
 */
import type { DocumentMeta } from "$lib/db/types";

export type DraftNode = {
    doc: DocumentMeta;
    children: DraftNode[];
    depth: number;
};

/**
 * Returns true if any node in the subtree rooted at `node` has more than
 * one child (i.e. branching has occurred).
 */
export function hasBranching(node: DraftNode): boolean {
    if (node.children.length > 1) return true;
    return node.children.some(hasBranching);
}

/**
 * Returns the path from `node` down to the node whose doc.id === targetId,
 * root first. Returns [] if targetId is not found in the subtree.
 */
export function linearChain(node: DraftNode, targetId: string): DraftNode[] {
    if (node.doc.id === targetId) return [node];
    for (const child of node.children) {
        const path = linearChain(child, targetId);
        if (path.length > 0) return [node, ...path];
    }
    return [];
}

/**
 * Returns the total number of nodes in the tree rooted at `node`.
 */
export function treeSize(node: DraftNode): number {
    return 1 + node.children.reduce((sum, c) => sum + treeSize(c), 0);
}
