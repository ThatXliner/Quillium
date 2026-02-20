import { RangeSetBuilder } from "@codemirror/state";
import {
    Decoration,
    type DecorationSet,
    type EditorView,
    type ViewUpdate,
    ViewPlugin,
    WidgetType,
} from "@codemirror/view";
import { isAnnotationOfType } from "./models";
import {
    annotationField,
    addAnnotation,
    removeAnnotation,
} from "./annotationField";
import { getActiveAnnotation } from "./utils";

export const REVISION_DELIMITER = "\u200B"; // Zero-Width Space

class RevisionBoundaryWidget extends WidgetType {
    constructor(readonly active: boolean) {
        super();
    }

    eq(other: RevisionBoundaryWidget): boolean {
        return this.active === other.active;
    }

    toDOM(): HTMLElement {
        const span = document.createElement("span");
        span.className = "cm-revision-boundary";
        if (this.active) {
            span.className += " cm-revision-boundary-active";
        }
        return span;
    }

    ignoreEvent(): boolean {
        return true;
    }
}

export const revisionBoundaryDecorations = ViewPlugin.fromClass(
    class {
        decorations: DecorationSet;

        constructor(view: EditorView) {
            this.decorations = this.buildDecorations(view);
        }

        update(update: ViewUpdate) {
            if (
                update.docChanged ||
                update.selectionSet ||
                update.transactions.some((tr) =>
                    tr.effects.some(
                        (e) =>
                            e.is(addAnnotation) ||
                            e.is(removeAnnotation),
                    ),
                )
            ) {
                this.decorations = this.buildDecorations(update.view);
            }
        }

        buildDecorations(view: EditorView): DecorationSet {
            const builder = new RangeSetBuilder<Decoration>();
            const annotations = view.state.field(annotationField);
            const activeRevision = getActiveAnnotation(
                view.state,
                "revision",
            );

            // Collect all boundary decorations and sort by position
            const decos: {
                from: number;
                to: number;
                deco: Decoration;
            }[] = [];

            for (const annotation of Object.values(annotations)) {
                if (!isAnnotationOfType(annotation, "revision")) continue;
                const { from, to } = annotation.selection.main;
                if (to - from <= 2) continue; // skip collapsed (only delimiters)

                const isActive = activeRevision?.id === annotation.id;

                // Left delimiter: replace [from, from+1]
                decos.push({
                    from,
                    to: from + 1,
                    deco: Decoration.replace({
                        widget: new RevisionBoundaryWidget(isActive),
                    }),
                });

                // Right delimiter: replace [to-1, to]
                decos.push({
                    from: to - 1,
                    to,
                    deco: Decoration.replace({
                        widget: new RevisionBoundaryWidget(isActive),
                    }),
                });
            }

            // RangeSetBuilder requires sorted order
            decos.sort((a, b) =>
                a.from !== b.from ? a.from - b.from : a.to - b.to,
            );

            for (const d of decos) {
                builder.add(d.from, d.to, d.deco);
            }

            return builder.finish();
        }
    },
    {
        decorations: (v) => v.decorations,
    },
);
