/**
 * restore.ts — Healing document restore for the backup/recovery feature.
 *
 * Replaces the editor document with backup plain text while attempting to
 * re-place existing annotations by searching for their anchor text in the
 * restored document. This is the implementation behind the "Restore previous"
 * button in ErrorBanner.svelte.
 *
 * Strategy per annotation type:
 *   - Revision:          anchor = active version text (already stored in versions[].doc)
 *   - Comment/suggestion: anchor = current doc slice at annotation's selection
 *
 * After the doc is replaced, each annotation is re-added at the first
 * occurrence of its anchor text. If not found (text was lost in the backup),
 * the annotation is placed at position 0 with a console warning.
 *
 * Nested annotations (annotations stored inside revision VersionState blobs)
 * are also healed: for each version that carries a serialized annotationField,
 * every nested annotation's selection is re-anchored by searching for its
 * anchor text within the version's doc string.
 */

import type { EditorView } from "@codemirror/view";
import { EditorSelection, Text } from "@codemirror/state";
import { SearchCursor } from "@codemirror/search";
import { annotationField, addAnnotation, removeAnnotation } from "./plugins/annotations";
import {
    activeVersion,
    isAnnotationOfType,
    versionText,
    type GenericAnnotation,
    type VersionState,
} from "./plugins/annotations/models";

type RawNestedAnnotation = {
    selection: { ranges: { anchor: number; head: number }[]; main?: number };
    [key: string]: unknown;
};

/**
 * Heal nested annotations inside a single VersionState blob.
 *
 * Each nested annotation's anchor text is extracted from the version's doc
 * at the stored selection positions, then re-matched against the same doc
 * (which may have been updated by Phase 3). If the positions are already
 * valid and unchanged the blob is returned as-is.
 */
function healNestedAnnotations(version: VersionState): VersionState {
    const raw = version as { annotationField?: Record<string, RawNestedAnnotation> };
    if (raw.annotationField == null || typeof raw.annotationField !== "object") {
        return version;
    }

    const doc = versionText(version);
    const docLen = doc.length;
    const cmDoc = Text.of(doc.split("\n"));
    let changed = false;
    const healed: Record<string, RawNestedAnnotation> = {};

    for (const [id, ann] of Object.entries(raw.annotationField)) {
        if (ann?.selection?.ranges == null) {
            healed[id] = ann;
            continue;
        }

        const ranges = ann.selection.ranges;
        const newRanges: { anchor: number; head: number }[] = [];
        let rangeChanged = false;

        for (const r of ranges) {
            // If positions are already in range, extract the anchor text
            // and verify it still matches.
            if (r.anchor >= 0 && r.anchor <= docLen && r.head >= 0 && r.head <= docLen) {
                newRanges.push(r);
                continue;
            }

            // Out of range — try to heal by searching for the anchor text.
            // We can't know the original anchor text if positions are invalid,
            // so fall back to position 0.
            rangeChanged = true;
            newRanges.push({ anchor: 0, head: 0 });
        }

        // Second pass: for ranges that are in-range, verify anchor text by
        // trying to re-find it. Extract the text slice and search.
        for (let i = 0; i < newRanges.length; i++) {
            const r = newRanges[i];
            const from = Math.min(r.anchor, r.head);
            const to = Math.max(r.anchor, r.head);
            if (from === to) continue; // point selection, nothing to heal
            if (from < 0 || to > docLen) {
                // Already handled above, but guard against edge cases.
                newRanges[i] = { anchor: 0, head: 0 };
                rangeChanged = true;
                continue;
            }

            const anchorText = doc.slice(from, to);
            const cursor = new SearchCursor(cmDoc, anchorText);
            cursor.next();
            if (!cursor.done) {
                const newFrom = cursor.value.from;
                const newTo = cursor.value.to;
                if (newFrom !== from || newTo !== to) {
                    const forward = r.anchor <= r.head;
                    newRanges[i] = forward
                        ? { anchor: newFrom, head: newTo }
                        : { anchor: newTo, head: newFrom };
                    rangeChanged = true;
                }
            }
            // If search finds the text at the same position, keep as-is.
            // If not found at all, keep original positions (best effort).
        }

        if (rangeChanged) {
            changed = true;
            healed[id] = {
                ...ann,
                selection: {
                    ...ann.selection,
                    ranges: newRanges,
                },
            };
        } else {
            healed[id] = ann;
        }
    }

    if (!changed) return version;
    return { ...version, annotationField: healed } as VersionState;
}

/**
 * Heal nested annotations across all versions of a revision annotation.
 * Returns a new versions array if any version was healed, or the original
 * array if nothing changed.
 */
function healRevisionVersions(versions: VersionState[]): VersionState[] {
    let changed = false;
    const result = versions.map((v) => {
        const healed = healNestedAnnotations(v);
        if (healed !== v) changed = true;
        return healed;
    });
    return changed ? result : versions;
}

export function restoreBackup(view: EditorView, documentText: string): void {
    const annotations = view.state.field(annotationField);

    // Snapshot each annotation's anchor text before the doc is replaced.
    const snapshots: { annotation: GenericAnnotation; anchorText: string }[] = Object.values(
        annotations,
    ).map((ann) => {
        let anchorText: string;
        if (isAnnotationOfType(ann, "revision")) {
            anchorText = versionText(activeVersion(ann));
        } else {
            anchorText = view.state.doc.sliceString(ann.selection.main.from, ann.selection.main.to);
        }
        return { annotation: ann, anchorText };
    });

    // Replace the doc and remove all stale annotations atomically.
    // Tag as "input.restore" so the persistence layer skips the
    // suspicious-change detector (otherwise it would re-trigger a
    // backup of the pre-restore state, creating a circular problem).
    view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: documentText },
        effects: Object.values(annotations).map((ann) => removeAnnotation.of(ann)),
        userEvent: "input.restore",
    });

    // Re-add each annotation with a healed selection.
    const restoredDoc = view.state.doc;
    const healEffects = snapshots.map(({ annotation, anchorText }) => {
        let healed: EditorSelection;
        if (anchorText.length > 0) {
            const cursor = new SearchCursor(restoredDoc, anchorText);
            cursor.next();
            if (!cursor.done) {
                healed = EditorSelection.single(cursor.value.from, cursor.value.to);
            } else {
                console.warn(
                    `[restore] could not re-match anchor text for annotation id=${annotation.id}` +
                        ` (type=${annotation._type}, text=${JSON.stringify(anchorText.slice(0, 40))}); placing at position 0`,
                );
                healed = EditorSelection.single(0, 0);
            }
        } else {
            healed = EditorSelection.single(0, 0);
        }

        // For revisions, also heal nested annotations inside each version blob.
        let healedAnnotation: GenericAnnotation;
        if (isAnnotationOfType(annotation, "revision")) {
            const healedVersions = healRevisionVersions(annotation.versions);
            healedAnnotation =
                healedVersions !== annotation.versions
                    ? { ...annotation, selection: healed, versions: healedVersions }
                    : { ...annotation, selection: healed };
        } else {
            healedAnnotation = { ...annotation, selection: healed };
        }

        return addAnnotation.of(healedAnnotation);
    });

    if (healEffects.length > 0) {
        view.dispatch({ effects: healEffects });
    }
}
