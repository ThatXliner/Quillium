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
 */

import type { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";
import { SearchCursor } from "@codemirror/search";
import { annotationField, addAnnotation, removeAnnotation } from "./plugins/annotations";
import { isAnnotationOfType, versionText, type GenericAnnotation } from "./plugins/annotations/models";

export function restoreBackup(view: EditorView, documentText: string): void {
    const annotations = view.state.field(annotationField);

    // Snapshot each annotation's anchor text before the doc is replaced.
    const snapshots: { annotation: GenericAnnotation; anchorText: string }[] = Object.values(
        annotations,
    ).map((ann) => {
        let anchorText: string;
        if (isAnnotationOfType(ann, "revision")) {
            anchorText = versionText(ann.versions[ann.activeVersionIndex]);
        } else {
            anchorText = view.state.doc.sliceString(
                ann.selection.main.from,
                ann.selection.main.to,
            );
        }
        return { annotation: ann, anchorText };
    });

    // Replace the doc and remove all stale annotations atomically.
    view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: documentText },
        effects: Object.values(annotations).map((ann) => removeAnnotation.of(ann)),
        userEvent: "input",
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
        return addAnnotation.of({ ...annotation, selection: healed });
    });

    if (healEffects.length > 0) {
        view.dispatch({ effects: healEffects });
    }
}
