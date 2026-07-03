import { describe, expect, it } from "vitest";
import {
    buildDisplayedShare,
    buildParagraphBlocks,
    buildReadonlyShareFingerprint,
    buildShareFingerprint,
    decodeReadonlySharePayload,
    encodeReadonlySharePayload,
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

describe("readonly share payloads", () => {
    it("round-trips a multi-tab share payload", () => {
        const encoded = encodeReadonlySharePayload({
            activeTabId: "notes",
            tabs: [
                {
                    id: "draft",
                    label: "Draft",
                    draftId: "draft-1",
                    content: "Draft body",
                    annotations: [comment],
                },
                {
                    id: "notes",
                    label: "Notes",
                    draftId: "draft-2",
                    content: "Notes body",
                    annotations: [],
                },
            ],
        });

        const decoded = decodeReadonlySharePayload(encoded, [comment]);

        expect(decoded.isMultiTabPayload).toBe(true);
        expect(decoded.activeTabId).toBe("notes");
        expect(decoded.content).toBe("Notes body");
        expect(decoded.tabs.map((tab) => tab.label)).toEqual(["Draft", "Notes"]);
    });

    it("falls back to a legacy single-tab payload", () => {
        const decoded = decodeReadonlySharePayload("Legacy body", [comment]);

        expect(decoded.isMultiTabPayload).toBe(false);
        expect(decoded.content).toBe("Legacy body");
        expect(decoded.tabs).toEqual([
            {
                id: "legacy",
                label: "Document",
                draftId: null,
                content: "Legacy body",
                annotations: [comment],
            },
        ]);
    });

    it("fingerprints tab order and content", () => {
        const first = buildReadonlyShareFingerprint(
            "Doc",
            [
                {
                    id: "a",
                    label: "A",
                    draftId: "draft-a",
                    content: "A",
                    annotations: [],
                },
                {
                    id: "b",
                    label: "B",
                    draftId: "draft-b",
                    content: "B",
                    annotations: [],
                },
            ],
            "a",
        );
        const reordered = buildReadonlyShareFingerprint(
            "Doc",
            [
                {
                    id: "b",
                    label: "B",
                    draftId: "draft-b",
                    content: "B",
                    annotations: [],
                },
                {
                    id: "a",
                    label: "A",
                    draftId: "draft-a",
                    content: "A",
                    annotations: [],
                },
            ],
            "a",
        );

        expect(first).not.toBe(reordered);
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
                text: "world",
                annotations: [],
            },
            {
                index: 1,
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
