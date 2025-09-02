import { EditorView, Decoration, type DecorationSet } from "@codemirror/view";
import { StateField, StateEffect } from "@codemirror/state";
import type { GenericAnnotation } from "./models";

// Effect to highlight an annotation
export const highlightAnnotation = StateEffect.define<GenericAnnotation | null>();

// Decoration for highlighted annotations
const highlightDecoration = Decoration.mark({
    class: "annotation-highlight",
    attributes: {
        style: `
            background-color: rgba(59, 130, 246, 0.1);
            border-bottom: 2px solid rgba(59, 130, 246, 0.5);
            transition: all 0.3s ease;
            cursor: pointer;
        `
    }
});

// State field to track highlighted annotation
export const highlightField = StateField.define<DecorationSet>({
    create() {
        return Decoration.none;
    },
    update(decorations, tr) {
        decorations = decorations.map(tr.changes);
        
        for (const effect of tr.effects) {
            if (effect.is(highlightAnnotation)) {
                if (effect.value) {
                    // Add highlight decoration
                    const { from, to } = effect.value.selection.main;
                    decorations = Decoration.set([
                        highlightDecoration.range(from, to)
                    ]);
                } else {
                    // Clear decorations
                    decorations = Decoration.none;
                }
            }
        }
        
        return decorations;
    },
    provide: f => EditorView.decorations.from(f)
});

// Add CSS for smooth transitions
export const highlightTheme = EditorView.theme({
    ".annotation-highlight": {
        transition: "all 0.3s ease",
        "&:hover": {
            backgroundColor: "rgba(59, 130, 246, 0.2)",
        }
    }
});