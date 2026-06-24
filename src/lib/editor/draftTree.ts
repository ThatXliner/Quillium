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
    /**
     * Gutter columns (each < depth) whose ancestor run-spine passes vertically
     * THROUGH this row — i.e. an enclosing run that still has rows below this
     * point. Lets a run's spine continue past a nested branch block (the `v2`
     * spine reaching down past the whole `v8` branch to `v5`).
     */
    spines: number[];
    /**
     * This row's own connector into its parent's column, set only when the row
     * is a branch root: "tee" when more branches follow off the same parent,
     * "corner" when it's the last. null for iterations and run heads.
     */
    branchConnector: "tee" | "corner" | null;
    /**
     * True when this row continues its OWN run downward — it has a live
     * iteration right below it in the same column. Draws the spine segment
     * under the dot.
     */
    continuesRun: boolean;
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

    const nextInRun = (d: DraftMeta): DraftMeta | undefined => {
        const next = iterationsOf.get(d.id);
        return next && next.length > 0 ? next[next.length - 1] : undefined;
    };

    const rows: DraftRow[] = [];
    // ancestorOpen[c] is true while an enclosing run at column c still has rows
    // below the current point — so its spine must keep drawing through the
    // gutter. Indexed by column; entries for columns >= the current depth are
    // managed by deeper recursion and read back out as each row's `spines`.
    const ancestorOpen: boolean[] = [];
    // Walk a run starting at `head`, emitting each draft flat at `depth`, and
    // recursing into any branches taken off each draft (indented +1). A branch
    // row's gutter shows the ancestor spines that are still open plus its own
    // tee/corner elbow into the parent column.
    const walkRun = (head: DraftMeta, depth: number) => {
        const tip = runTip(head);
        let cur: DraftMeta | undefined = head;
        while (cur) {
            const branches = branchesOf.get(cur.id) ?? [];
            const succ = nextInRun(cur);
            // This run keeps going below `cur` if it has a later iteration; that
            // is what an enclosing branch column must reflect while we recurse.
            const runContinuesBelow = succ !== undefined;
            // The branch root is the indented run head: it elbows INTO the
            // parent column (depth - 1) rather than letting a spine pass
            // through it, so that column is excluded from `spines` here and
            // drawn by the connector instead.
            const isBranchRoot = cur === head && depth > 0;

            rows.push({
                draft: cur,
                depth,
                isRunTip: cur.id === tip,
                spines: ancestorOpen
                    .slice(0, depth)
                    .flatMap((open, c) => (open && !(isBranchRoot && c === depth - 1) ? [c] : [])),
                // Set on the run head only — that's the row that elbows into the
                // parent column. Tee/corner is decided by the parent's caller.
                branchConnector: null,
                continuesRun: runContinuesBelow,
            });

            // Recurse into branches off `cur`. Our own run-spine (column
            // `depth`) passes through every branch row iff this run continues
            // below `cur`. A branch elbow is a CORNER (parent column stops)
            // only when nothing remains below it in that column — it's the last
            // branch AND the parent run doesn't continue past `cur`; otherwise
            // it's a TEE (parent column keeps going down).
            branches.forEach((branch, i) => {
                const isLastBranch = i === branches.length - 1;
                // The parent column keeps drawing through this branch's rows if
                // a later branch still follows OR the parent run continues below
                // `cur`.
                ancestorOpen[depth] = !isLastBranch || runContinuesBelow;
                const before = rows.length;
                walkRun(branch, depth + 1);
                rows[before].branchConnector =
                    isLastBranch && !runContinuesBelow ? "corner" : "tee";
            });
            ancestorOpen[depth] = false;

            cur = succ;
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
