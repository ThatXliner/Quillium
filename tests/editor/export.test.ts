import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { EditorHarness } from "../helpers/EditorHarness";
import { exportDocument } from "$lib/export";
import { currentDocumentTitle } from "$lib/stores";
import { save } from "@tauri-apps/plugin-dialog";

let h: EditorHarness;
let savedContent: string;
let savedPath: string;
let printedHtml: string;
let printCalled: number;
let closeCalled: number;

// Mock Tauri dialog and fs plugins
vi.mock("@tauri-apps/plugin-dialog", () => ({
    save: vi.fn().mockImplementation(async (opts: { defaultPath: string }) => {
        savedPath = opts.defaultPath;
        return `/fake/path/${opts.defaultPath}`;
    }),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
    writeTextFile: vi.fn().mockImplementation(async (_path: string, content: string) => {
        savedContent = content;
    }),
}));

beforeEach(() => {
    vi.useFakeTimers();
    savedContent = "";
    savedPath = "";
    printedHtml = "";
    printCalled = 0;
    closeCalled = 0;
    currentDocumentTitle.set("Test Document");

    vi.stubGlobal(
        "open",
        vi.fn(() => ({
            document: {
                open: vi.fn(),
                write: vi.fn((html: string) => {
                    printedHtml = html;
                }),
                close: vi.fn(),
            },
            focus: vi.fn(),
            print: vi.fn(() => {
                printCalled += 1;
            }),
            close: vi.fn(() => {
                closeCalled += 1;
            }),
        })),
    );
});

afterEach(() => {
    h?.destroy();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    currentDocumentTitle.set("");
});

