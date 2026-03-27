import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { EditorHarness } from "../helpers/EditorHarness";
import { exportDocument } from "$lib/export";
import { currentDocumentTitle } from "$lib/stores";

let h: EditorHarness;
let downloadedContent: string;
let downloadedFilename: string;
let downloadedMime: string;

beforeEach(() => {
    downloadedContent = "";
    downloadedFilename = "";
    downloadedMime = "";

    // Mock the Blob + download mechanism
    const fakeUrl = "blob:fake";
    vi.stubGlobal("URL", {
        createObjectURL: (blob: Blob) => {
            // Read blob content synchronously via the Blob constructor args
            // (Vitest's jsdom supports Blob.text() but it's async — we capture
            // the source data instead)
            blob.text().then((t) => (downloadedContent = t));
            downloadedMime = blob.type;
            return fakeUrl;
        },
        revokeObjectURL: vi.fn(),
    });

    const fakeAnchor = { href: "", download: "", click: vi.fn() };
    const origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
        if (tag === "a") {
            return fakeAnchor as unknown as HTMLElement;
        }
        return origCreateElement(tag);
    });

    // Capture the download filename from the fake anchor
    Object.defineProperty(fakeAnchor, "download", {
        set(val: string) {
            downloadedFilename = val;
        },
        get() {
            return downloadedFilename;
        },
    });

    currentDocumentTitle.set("Test Document");
});

afterEach(() => {
    h?.destroy();
    vi.restoreAllMocks();
    currentDocumentTitle.set("");
});

// Helper to flush the Blob.text() promise
async function flush() {
    await new Promise((r) => setTimeout(r, 0));
}

