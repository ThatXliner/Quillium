import { isAnnotationOfType, versionText } from "$lib/editor/plugins/annotations/models";
import { restoreBackup } from "$lib/editor/restore";
import { afterEach, describe, expect, it } from "vitest";
import { EditorHarness } from "../helpers/EditorHarness";

let h: EditorHarness;
afterEach(() => h?.destroy());

describe("restoreBackup", () => {
    it("replaces the document text with the backup", () => {
        h = EditorHarness.create("original text");
        restoreBackup(h.view, "restored text");
        expect(h.doc).toBe("restored text");
    });

    it("re-anchors a comment to its matching text in the restored doc", () => {
        h = EditorHarness.create("hello world");
        const id = h.addComment(0, 5); // anchored on "hello"

        restoreBackup(h.view, "goodbye hello friend");

        const ann = h.annotation(id);
        // "hello" now starts at index 8
        expect(ann.selection.main.from).toBe(8);
        expect(ann.selection.main.to).toBe(13);
    });

    it("re-anchors a revision to its active version text in the restored doc", () => {
        h = EditorHarness.create("hello world");
        const id = h.addRevision(0, 5); // version[0].doc = "hello"

        restoreBackup(h.view, "say hello again");

        const ann = h.annotation(id);
        // "hello" found at index 4
        expect(ann.selection.main.from).toBe(4);
        expect(ann.selection.main.to).toBe(9);
    });

    it("places annotation at position 0 when anchor text is not found", () => {
        h = EditorHarness.create("hello world");
        const id = h.addComment(0, 5); // anchored on "hello"

        restoreBackup(h.view, "completely different text");

        const ann = h.annotation(id);
        expect(ann.selection.main.from).toBe(0);
        expect(ann.selection.main.to).toBe(0);
    });

    it("preserves all annotations after restore (no annotations are lost)", () => {
        h = EditorHarness.create("alpha beta gamma");
        const c1 = h.addComment(0, 5); // "alpha"
        const c2 = h.addComment(6, 10); // "beta"
        const r1 = h.addRevision(11, 16); // "gamma"

        restoreBackup(h.view, "gamma beta alpha");

        expect(h.annotationCount).toBe(3);
        // All three should still exist
        expect(h.annotation(c1)).toBeDefined();
        expect(h.annotation(c2)).toBeDefined();
        expect(h.annotation(r1)).toBeDefined();
    });

    it("correctly re-anchors multiple annotations to distinct positions", () => {
        h = EditorHarness.create("foo bar baz");
        const c1 = h.addComment(0, 3); // "foo"
        const c2 = h.addComment(4, 7); // "bar"

        restoreBackup(h.view, "bar then foo");

        const ann1 = h.annotation(c1);
        const ann2 = h.annotation(c2);
        // "foo" is at index 9, "bar" is at index 0
        expect(ann1.selection.main.from).toBe(9);
        expect(ann1.selection.main.to).toBe(12);
        expect(ann2.selection.main.from).toBe(0);
        expect(ann2.selection.main.to).toBe(3);
    });

    it("handles restoring to an empty document", () => {
        h = EditorHarness.create("hello world");
        const id = h.addComment(0, 5);

        restoreBackup(h.view, "");

        expect(h.doc).toBe("");
        const ann = h.annotation(id);
        expect(ann.selection.main.from).toBe(0);
        expect(ann.selection.main.to).toBe(0);
    });

    it("works when there are no annotations", () => {
        h = EditorHarness.create("original");
        restoreBackup(h.view, "restored");
        expect(h.doc).toBe("restored");
        expect(h.annotationCount).toBe(0);
    });

    it("handles a revision with multiple versions", () => {
        h = EditorHarness.create("hello world");
        const id = h.addRevision(0, 5, [{ doc: "hello" }, { doc: "hi" }], 0);

        // Active version text is "hello", which is used for re-anchoring
        restoreBackup(h.view, "say hello there");

        const ann = h.annotation(id);
        expect(ann.selection.main.from).toBe(4);
        expect(ann.selection.main.to).toBe(9);
    });

    it("preserves suggestion replacements through restore", () => {
        h = EditorHarness.create("hello world");
        const id = h.addSuggestion(0, 5, [{ text: "hi" }, { text: "hey" }]);

        restoreBackup(h.view, "hello again");

        const ann = h.annotation(id);
        expect(isAnnotationOfType(ann, "suggestion")).toBe(true);
        if (isAnnotationOfType(ann, "suggestion")) {
            expect(ann.replacements).toHaveLength(2);
            expect(ann.replacements[0].text).toBe("hi");
        }
        expect(ann.selection.main.from).toBe(0);
        expect(ann.selection.main.to).toBe(5);
    });
});
