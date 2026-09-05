import { EditorSelection } from "@codemirror/state";
import { Decoration, type DecorationSet } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { buildRevisionAtomicRanges, getPersonaDots } from "../src/core/annotationDecorations";
import { type Annotations, createNewAnnotation, makeVersion } from "../src/core/models";

function ranges(set: DecorationSet): Array<{ from: number; to: number; value: Decoration }> {
    const result = [];
    for (const cursor = set.iter(); cursor.value; cursor.next()) {
        result.push({ from: cursor.from, to: cursor.to, value: cursor.value });
    }
    return result;
}

const personas = [
    { name: "Custom", color: "red" },
    { name: "Other", color: "blue" },
    { name: "Custom", color: "green" },
    { name: "AI", color: "black" },
];

describe("persona dots", () => {
    it("sorts suggestion ends stably, resolves the first matching persona, and skips unknown authors", () => {
        const annotations: Annotations = {};
        for (const [author, end] of [
            ["Custom", 9],
            ["Other", 3],
            ["Custom", 3],
            [undefined, 4],
            ["AI", 5],
            ["Unknown", 6],
            ["custom", 7],
        ] as const) {
            const suggestion = {
                ...createNewAnnotation(annotations, EditorSelection.single(0, end), "suggestion"),
                author,
                replacements: [],
            };
            annotations[suggestion.id] = suggestion;
        }
        const comment = createNewAnnotation(annotations, EditorSelection.single(0, 2), "comment");
        annotations[comment.id] = comment;
        const dots = ranges(getPersonaDots(annotations, personas));
        expect(
            dots.map(({ from, to, value }) => [from, to, value.spec.widget.color, value.spec.side]),
        ).toEqual([
            [3, 3, "blue", 1],
            [3, 3, "red", 1],
            [9, 9, "red", 1],
        ]);
        expect(dots[1].value.spec.widget.eq(dots[2].value.spec.widget)).toBe(true);
        expect(dots[0].value.spec.widget.eq(dots[1].value.spec.widget)).toBe(false);
        expect(getPersonaDots(annotations, []).size).toBe(0);
        expect(getPersonaDots({}, personas).size).toBe(0);
    });

    it("keeps a dot on an empty suggestion at its main range", () => {
        const suggestion = {
            ...createNewAnnotation({}, EditorSelection.single(4), "suggestion"),
            author: "Custom",
            replacements: [],
        };
        expect(
            ranges(getPersonaDots({ 0: suggestion }, personas)).map(({ from, to }) => [from, to]),
        ).toEqual([[4, 4]]);
    });
});

describe("revision atomic ranges", () => {
    it("sorts revisions, ignores empty revisions and other annotations, and honors the switch", () => {
        const annotations: Annotations = {};
        for (const [from, to] of [
            [8, 10],
            [3, 6],
            [2, 2],
            [3, 5],
        ]) {
            const version = makeVersion({ doc: "x".repeat(to - from) });
            const revision = {
                ...createNewAnnotation(annotations, EditorSelection.single(from, to), "revision"),
                activeVersionId: version.id,
                versions: [version],
            };
            annotations[revision.id] = revision;
        }
        const comment = createNewAnnotation(annotations, EditorSelection.single(0, 1), "comment");
        annotations[comment.id] = comment;
        expect(
            ranges(buildRevisionAtomicRanges(annotations, true)).map(({ from, to }) => [from, to]),
        ).toEqual([
            [3, 5],
            [3, 6],
            [8, 10],
        ]);
        expect(buildRevisionAtomicRanges(annotations, false)).toBe(Decoration.none);
        expect(buildRevisionAtomicRanges({}, true).size).toBe(0);
    });
});
