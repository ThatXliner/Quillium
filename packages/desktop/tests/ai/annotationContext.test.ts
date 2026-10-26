import { buildAnnotationContextInputs } from "$lib/ai/annotationContext";
import {
    type Annotations,
    type GenericAnnotation,
    makeVersion,
} from "$lib/editor/plugins/annotations/models";
import { EditorSelection } from "@codemirror/state";
import { describe, expect, it } from "vitest";

function commentAnnotation({
    id,
    documentContent,
    targetText,
}: {
    id: number;
    documentContent: string;
    targetText: string;
}): GenericAnnotation {
    const from = documentContent.indexOf(targetText);
    return {
        id,
        _type: "comment",
        status: "active" as const,
        selection: EditorSelection.single(from, from + targetText.length),
        thread: [{ author: "AI", message: `Note on ${targetText}.`, time: id }],
    };
}

describe("buildAnnotationContextInputs", () => {
    it("extracts target text, thread messages, and selection distance", () => {
        const documentContent = "Opening claim. This sentence needs evidence. Closing line.";
        const from = documentContent.indexOf("This sentence");
        const to = from + "This sentence".length;
        const annotation: GenericAnnotation = {
            id: 4,
            _type: "comment",
            status: "active" as const,
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
            status: "active" as const,
            selection: EditorSelection.single(4, 12),
            thread: [],
            replacements: [{ text: "case", rationale: "Less combative" }],
        };
        const v0 = makeVersion({ label: "Expanded", doc: "thin because it lacks evidence" });
        const revision: GenericAnnotation = {
            id: 2,
            _type: "revision",
            status: "active" as const,
            selection: EditorSelection.single(16, 20),
            thread: [{ author: "AI", message: "Try a fuller version.", time: 2 }],
            activeVersionId: v0.id,
            versions: [v0],
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

    it("uses editor selection offsets when selected text appears more than once", () => {
        const documentContent = "repeat this idea early. Later, repeat this idea with evidence.";
        const selectedFrom = documentContent.lastIndexOf("repeat this idea");
        const selectedTo = selectedFrom + "repeat this idea".length;
        const annotation: GenericAnnotation = {
            id: 5,
            _type: "comment",
            status: "active" as const,
            selection: EditorSelection.single(selectedFrom, selectedTo),
            thread: [{ author: "AI", message: "This is the relevant repeat.", time: 1 }],
        };

        const inputs = buildAnnotationContextInputs({
            annotations: { 5: annotation },
            documentContent,
            selectedText: "repeat this idea",
            selectedTextRange: { from: selectedFrom, to: selectedTo },
        });

        expect(inputs[0]?.distance).toBe(0);
    });

    it("keeps only selection-near annotations when text is selected", () => {
        const documentContent = [
            "Opening paragraph has an old concern.",
            "Setup paragraph has nearby context.",
            "Selected paragraph has the sentence that matters.",
            "Follow-up paragraph has another local note.",
            "Distant paragraph has unrelated feedback.",
        ].join("\n\n");
        const selectedText = "sentence that matters";
        const selectedFrom = documentContent.indexOf(selectedText);
        const selectedTo = selectedFrom + selectedText.length;
        const annotations: Annotations = {
            1: commentAnnotation({
                id: 1,
                documentContent,
                targetText: "old concern",
            }),
            2: commentAnnotation({
                id: 2,
                documentContent,
                targetText: "nearby context",
            }),
            3: commentAnnotation({
                id: 3,
                documentContent,
                targetText: "sentence that matters",
            }),
            4: commentAnnotation({
                id: 4,
                documentContent,
                targetText: "another local note",
            }),
            5: commentAnnotation({
                id: 5,
                documentContent,
                targetText: "unrelated feedback",
            }),
        };

        const inputs = buildAnnotationContextInputs({
            annotations,
            documentContent,
            selectedText,
            selectedTextRange: { from: selectedFrom, to: selectedTo },
        });

        expect(inputs.map((input) => input.id)).toEqual([2, 3, 4]);
    });

    it("keeps all annotations when there is no active selection", () => {
        const documentContent = "First note here.\n\nSecond note there.";
        const annotations: Annotations = {
            1: commentAnnotation({ id: 1, documentContent, targetText: "First note" }),
            2: commentAnnotation({ id: 2, documentContent, targetText: "Second note" }),
        };

        const inputs = buildAnnotationContextInputs({ annotations, documentContent });

        expect(inputs.map((input) => input.id)).toEqual([1, 2]);
    });
});
