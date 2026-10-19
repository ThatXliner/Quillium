/** annotationDecorations.ts — Shared annotation marks, persona dots and atomic ranges. */
import { type Range, RangeSetBuilder } from "@codemirror/state";
import { Decoration, type DecorationSet, WidgetType } from "@codemirror/view";
import {
    type Annotations,
    RawAnnotationsSchema,
    type VersionState,
    activeVersion,
    isAnnotationOfType,
    isRawAnnotationOfType,
    normalizeRevision,
} from "./models";

/** Add one offset underline per nested revision in the displayed version only. */
export function getNestedRevisionDecorations(annotations: Annotations): DecorationSet {
    const marks: Range<Decoration>[] = [];
    function visit(version: VersionState, offset: number, length: number, depth: number): void {
        const raw = (version as { annotationField?: unknown }).annotationField;
        if (!raw) return;
        const parsed = RawAnnotationsSchema.safeParse(raw);
        if (!parsed.success) return;
        for (const annotation of Object.values(parsed.data)) {
            if (!isRawAnnotationOfType(annotation, "revision")) continue;
            const range = annotation.selection.ranges[annotation.selection.main ?? 0];
            if (!range) continue;
            const from = Math.min(range.anchor, range.head);
            const to = Math.max(range.anchor, range.head);
            if (
                !Number.isInteger(from) ||
                !Number.isInteger(to) ||
                from < 0 ||
                to > length ||
                from === to
            )
                continue;
            marks.push(
                Decoration.mark({
                    class: "cm-revision-nested",
                    attributes: {
                        "data-revision-depth": String(depth),
                        style: `text-underline-offset: ${depth * 3}px`,
                    },
                    inclusive: true,
                }).range(offset + from, offset + to),
            );
            visit(
                activeVersion(normalizeRevision(annotation)),
                offset + from,
                to - from,
                depth + 1,
            );
        }
    }
    for (const annotation of Object.values(annotations)) {
        if (!isAnnotationOfType(annotation, "revision")) continue;
        const { from, to } = annotation.selection.main;
        if (from < to) visit(activeVersion(annotation), from, to - from, 2);
    }
    return Decoration.set(marks, true);
}

/** A named reader persona and the accent color used for its suggestion dot. */
export type PersonaColor = { name: string; color: string };

class PersonaDotWidget extends WidgetType {
    constructor(readonly color: string) {
        super();
    }
    eq(other: PersonaDotWidget): boolean {
        return this.color === other.color;
    }
    toDOM(): HTMLElement {
        const dot = document.createElement("span");
        dot.className = "cm-persona-dot";
        dot.style.backgroundColor = this.color;
        return dot;
    }
    ignoreEvent(): boolean {
        return true;
    }
}

export function getPersonaDots(
    annotations: Annotations,
    personas: readonly PersonaColor[],
): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    const dots = Object.values(annotations)
        .filter((annotation) => isAnnotationOfType(annotation, "suggestion"))
        .flatMap((suggestion) => {
            if (!suggestion.author || suggestion.author === "AI") return [];
            const persona = personas.find((p) => p.name === suggestion.author);
            return persona ? [{ pos: suggestion.selection.main.to, color: persona.color }] : [];
        })
        .sort((a, b) => a.pos - b.pos);

    for (const { pos, color } of dots) {
        builder.add(pos, pos, Decoration.widget({ widget: new PersonaDotWidget(color), side: 1 }));
    }
    return builder.finish();
}

export function buildRevisionAtomicRanges(
    annotations: Annotations,
    enabled: boolean,
): DecorationSet {
    if (!enabled) return Decoration.none;
    const builder = new RangeSetBuilder<Decoration>();
    const revisions = Object.values(annotations)
        .filter((annotation) => isAnnotationOfType(annotation, "revision"))
        .sort((a, b) => a.selection.main.from - b.selection.main.from);
    for (const revision of revisions) {
        const { from, to } = revision.selection.main;
        if (from === to) continue;
        builder.add(from, to, Decoration.mark({}));
    }
    return builder.finish();
}