describe("exportDocument", () => {
    describe("plain text export", () => {
        it("exports document text as .txt", async () => {
            h = EditorHarness.create("Hello world");
            await exportDocument(h.view, "txt");

            expect(savedPath).toBe("Test Document.txt");
            expect(savedContent).toBe("Hello world");
        });
    });

    describe("JSON export", () => {
        it("exports document with no annotations", async () => {
            h = EditorHarness.create("Hello world");
            await exportDocument(h.view, "json");

            expect(savedPath).toBe("Test Document.json");
            const parsed = JSON.parse(savedContent);
            expect(parsed.title).toBe("Test Document");
            expect(parsed.text).toBe("Hello world");
            expect(parsed.annotations).toEqual([]);
            expect(parsed.exportedAt).toBeDefined();
        });

        it("exports comments with thread data", async () => {
            h = EditorHarness.create("Hello world");
            const id = h.addComment(0, 5);
            h.addThreadMessage(id, "Nice greeting!");

            await exportDocument(h.view, "json");

            const parsed = JSON.parse(savedContent);
            expect(parsed.annotations).toHaveLength(1);
            expect(parsed.annotations[0].type).toBe("comment");
            expect(parsed.annotations[0].selectedText).toBe("Hello");
            expect(parsed.annotations[0].thread).toHaveLength(1);
            expect(parsed.annotations[0].thread[0].message).toBe("Nice greeting!");
        });

        it("exports suggestions with replacements", async () => {
            h = EditorHarness.create("Hello world");
            h.addSuggestion(0, 5, [{ text: "Hi" }, { text: "Hey" }]);

            await exportDocument(h.view, "json");

            const parsed = JSON.parse(savedContent);
            expect(parsed.annotations).toHaveLength(1);
            expect(parsed.annotations[0].type).toBe("suggestion");
            expect(parsed.annotations[0].replacements).toEqual([{ text: "Hi" }, { text: "Hey" }]);
        });

        it("exports revisions with version data", async () => {
            h = EditorHarness.create("Hello world");
            h.addRevision(0, 5, [{ doc: "Hello" }, { doc: "Hi" }], 0);

            await exportDocument(h.view, "json");

            const parsed = JSON.parse(savedContent);
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
            await exportDocument(h.view, "md");

            expect(savedPath).toBe("Test Document.md");
            expect(savedContent).toBe("Hello world");
        });

        it("adds footnotes for comments", async () => {
            h = EditorHarness.create("Hello world");
            const id = h.addComment(0, 5);
            h.addThreadMessage(id, "Great word", "Alice");

            await exportDocument(h.view, "md");

            expect(savedContent).toContain("[^1]");
            expect(savedContent).toContain("**Comment**");
            expect(savedContent).toContain("Alice: Great word");
        });

        it("adds footnotes for suggestions", async () => {
            h = EditorHarness.create("Hello world");
            h.addSuggestion(0, 5, [{ text: "Hi" }]);

            await exportDocument(h.view, "md");

            expect(savedContent).toContain("[^1]");
            expect(savedContent).toContain("**Suggestion**");
            expect(savedContent).toContain('"Hi"');
        });

        it("adds footnotes for revisions", async () => {
            h = EditorHarness.create("Hello world");
            h.addRevision(0, 5, [{ doc: "Hello" }, { doc: "Hi" }], 0);

            await exportDocument(h.view, "md");

            expect(savedContent).toContain("[^1]");
            expect(savedContent).toContain("**Revision**");
            expect(savedContent).toContain("[active]");
        });

        it("includes separator before footnotes", async () => {
            h = EditorHarness.create("Hello world");
            h.addComment(0, 5);

            await exportDocument(h.view, "md");

            expect(savedContent).toContain("\n\n---\n\n");
        });
    });

    describe("text with annotations export", () => {
        it("exports plain text when no annotations exist", async () => {
            h = EditorHarness.create("Hello world");
            await exportDocument(h.view, "txt+json");

            expect(savedPath).toBe("Test Document.txt");
            expect(savedContent).toBe("Hello world");
        });

        it("appends annotations as JSON after separator", async () => {
            h = EditorHarness.create("Hello world");
            const id = h.addComment(0, 5);
            h.addThreadMessage(id, "Nice greeting!");

            await exportDocument(h.view, "txt+json");

            expect(savedContent).toContain("Hello world");
            expect(savedContent).toContain("\n\n---\n\n");
            const [textPart, jsonPart] = savedContent.split("\n\n---\n\n");
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

            await exportDocument(h.view, "txt+json");

            const [, jsonPart] = savedContent.split("\n\n---\n\n");
            const parsed = JSON.parse(jsonPart);
            expect(parsed[0].type).toBe("revision");
            expect(parsed[0].versions).toHaveLength(2);
        });
    });

    describe("PDF export", () => {
        it("opens the print flow instead of saving raw text", async () => {
            h = EditorHarness.create("Hello world");
            vi.mocked(save).mockClear();
            const exportPromise = exportDocument(h.view, "pdf");
            await vi.runAllTimersAsync();
            await exportPromise;

            expect(printCalled).toBe(1);
            expect(closeCalled).toBe(1);
            expect(printedHtml).toContain("<!DOCTYPE html>");
            expect(printedHtml).toContain("<h1>Test Document</h1>");
            expect(printedHtml).toContain("<p>Hello world</p>");
            expect(savedContent).toBe("");
            expect(vi.mocked(save)).not.toHaveBeenCalled();
        });

        it("includes annotations in the rendered PDF document", async () => {
            h = EditorHarness.create("Hello world");
            const id = h.addComment(0, 5);
            h.addThreadMessage(id, "Nice greeting!", "Alice");

            vi.mocked(save).mockClear();
            const exportPromise = exportDocument(h.view, "pdf");
            await vi.runAllTimersAsync();
            await exportPromise;

            expect(printedHtml).toContain("Annotations");
            expect(printedHtml).toContain("1. Comment (0-5)");
            expect(printedHtml).toContain("On: &quot;Hello&quot;");
            expect(printedHtml).toContain("Alice: Nice greeting!");
        });
    });

    describe("filename sanitization", () => {
        it("sanitizes special characters in filename", async () => {
            currentDocumentTitle.set('My/Doc: "Draft"');
            h = EditorHarness.create("test");
            await exportDocument(h.view, "txt");

            // Forward slashes, colons, quotes should be replaced with dashes
            expect(savedPath).not.toContain("/");
            expect(savedPath).not.toContain(":");
            expect(savedPath).not.toContain('"');
            expect(savedPath).toMatch(/\.txt$/);
        });

        it("falls back to 'document' for empty title", async () => {
            currentDocumentTitle.set("");
            h = EditorHarness.create("test");
            await exportDocument(h.view, "txt");

            expect(savedPath).toBe("document.txt");
        });
    });
});
