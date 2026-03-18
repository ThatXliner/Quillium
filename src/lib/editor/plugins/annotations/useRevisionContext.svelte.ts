/**
 * useRevisionContext.svelte.ts — Reactive hook that computes the
 * layered context snippets shown in the RevisionModal context panel.
 *
 * Only the data derivation lives here. Scroll/intersection state
 * is managed inside RevisionModalContextPanel.svelte, which owns
 * the DOM refs.
 */

import { annotationField, type Annotation } from ".";
import type { ModalEntry } from "$lib/stores";

export type ContextLayer = {
    before: string;
    revision: string;
    after: string;
    hasMoreBefore: boolean;
    hasMoreAfter: boolean;
};

const CHUNK = 300;

export function useRevisionContext(
    getCrumbs: () => ModalEntry[],
    getModalAnnotations: () => unknown,
) {
    let contextBefore = $state(CHUNK);
    let contextAfter = $state(CHUNK);

    const contextLayers = $derived.by((): ContextLayer[] => {
        void getModalAnnotations(); // re-run when nested editor writes back
        const crumbs = getCrumbs();
        const layers: ContextLayer[] = [];
        for (let ci = 0; ci < crumbs.length; ci++) {
            const crumb = crumbs[ci];
            if (crumb.type !== "revision") continue;
            const parentState = crumb.parentView.state;
            const rev = parentState.field(annotationField)[crumb.revisionId] as
                | Annotation<"revision">
                | undefined;
            if (!rev) continue;
            const doc = parentState.doc;
            const from = rev.selection.main.from;
            const to = rev.selection.main.to;
            const isOuter = ci === 0;
            const beforeStart = isOuter ? Math.max(0, from - contextBefore) : 0;
            const afterEnd = isOuter ? Math.min(doc.length, to + contextAfter) : doc.length;
            layers.push({
                before: doc.sliceString(beforeStart, from),
                revision: doc.sliceString(from, to),
                after: doc.sliceString(to, afterEnd),
                hasMoreBefore: isOuter && beforeStart > 0,
                hasMoreAfter: isOuter && afterEnd < doc.length,
            });
        }
        return layers;
    });

    function loadMoreBefore(prevScrollHeight: number, scrollEl: HTMLDivElement) {
        contextBefore += CHUNK;
        requestAnimationFrame(() => {
            scrollEl.scrollTop += scrollEl.scrollHeight - prevScrollHeight;
        });
    }

    function loadMoreAfter() {
        contextAfter += CHUNK;
    }

    return {
        get contextLayers() { return contextLayers; },
        loadMoreBefore,
        loadMoreAfter,
    };
}
