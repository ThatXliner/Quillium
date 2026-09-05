/**
 * readonlyExtensions.ts — Read-only CodeMirror extension stack for the
 * public share/preview renderer.
 *
 * This is the web-facing counterpart to the desktop editor's extension
 * bundle. It reuses the EXACT annotation core (annotationField,
 * versionGroupField, models, utils) copied into this package, so shared
 * documents render through the same computation the desktop editor uses —
 * including linked revisions (version groups).
 *
 * Only the *rendering* subset is included: the annotation highlight
 * decorations, revision atomic ranges, and the two state fields. All
 * editing-only machinery (keymaps, commands, clipboard, nested-editor
 * controllers, collapsedRevisionResolver, boundaryInsertNudge) is
 * intentionally dropped.
 *
 * Desktop globals that the decorations depend on (appSettings.atomicRevisions,
 * readersSettings.personas) are injected by the host via Facets instead of
 * module imports, so this file has zero app/Tauri coupling.
 */
import {
    EditorState,
    type Extension,
    Facet,
    RangeSet,
    RangeSetBuilder,
    type SelectionRange,
} from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import { filter, flatMap } from "lodash-es";
import {
    type PersonaColor,
    buildRevisionAtomicRanges,
    getPersonaDots,
} from "./annotationDecorations";
import { annotationField } from "./annotationField";
import { type AnnotationType, isAnnotationOfType } from "./models";
import { getActiveAnnotation } from "./utils";
import { versionGroupField } from "./versionGroupField";

// ── Injected configuration (replaces desktop global stores) ─────
export type { PersonaColor } from "./annotationDecorations";

/** Mirrors appSettings.atomicRevisions. Last provided value wins; default true. */
export const atomicRevisionsFacet = Facet.define<boolean, boolean>({
    combine: (values) => (values.length ? values[values.length - 1] : true),
});

/** Mirrors readersSettings.personas (name+color only). Providers are concatenated. */
export const personaColorsFacet = Facet.define<PersonaColor[], PersonaColor[]>({
    combine: (values) => values.flat(),
});

// Fields serialized into the wire payload and restored via
// EditorState.fromJSON(json, { extensions }, readonlySavedFields).
// Mirrors the desktop editor's persisted fields (public snapshots also carry
// no undo history).
export const readonlySavedFields = { annotationField, versionGroupField };

// ── Annotation highlight decorations (copied from desktop index.ts) ──
function getAnnotationDecorations(
    state: EditorState,
    type: AnnotationType,
    classPrefix: string,
): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    const annotationRanges = flatMap(
        filter(Object.values(state.field(annotationField)), (annotation) =>
            isAnnotationOfType(annotation, type),
        ),
        (annotation) => annotation.selection.main,
    );
    const activeRanges: readonly SelectionRange[] =
        getActiveAnnotation(state, type)?.selection?.ranges ?? [];
    // Ranges must be added in ascending order or RangeSetBuilder throws.
    annotationRanges.sort((a, b) => a.from - b.from);

    const toHighlight = [
        ...annotationRanges.map((x) => ({ active: false, x })),
        ...activeRanges.map((x) => ({ active: true, x })),
    ].sort((a, b) => a.x.from - b.x.from);
    for (const {
        x: { from, to },
        active,
    } of toHighlight) {
        builder.add(
            from,
            to,
            Decoration.mark({
                class: active ? `${classPrefix}-active` : classPrefix,
                inclusive: true,
            }),
        );
    }
    return builder.finish();
}

const annotationDecorations = EditorView.decorations.compute(
    ["doc", "selection", annotationField],
    (state) =>
        RangeSet.join([
            getAnnotationDecorations(state, "comment", "cm-comment"),
            getAnnotationDecorations(state, "revision", "cm-revision"),
            getAnnotationDecorations(state, "suggestion", "cm-suggestion"),
            getPersonaDots(state.field(annotationField), state.facet(personaColorsFacet)),
        ]),
);

const revisionAtomicRanges = EditorView.atomicRanges.of((view) =>
    buildRevisionAtomicRanges(
        view.state.field(annotationField),
        view.state.facet(atomicRevisionsFacet),
    ),
);

// ── Public factory ──────────────────────────────────────────────
export type ReadonlyExtensionConfig = {
    /** Match the author's editor setting (default true). */
    atomicRevisions?: boolean;
    /** Persona name→color pairs so custom-persona suggestion dots render. */
    personaColors?: PersonaColor[];
};

/**
 * The full extension array for a read-only annotated document view. Feed the
 * result to EditorState.create/fromJSON. The view is non-editable by the user,
 * but programmatic dispatches (e.g. switching a revision version, which
 * cascades through linked version groups) still apply.
 */
export function getReadonlyExtensions(config: ReadonlyExtensionConfig = {}): Extension[] {
    return [
        annotationField,
        versionGroupField,
        annotationDecorations,
        revisionAtomicRanges,
        atomicRevisionsFacet.of(config.atomicRevisions ?? true),
        personaColorsFacet.of(config.personaColors ?? []),
        EditorView.editable.of(false),
        EditorState.readOnly.of(true),
        EditorView.lineWrapping,
    ];
}
