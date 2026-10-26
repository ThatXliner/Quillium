import { EditorSelection } from "@codemirror/state";
import { Decoration, type DecorationSet } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import {
    buildRevisionAtomicRanges,
    getNestedRevisionDecorations,
    getPersonaDots,
} from "../src/core/annotationDecorations";
import {
    type Annotation,
    type Annotations,
    createNewAnnotation,
    makeVersion,
} from "../src/core/models";

function revision(from: number, to: number, children: Annotations = {}): Annotation<"revision"> {
    const version = makeVersion({ doc: "x".repeat(to - from) });
    Object.assign(version, {
        annotationField: Object.fromEntries(
            Object.entries(children).map(([id, annotation]) => [
                id,
                { ...annotation, selection: annotation.selection.toJSON() },
            ]),
        ),
    });
    return {
        ...createNewAnnotation({}, EditorSelection.single(from, to), "revision"),
        versions: [version],
        activeVersionId: version.id,
    };
}

describe("nested revision underlines", () => {
    it("projects only nested revision ranges, with one line per depth and editor-scoped IDs", () => {
        const comment = createNewAnnotation({}, EditorSelection.single(0, 2), "comment");
        const root = revision(10, 30, {
            0: revision(2, 12, { 0: revision(3, 7) }),
            1: comment,
            2: revision(14, 18),
            3: revision(18, 18),
        });
        expect(
            ranges(getNestedRevisionDecorations({ 0: root })).map(({ from, to, value }) => [
                from,
                to,
                value.spec.attributes["data-revision-depth"],
                value.spec.attributes.style,
            ]),
        ).toEqual([
            [12, 22, "2", "text-underline-offset: 6px"],
            [15, 19, "3", "text-underline-offset: 9px"],
            [24, 28, "2", "text-underline-offset: 6px"],
        ]);
    });

    it("follows stable active version IDs and leaves inactive branches unmarked", () => {
        const root = revision(0, 10, { 0: revision(1, 9) });
        const plain = makeVersion({ doc: "x".repeat(10) });
        root.versions.unshift(plain);
        expect(getNestedRevisionDecorations({ 0: root }).size).toBe(1);
        root.activeVersionId = plain.id;
        expect(getNestedRevisionDecorations({ 0: root }).size).toBe(0);
    });

    it("ignores malformed or out-of-bounds nested data without hiding valid siblings", () => {
        const root = revision(5, 15, {
            0: revision(1, 4),
            1: revision(8, 12),
        });
        expect(
            ranges(getNestedRevisionDecorations({ 0: root })).map(({ from, to }) => [from, to]),
        ).toEqual([[6, 9]]);
        Object.assign(root.versions[0], { annotationField: { bad: {} } });
        expect(getNestedRevisionDecorations({ 0: root }).size).toBe(0);
    });
});

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
