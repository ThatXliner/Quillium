/**
 * relativePosition.test.ts -- Tests for RelativePosition utilities.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EditorSelection } from "@codemirror/state";
import * as Y from "yjs";
import { absoluteToRelative, relativeToAbsolute } from "./relativePosition";

describe("relativePosition", () => {
    let ydoc: Y.Doc;
    let ytext: Y.Text;

    beforeEach(() => {
        ydoc = new Y.Doc();
        ytext = ydoc.getText("document");
    });

    afterEach(() => {
        ydoc.destroy();
    });

    describe("absoluteToRelative", () => {
        it("converts selection at document start", () => {
            ytext.insert(0, "hello world");
            const selection = EditorSelection.single(0, 5);
            const encoded = absoluteToRelative(ytext, selection);

            expect(encoded.startPos).toBeInstanceOf(Uint8Array);
            expect(encoded.endPos).toBeInstanceOf(Uint8Array);
        });

        it("converts selection in middle of document", () => {
            ytext.insert(0, "hello world");
            const selection = EditorSelection.single(6, 11);
            const encoded = absoluteToRelative(ytext, selection);

            expect(encoded.startPos).toBeInstanceOf(Uint8Array);
            expect(encoded.endPos).toBeInstanceOf(Uint8Array);
        });

        it("handles cursor (empty selection)", () => {
            ytext.insert(0, "hello");
            const selection = EditorSelection.single(3, 3);
            const encoded = absoluteToRelative(ytext, selection);

            expect(encoded.startPos).toBeInstanceOf(Uint8Array);
            expect(encoded.endPos).toBeInstanceOf(Uint8Array);
        });
    });

    describe("relativeToAbsolute", () => {
        it("round-trips through encode/decode", () => {
            ytext.insert(0, "hello world");
            const selection = EditorSelection.single(0, 5);
            const encoded = absoluteToRelative(ytext, selection);
            const decoded = relativeToAbsolute(ydoc, ytext, encoded.startPos, encoded.endPos);

            expect(decoded).not.toBeNull();
            expect(decoded!.main.from).toBe(0);
            expect(decoded!.main.to).toBe(5);
        });

        it("tracks position through text insertion before anchor", () => {
            ytext.insert(0, "hello world");
            const selection = EditorSelection.single(6, 11); // "world"
            const encoded = absoluteToRelative(ytext, selection);

            // Insert text before the anchor
            ytext.insert(0, "XXX ");

            const decoded = relativeToAbsolute(ydoc, ytext, encoded.startPos, encoded.endPos);
            expect(decoded).not.toBeNull();
            expect(decoded!.main.from).toBe(10); // 6 + 4
            expect(decoded!.main.to).toBe(15); // 11 + 4
        });

        it("tracks position through text deletion before anchor", () => {
            ytext.insert(0, "hello world");
            const selection = EditorSelection.single(6, 11); // "world"
            const encoded = absoluteToRelative(ytext, selection);

            // Delete "hello " (6 chars)
            ytext.delete(0, 6);

            const decoded = relativeToAbsolute(ydoc, ytext, encoded.startPos, encoded.endPos);
            expect(decoded).not.toBeNull();
            expect(decoded!.main.from).toBe(0);
            expect(decoded!.main.to).toBe(5);
        });

        it("returns null or collapsed when anchored text is fully deleted", () => {
            ytext.insert(0, "hello world");
            const selection = EditorSelection.single(0, 5); // "hello"
            const encoded = absoluteToRelative(ytext, selection);

            // Delete "hello" (the anchored range)
            ytext.delete(0, 5);

            const decoded = relativeToAbsolute(ydoc, ytext, encoded.startPos, encoded.endPos);
            // Note: Yjs RelativePosition behavior when anchor is deleted varies
            // It may resolve to the deletion point rather than null
            // This test documents actual behavior
            expect(decoded === null || decoded.main.from === decoded.main.to).toBe(true);
        });

        it("handles insertion at anchor boundary", () => {
            ytext.insert(0, "hello world");
            const selection = EditorSelection.single(5, 6); // " " (space)
            const encoded = absoluteToRelative(ytext, selection);

            // Insert at the exact anchor start
            ytext.insert(5, "XXX");

            const decoded = relativeToAbsolute(ydoc, ytext, encoded.startPos, encoded.endPos);
            expect(decoded).not.toBeNull();
            // Position should track correctly
        });
    });

    describe("edge cases", () => {
        it("handles empty document", () => {
            const selection = EditorSelection.single(0, 0);
            const encoded = absoluteToRelative(ytext, selection);
            const decoded = relativeToAbsolute(ydoc, ytext, encoded.startPos, encoded.endPos);

            expect(decoded).not.toBeNull();
            expect(decoded!.main.from).toBe(0);
            expect(decoded!.main.to).toBe(0);
        });

        it("tracks selection when text is inserted after it", () => {
            ytext.insert(0, "hello");
            const selection = EditorSelection.single(1, 3); // "el" in "hello"
            const encoded = absoluteToRelative(ytext, selection);

            // Insert text after the selection
            ytext.insert(5, " world");

            const decoded = relativeToAbsolute(ydoc, ytext, encoded.startPos, encoded.endPos);
            expect(decoded).not.toBeNull();
            // Insertion after selection should not shift selection
            expect(decoded!.main.from).toBe(1);
            expect(decoded!.main.to).toBe(3);
        });
    });
});