describe("exportDocument", () => {
    describe("plain text export", () => {
        it("exports document text as .txt", async () => {
            h = EditorHarness.create("Hello world");
            exportDocument(h.view, "txt");
            await flush();

            expect(downloadedFilename).toBe("Test Document.txt");
            expect(downloadedContent).toBe("Hello world");
            expect(downloadedMime).toBe("text/plain");
        });
    });

    describe("JSON export", () => {
        it("exports document with no annotations", async () => {
            h = EditorHarness.create("Hello world");
            exportDocument(h.view, "json");
            await flush();

            expect(downloadedFilename).toBe("Test Document.json");
            const parsed = JSON.parse(downloadedContent);
            expect(parsed.title).toBe("Test Document");
            expect(parsed.text).toBe("Hello world");
            expect(parsed.annotations).toEqual([]);
            expect(parsed.exportedAt).toBeDefined();
        });

        it("exports comments with thread data", async () => {
            h = EditorHarness.create("Hello world");
            const id = h.addComment(0, 5);
            h.addThreadMessage(id, "Nice greeting!");

            exportDocument(h.view, "json");
            await flush();

            const parsed = JSON.parse(downloadedContent);
            expect(parsed.annotations).toHaveLength(1);
            expect(parsed.annotations[0].type).toBe("comment");
            expect(parsed.annotations[0].selectedText).toBe("Hello");
            expect(parsed.annotations[0].thread).toHaveLength(1);
            expect(parsed.annotations[0].thread[0].message).toBe("Nice greeting!");
        });

        it("exports suggestions with replacements", async () => {
            h = EditorHarness.create("Hello world");
            h.addSuggestion(0, 5, [{ text: "Hi" }, { text: "Hey" }]);

            exportDocument(h.view, "json");
            await flush();

            const parsed = JSON.parse(downloadedContent);
            expect(parsed.annotations).toHaveLength(1);
            expect(parsed.annotations[0].type).toBe("suggestion");
            expect(parsed.annotations[0].replacements).toEqual([{ text: "Hi" }, { text: "Hey" }]);
        });

        it("exports revisions with version data", async () => {
            h = EditorHarness.create("Hello world");
            h.addRevision(0, 5, [{ doc: "Hello" }, { doc: "Hi" }], 0);

            exportDocument(h.view, "json");
            await flush();

            const parsed = JSON.parse(downloadedContent);
            expect(parsed.annotations).toHaveLength(1);
            const rev = parsed.annotations[0];
            expect(rev.type).toBe("revision");
            expect(rev.activeVersionIndex).toBe(0);
            expect(rev.versions).toHaveLength(2);
            expect(rev.versions[0].text).toBe("Hello");
            expect(rev.versions[1].text).toBe("Hi");
        });
    });

    describe("Markdown export", () => {
        it("exports plain text when no annotations exist", async () => {
            h = EditorHarness.create("Hello world");
            exportDocument(h.view, "md");
            await flush();

            expect(downloadedFilename).toBe("Test Document.md");
            expect(downloadedContent).toBe("Hello world");
        });

        it("adds footnotes for comments", async () => {
            h = EditorHarness.create("Hello world");
            const id = h.addComment(0, 5);
            h.addThreadMessage(id, "Great word", "Alice");

            exportDocument(h.view, "md");
            await flush();

            expect(downloadedContent).toContain("[^1]");
            expect(downloadedContent).toContain("**Comment**");
            expect(downloadedContent).toContain("Alice: Great word");
        });

        it("adds footnotes for suggestions", async () => {
            h = EditorHarness.create("Hello world");
            h.addSuggestion(0, 5, [{ text: "Hi" }]);

            exportDocument(h.view, "md");
            await flush();

            expect(downloadedContent).toContain("[^1]");
            expect(downloadedContent).toContain("**Suggestion**");
            expect(downloadedContent).toContain('"Hi"');
        });

        it("adds footnotes for revisions", async () => {
            h = EditorHarness.create("Hello world");
            h.addRevision(0, 5, [{ doc: "Hello" }, { doc: "Hi" }], 0);

            exportDocument(h.view, "md");
            await flush();

            expect(downloadedContent).toContain("[^1]");
            expect(downloadedContent).toContain("**Revision**");
            expect(downloadedContent).toContain("[active]");
        });

        it("includes separator before footnotes", async () => {
            h = EditorHarness.create("Hello world");
            h.addComment(0, 5);

            exportDocument(h.view, "md");
            await flush();

            expect(downloadedContent).toContain("\n\n---\n\n");
        });
    });

    describe("text with annotations export", () => {
        it("exports plain text when no annotations exist", async () => {
            h = EditorHarness.create("Hello world");
            exportDocument(h.view, "txt+json");
            await flush();

            expect(downloadedFilename).toBe("Test Document.txt");
            expect(downloadedContent).toBe("Hello world");
            expect(downloadedMime).toBe("text/plain");
        });

        it("appends annotations as JSON after separator", async () => {
            h = EditorHarness.create("Hello world");
            const id = h.addComment(0, 5);
            h.addThreadMessage(id, "Nice greeting!");

            exportDocument(h.view, "txt+json");
            await flush();

            expect(downloadedContent).toContain("Hello world");
            expect(downloadedContent).toContain("\n\n---\n\n");
            const [textPart, jsonPart] = downloadedContent.split("\n\n---\n\n");
            expect(textPart).toBe("Hello world");
            const parsed = JSON.parse(jsonPart);
            expect(parsed).toHaveLength(1);
            expect(parsed[0].type).toBe("comment");
            expect(parsed[0].selectedText).toBe("Hello");
            expect(parsed[0].thread).toHaveLength(1);
        });

        it("includes revision data in appended JSON", async () => {
            h = EditorHarness.create("Hello world");
            h.addRevision(0, 5, [{ doc: "Hello" }, { doc: "Hi" }], 0);

            exportDocument(h.view, "txt+json");
            await flush();

            const [, jsonPart] = downloadedContent.split("\n\n---\n\n");
            const parsed = JSON.parse(jsonPart);
            expect(parsed[0].type).toBe("revision");
            expect(parsed[0].versions).toHaveLength(2);
        });
    });

    describe("filename sanitization", () => {
        it("sanitizes special characters in filename", async () => {
            currentDocumentTitle.set('My/Doc: "Draft"');
            h = EditorHarness.create("test");
            exportDocument(h.view, "txt");
            await flush();

            // Forward slashes, colons, quotes should be replaced with dashes
            expect(downloadedFilename).not.toContain("/");
            expect(downloadedFilename).not.toContain(":");
            expect(downloadedFilename).not.toContain('"');
            expect(downloadedFilename).toMatch(/\.txt$/);
        });

        it("falls back to 'document' for empty title", async () => {
            currentDocumentTitle.set("");
            h = EditorHarness.create("test");
            exportDocument(h.view, "txt");
            await flush();

            expect(downloadedFilename).toBe("document.txt");
        });
    });
});
