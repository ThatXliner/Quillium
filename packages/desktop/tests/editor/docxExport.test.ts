import { buildDocxProjection, renderDocx } from "$lib/docxExport";
import type { VersionState } from "$lib/editor/plugins/annotations/models";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";
import { EditorHarness } from "../helpers/EditorHarness";

let harness: EditorHarness;
afterEach(() => harness?.destroy());

async function part(bytes: Uint8Array, name: string): Promise<string> {
    const zip = await JSZip.loadAsync(bytes);
    const file = zip.file(name);
    expect(file, `${name} should exist`).not.toBeNull();
    return (await file?.async("string")) ?? "";
}

describe("Word export", () => {
    it("writes selected revision prose and only the selected version's nested comments", async () => {
        harness = EditorHarness.create("Before Hello world");
        const revisionId = harness.addRevision(7, 12, [
            {
                id: "selected",
                doc: "Hello",
                annotationField: {
                    0: {
                        _type: "comment",
                        status: "active",
                        id: 0,
                        thread: [{ author: "Bob", message: "Keep this", time: 1000 }],
                        selection: { ranges: [{ anchor: 0, head: 5 }], main: 0 },
                    },
                },
            } as VersionState,
            {
                id: "inactive",
                doc: "Howdy",
                annotationField: {
                    0: {
                        _type: "comment",
                        status: "active",
                        id: 0,
                        thread: [{ author: "Eve", message: "Hidden note", time: 1000 }],
                        selection: { ranges: [{ anchor: 0, head: 5 }], main: 0 },
                    },
                },
            } as VersionState,
        ]);
        harness.addThreadMessage(revisionId, "Revision discussion", "Alice");

        const projection = buildDocxProjection(harness.view.state, true);
        expect(projection.text).toBe("Before Hello world");
        expect(projection.comments.map((comment) => [comment.from, comment.to])).toEqual([
            [7, 12],
            [7, 12],
        ]);

        const bytes = await renderDocx(projection, "Test");
        const body = await part(bytes, "word/document.xml");
        const comments = await part(bytes, "word/comments.xml");
        expect(body).toContain("Hello");
        expect(body).not.toContain("Howdy");
        expect(comments).toContain("Revision discussion");
        expect(comments).toContain("Keep this");
        expect(comments).not.toContain("Hidden note");
    });

    it("anchors overlapping and cross-paragraph comments and keeps replies", async () => {
        harness = EditorHarness.create("Alpha beta\ngamma delta");
        const first = harness.addComment(0, 10);
        harness.addThreadMessage(first, "First", "Alice");
        harness.addThreadMessage(first, "Reply", "Bob");
        const second = harness.addComment(6, 16);
        harness.addThreadMessage(second, "Overlap", "Carol");

        const projection = buildDocxProjection(harness.view.state, true);
        const bytes = await renderDocx(projection, "Test");
        const body = await part(bytes, "word/document.xml");
        const comments = await part(bytes, "word/comments.xml");
        const extended = await part(bytes, "word/commentsExtended.xml");
        expect((body.match(/w:commentRangeStart/g) ?? []).length).toBe(2);
        expect((body.match(/w:commentRangeEnd/g) ?? []).length).toBe(2);
        expect(body).toMatch(/<w:r><w:commentReference w:id="0"\/><\/w:r>/);
        expect(comments).toContain("Reply");
        expect(comments).toContain('w:author="Bob"');
        expect(extended).toContain("paraIdParent");
    });

    it("keeps line breaks in comment messages and suggestion alternatives", async () => {
        harness = EditorHarness.create("Alpha beta");
        harness.addSuggestion(0, 5, [{ text: "First" }, { text: "Second" }]);
        const commentId = harness.addComment(6, 10);
        harness.addThreadMessage(commentId, "Line one\nLine two", "Alice");
        const bytes = await renderDocx(buildDocxProjection(harness.view.state, true), "Test");
        const comments = await part(bytes, "word/comments.xml");
        expect(comments).toMatch(/First<\/w:t>.*<w:p>.*Second/s);
        expect(comments).toMatch(/Line one<\/w:t>.*<w:p>.*Line two/s);
    });

    it("exports the selected revision after a version switch", async () => {
        harness = EditorHarness.create("Hello world");
        const id = harness.addRevision(0, 5, [{ doc: "Hello" }, { doc: "Hi" }]);
        harness.switchVersion(id, 1);
        const projection = buildDocxProjection(harness.view.state, true);
        expect(projection.text).toBe("Hi world");
        const body = await part(await renderDocx(projection, "Test"), "word/document.xml");
        expect(body).toContain("Hi");
        expect(body).not.toContain("Hello");
    });

    it("keeps a zero-width comment anchored", async () => {
        const bytes = await renderDocx(
            {
                text: "Hello",
                comments: [
                    {
                        id: 0,
                        from: 3,
                        to: 3,
                        messages: [{ author: "Alice", message: "Insertion point", time: 1000 }],
                    },
                ],
            },
            "Test",
        );
        const body = await part(bytes, "word/document.xml");
        expect(body).toContain("commentRangeStart");
        expect(body).toContain("commentRangeEnd");
        expect(body).toContain("commentReference");
    });

    it("omits all annotation markup for body-only export", async () => {
        harness = EditorHarness.create("A\nB");
        const id = harness.addComment(0, 1);
        harness.addThreadMessage(id, "Note");
        const projection = buildDocxProjection(harness.view.state, false);
        expect(projection.comments).toEqual([]);
        const bytes = await renderDocx(projection, "Test");
        const body = await part(bytes, "word/document.xml");
        expect(body).not.toContain("commentRangeStart");
        expect(body).toContain("A");
        expect(body).toContain("B");
    });
});
