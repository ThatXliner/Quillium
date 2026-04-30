import { EditorSelection } from "@codemirror/state";
import { buildReadonlyShareUrl, buildSharePreviewText } from "$lib/collab/share";
import { buildShareFingerprint, serializeAnnotations } from "$lib/collab/sharePayload";
import { describe, expect, it } from "vitest";

describe("buildReadonlyShareUrl", () => {
    it("builds the public share URL", () => {
        expect(buildReadonlyShareUrl("abc-123")).toBe("https://quillium.bryanhu.com/share/abc-123");
    });
});

describe("buildSharePreviewText", () => {
    it("collapses repeated whitespace", () => {
        expect(buildSharePreviewText("Hello\n\nworld   again", 40)).toBe("Hello world again");
    });

    it("truncates long previews with an ellipsis", () => {
        expect(buildSharePreviewText("abcdefghijklmnopqrstuvwxyz", 10)).toBe("abcdefghi…");
    });
});

describe("buildShareFingerprint", () => {
    it("changes when annotations change", () => {
        expect(buildShareFingerprint("Doc", "hello", [])).not.toBe(
            buildShareFingerprint("Doc", "hello", [
                {
                    id: "1",
                    type: "comment",
                    from: 0,
                    to: 5,
                    selectedText: "hello",
                    thread: [],
                },
            ]),
        );
    });

    it("stays stable when annotation object keys are reordered", () => {
        const localShape = [
            {
                id: "1",
                type: "suggestion",
                from: 0,
                to: 5,
                selectedText: "hello",
                thread: [{ message: "Try this", author: "A", time: 1 }],
                replacements: [{ text: "hi", rationale: "shorter" }],
                author: "A",
            },
        ];

        const roundTrippedShape = [
            {
                author: "A",
                from: 0,
                id: "1",
                replacements: [{ rationale: "shorter", text: "hi" }],
                selectedText: "hello",
                thread: [{ author: "A", message: "Try this", time: 1 }],
                to: 5,
                type: "suggestion",
            },
        ];

        expect(buildShareFingerprint("Doc", "hello", localShape as never[])).toBe(
            buildShareFingerprint("Doc", "hello", roundTrippedShape as never[]),
        );
    });

    it("normalizes undefined object fields to match omitted fields", () => {
        expect(
            buildShareFingerprint("Doc", "hello", [
                {
                    id: "1",
                    type: "suggestion",
                    from: 0,
                    to: 5,
                    selectedText: "hello",
                    thread: [],
                    replacements: [{ text: "hi", rationale: undefined }],
                    author: undefined,
                },
            ] as never[]),
        ).toBe(
            buildShareFingerprint("Doc", "hello", [
                {
                    id: "1",
                    type: "suggestion",
                    from: 0,
                    to: 5,
                    selectedText: "hello",
                    thread: [],
                    replacements: [{ text: "hi" }],
                },
            ] as never[]),
        );
    });
});

describe("serializeAnnotations", () => {
    it("sorts annotations with matching positions by string id", () => {
        const serialized = serializeAnnotations("hello", {
            10: {
                id: "b",
                _type: "comment",
                selection: EditorSelection.single(0, 5),
                thread: [],
            },
            11: {
                id: "a",
                _type: "comment",
                selection: EditorSelection.single(0, 5),
                thread: [],
            },
        } as never);

        expect(serialized.map((annotation) => annotation.id)).toEqual(["a", "b"]);
    });

    it("includes nested revision annotations from revision version state", () => {
        const serialized = serializeAnnotations("hello", {
            0: {
                id: 0,
                _type: "revision",
                selection: EditorSelection.single(0, 5),
                thread: [],
                activeVersionIndex: 0,
                versions: [
                    ({
                        doc: "hello",
                        annotationField: {
                            0: {
                                id: 0,
                                _type: "revision",
                                thread: [],
                                activeVersionIndex: 0,
                                versions: [{ doc: "ell" }],
                                selection: {
                                    ranges: [{ anchor: 1, head: 4 }],
                                    main: 0,
                                },
                            },
                        },
                    } as never),
                ],
            },
        });

        const revision = serialized[0];
        expect(revision?.type).toBe("revision");
        if (!revision || revision.type !== "revision") {
            throw new Error("Expected serialized revision annotation");
        }
        expect(revision.versions[0]?.annotations).toEqual([
            expect.objectContaining({
                id: "0.v0.0",
                type: "revision",
                from: 1,
                to: 4,
                selectedText: "ell",
            }),
        ]);
    });
});
