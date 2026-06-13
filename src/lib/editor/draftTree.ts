/**
 * draftTree.ts — Pure layout helpers for the per-tab draft panel (#160).
 *
 * Two relations shape the panel:
 *   - parentDraftId — the previous *iteration*. An iteration chain ("run")
 *     renders FLAT: same indent, ordered oldest→newest. This is the common
 *     case, so it stays a readable list no matter how long.
 *   - branchedFrom — a *branch* (a different take). Renders INDENTED one
 *     level under its source, and begins its own iteration run.
 *
 * So depth counts branch hops only; iterating never deepens the tree.
 * No Svelte/DOM dependencies.
 */
import type { DraftMeta } from "$lib/db/types";

export type DraftRow = {
    draft: DraftMeta;
    /** Indent level = number of branch hops from the tab's root run. */
    depth: number;
    /** True when this draft is the editable tip of its run (newest live). */
    isRunTip: boolean;
};

/**
 * Lays out a tab's drafts as panel rows: iteration runs flat, branches
 * indented. Returns rows in display order (a run in iteration order, each
 * draft immediately followed by the branches taken off it).
 */
export function layoutDraftRows(drafts: DraftMeta[]): DraftRow[] {
    const byId = new Map(drafts.map((d) => [d.id, d]));
    const sorted = [...drafts].sort((a, b) => a.createdAt - b.createdAt);

    // Iterations of a given draft (its run successors), oldest first.
    const iterationsOf = new Map<string | null, DraftMeta[]>();
    // Branches taken off a given draft, oldest first.
    const branchesOf = new Map<string, DraftMeta[]>();
    for (const d of sorted) {
        if (d.branchedFrom && byId.has(d.branchedFrom)) {
            const list = branchesOf.get(d.branchedFrom) ?? [];
            list.push(d);
            branchesOf.set(d.branchedFrom, list);
        } else {
            // Iteration link (or a run head: parentDraftId null / missing).
            const key = d.parentDraftId && byId.has(d.parentDraftId) ? d.parentDraftId : null;
            const list = iterationsOf.get(key) ?? [];
            list.push(d);
            iterationsOf.set(key, list);
        }
    }

    // The tip of a run = its newest live member; everything else is superseded.
    const runTip = (head: DraftMeta): string => {
        let cur = head;
        for (;;) {
            const next = iterationsOf.get(cur.id);
            if (!next || next.length === 0) return cur.id;
            // A well-formed run is linear; if it forked, follow the newest.
            cur = next[next.length - 1];
        }
    };

    const rows: DraftRow[] = [];
    // Walk a run starting at `head`, emitting each draft flat at `depth`, and
    // recursing into any branches taken off each draft (indented +1).
    const walkRun = (head: DraftMeta, depth: number) => {
        const tip = runTip(head);
        let cur: DraftMeta | undefined = head;
        while (cur) {
            rows.push({ draft: cur, depth, isRunTip: cur.id === tip });
            for (const branch of branchesOf.get(cur.id) ?? []) {
                walkRun(branch, depth + 1);
            }
            const next = iterationsOf.get(cur.id);
            cur = next && next.length > 0 ? next[next.length - 1] : undefined;
        }
    };

    for (const head of iterationsOf.get(null) ?? []) {
        walkRun(head, 0);
    }
    return rows;
}

/** True when the draft is a run head (main, or the root of a branch). */
export function isRunHead(draft: DraftMeta): boolean {
    return draft.parentDraftId == null;
}

/**
 * True when the draft can be deleted: a leaf (no live iteration after it and
 * nothing branched off it) that isn't the tab's only draft.
 */
export function isDeletableDraft(draftId: string, drafts: DraftMeta[]): boolean {
    if (drafts.length <= 1) return false;
    const hasDescendant = drafts.some(
        (d) => d.parentDraftId === draftId || d.branchedFrom === draftId,
    );
    return !hasDescendant;
}
