import { describe, expect, it } from "vitest";
import {
    buildDisplayedShare,
    buildParagraphBlocks,
    buildShareFingerprint,
    findAnnotationPath,
} from "../src/rendering";
import type { SerializedAnnotation } from "../src/types";

const comment = {
    id: "c1",
    type: "comment",
    from: 0,
    to: 5,
    selectedText: "Hello",
    thread: [{ author: "A", message: "Note", time: 1 }],
} satisfies SerializedAnnotation;

describe("buildShareFingerprint", () => {
    it("is stable across object key order", () => {
        const reordered = {
            thread: comment.thread,
            selectedText: comment.selectedText,
            to: comment.to,
            type: comment.type,
            id: comment.id,
            from: comment.from,
        } as SerializedAnnotation;

        expect(buildShareFingerprint("Doc", "Hello", [comment])).toBe(
            buildShareFingerprint("Doc", "Hello", [reordered]),
        );
    });

    it("changes when annotations change", () => {
        expect(buildShareFingerprint("Doc", "Hello", [])).not.toBe(
            buildShareFingerprint("Doc", "Hello", [comment]),
        );
    });
});

describe("buildParagraphBlocks", () => {
    it("segments annotations across paragraphs", () => {
        const blocks = buildParagraphBlocks("Hello\nworld", [
            { ...comment, from: 6, to: 11, selectedText: "world" },
        ]);

        expect(blocks).toHaveLength(2);
        expect(blocks[0].annotations).toEqual([]);
        expect(blocks[1].annotations).toHaveLength(1);
        expect(blocks[1].segments[0].annotationIds).toEqual(["c1"]);
    });
});

describe("revision rendering", () => {
    const revision = {
        id: "r1",
        type: "revision",
        from: 6,
        to: 11,
        selectedText: "world",
        thread: [],
        activeVersionIndex: 0,
        versions: [
            {
                index: 0,
                versionId: "original",
                text: "world",
                annotations: [],
            },
            {
                index: 1,
                versionId: "alternate",
                text: "reader",
                annotations: [
                    {
                        id: "nested",
                        type: "comment",
                        from: 0,
                        to: 6,
                        selectedText: "reader",
                        thread: [],
                    },
                ],
            },
        ],
    } satisfies SerializedAnnotation;

    it("projects the selected revision version into the displayed document", () => {
        const displayed = buildDisplayedShare("Hello world", [revision], { r1: 1 });

        expect(displayed.content).toBe("Hello reader");
        expect(displayed.annotations.map((annotation) => annotation.id).sort()).toEqual([
            "nested",
            "r1",
        ]);
        expect(displayed.annotations.find((annotation) => annotation.id === "nested")?.from).toBe(
            6,
        );
    });

    it("finds nested annotation paths", () => {
        const path = findAnnotationPath("nested", "Hello world", [revision]);

        expect(path?.map((entry) => entry.annotation.id)).toEqual(["r1", "nested"]);
        expect(path?.[0].viaVersionIndex).toBe(1);
    });
});
