import { EditorSelection } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { buildAnnotationContextInputs } from "$lib/ai/annotationContext";
import type { Annotations, GenericAnnotation } from "$lib/editor/plugins/annotations/models";

describe("buildAnnotationContextInputs", () => {
    it("extracts target text, thread messages, and selection distance", () => {
        const documentContent = "Opening claim. This sentence needs evidence. Closing line.";
        const from = documentContent.indexOf("This sentence");
        const to = from + "This sentence".length;
        const annotation: GenericAnnotation = {
            id: 4,
            _type: "comment",
            selection: EditorSelection.single(from, to),
            thread: [{ author: "Bryan", message: "Needs a source.", time: 1 }],
        };
        const inputs = buildAnnotationContextInputs({
            annotations: { 4: annotation },
            documentContent,
            selectedText: "sentence needs",
            activeAnnotation: annotation,
        });

        expect(inputs).toHaveLength(1);
        expect(inputs[0]).toMatchObject({
            id: 4,
            type: "comment",
            targetText: "This sentence",
            active: true,
            distance: 0,
            messages: [{ author: "Bryan", message: "Needs a source." }],
        });
        expect(inputs[0]?.context).toContain("Opening claim.");
    });

    it("serializes suggestion replacements and revision versions", () => {
        const documentContent = "The argument is thin here.";
        const suggestion: GenericAnnotation = {
            id: 1,
            _type: "suggestion",
            selection: EditorSelection.single(4, 12),
            thread: [],
            replacements: [{ text: "case", rationale: "Less combative" }],
        };
        const revision: GenericAnnotation = {
            id: 2,
            _type: "revision",
            selection: EditorSelection.single(16, 20),
            thread: [{ author: "AI", message: "Try a fuller version.", time: 2 }],
            activeVersionIndex: 0,
            versions: [{ label: "Expanded", doc: "thin because it lacks evidence" }],
        };
        const annotations: Annotations = { 1: suggestion, 2: revision };

        const inputs = buildAnnotationContextInputs({ annotations, documentContent });

        expect(inputs.find((input) => input.id === 1)?.replacements).toEqual([
            { text: "case", rationale: "Less combative" },
        ]);
        expect(inputs.find((input) => input.id === 2)?.versions).toEqual([
            { label: "Expanded", text: "thin because it lacks evidence" },
        ]);
    });
});
