/** annotationDecorations.ts — Shared persona dots and revision atomic ranges. */
import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, type DecorationSet, WidgetType } from "@codemirror/view";
import { type Annotations, isAnnotationOfType } from "./models";

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
