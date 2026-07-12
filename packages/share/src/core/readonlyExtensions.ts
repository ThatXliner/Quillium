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
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { filter, flatMap } from "lodash-es";
import { annotationField } from "./annotationField";
import { type Annotation, type AnnotationType, isAnnotationOfType } from "./models";
import { getActiveAnnotation } from "./utils";
import { versionGroupField } from "./versionGroupField";

// ── Injected configuration (replaces desktop global stores) ─────
/** A named reader persona and the accent color used for its suggestion dot. */
export type PersonaColor = { name: string; color: string };

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
// Mirrors the desktop editor's savedFields MINUS historyField (the public
// snapshot carries no undo history).
export const readonlySavedFields = { annotationField, versionGroupField };

// ── Annotation highlight decorations (copied from desktop index.ts) ──
class PersonaDotWidget extends WidgetType {
    constructor(readonly color: string) {
        super();
    }
    eq(other: PersonaDotWidget) {
        return this.color === other.color;
    }
    toDOM() {
        const dot = document.createElement("span");
        dot.className = "cm-persona-dot";
        dot.style.backgroundColor = this.color;
        return dot;
    }
    ignoreEvent() {
        return true;
    }
}

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

function getPersonaDots(state: EditorState): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    const personas = state.facet(personaColorsFacet);
    const suggestions = filter(Object.values(state.field(annotationField)), (a) =>
        isAnnotationOfType(a, "suggestion"),
    ) as Array<Annotation<"suggestion">>;

    const dots = flatMap(suggestions, (s) => {
        if (!s.author || s.author === "AI") return [];
        const persona = personas.find((p) => p.name === s.author);
        return persona ? [{ pos: s.selection.main.to, color: persona.color }] : [];
    }).sort((a, b) => a.pos - b.pos);

    for (const { pos, color } of dots) {
        builder.add(pos, pos, Decoration.widget({ widget: new PersonaDotWidget(color), side: 1 }));
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
            getPersonaDots(state),
        ]),
);

// ── Revision atomic ranges (copied; gated by facet) ─────────────
function buildAtomicRanges(state: EditorState): DecorationSet {
    if (!state.facet(atomicRevisionsFacet)) return Decoration.none;
    const builder = new RangeSetBuilder<Decoration>();
    const revisions = Object.values(state.field(annotationField))
        .filter((annotation) => isAnnotationOfType(annotation, "revision"))
        .sort((a, b) => a.selection.main.from - b.selection.main.from);
    for (const revision of revisions) {
        const { from, to } = revision.selection.main;
        if (from === to) continue;
        builder.add(from, to, Decoration.mark({}));
    }
    return builder.finish();
}

const revisionAtomicRanges = EditorView.atomicRanges.of((view) => buildAtomicRanges(view.state));

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
