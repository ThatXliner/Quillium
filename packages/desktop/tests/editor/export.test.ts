import type { DraftMeta, LoadResult } from "$lib/db/types";
import type { VersionState } from "$lib/editor/plugins/annotations/models";
import { exportDocument, exportDocumentById } from "$lib/export";
import { currentDocumentTitle } from "$lib/stores";
import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorHarness } from "../helpers/EditorHarness";

let h: EditorHarness;
let savedContent: string;
let savedPath: string;
let invokedTextPath: string;
let invokedPdfPath: string;
let invokedPdfPayload: unknown;
let mockedDrafts: DraftMeta[];
let mockedLoadResult: LoadResult;

vi.mock("$lib/db", () => ({
    listDrafts: vi.fn(async () => mockedDrafts),
    resolveActiveDraftId: vi.fn(
        async () => (mockedDrafts.find((d) => d.isActive) ?? mockedDrafts[0])?.id ?? null,
    ),
    loadDocumentState: vi.fn(async () => mockedLoadResult),
}));

vi.mock("$lib/editor/replay", () => ({
    replayEvents: vi.fn((state) => state),
}));

vi.mock("$lib/appLog", () => ({
    logAppEvent: vi.fn(async () => {}),
}));

vi.mock("@tauri-apps/api/core", () => ({
    invoke: vi.fn().mockImplementation(
        async (
            command: string,
            args?: {
                defaultName?: string;
                content?: string;
                payload?: unknown;
            },
        ) => {
            if (command === "cmd_export_text_with_dialog") {
                savedPath = args?.defaultName ?? "";
                invokedTextPath = `/fake/path/${savedPath}`;
                savedContent = args?.content ?? "";
                return true;
            }
            if (command === "cmd_export_pdf_with_dialog") {
                savedPath = args?.defaultName ?? "";
                invokedPdfPath = `/fake/path/${savedPath}`;
                invokedPdfPayload = args?.payload;
                return true;
            }
        },
    ),
}));

beforeEach(() => {
    savedContent = "";
    savedPath = "";
    invokedTextPath = "";
    invokedPdfPath = "";
    invokedPdfPayload = null;
    mockedDrafts = [
        {
            id: "draft-1",
            documentId: "doc-1",
            label: "Draft 1",
            createdAt: 0,
            isActive: true,
            tabId: "tab-1",
            parentDraftId: null,
            branchedFrom: null,
            locked: false,
        },
    ];
    mockedLoadResult = {
        snapshotStateJson: null,
        snapshotEventId: 0,
        eventsSince: [],
    };
    currentDocumentTitle.set("Test Document");
});

afterEach(() => {
    h?.destroy();
    vi.restoreAllMocks();
    currentDocumentTitle.set("");
});

describe("exportDocument", () => {
    describe("plain text export", () => {
        it("exports document text as .txt", async () => {
            h = EditorHarness.create("Hello world");
            await exportDocument(h.view, "txt");

            expect(savedPath).toBe("Test Document.txt");
            expect(invokedTextPath).toBe("/fake/path/Test Document.txt");
            expect(savedContent).toBe("Hello world");
            expect(vi.mocked(invoke)).toHaveBeenCalledWith("cmd_export_text_with_dialog", {
                defaultName: "Test Document.txt",
                extension: "txt",
                filterName: "Text",
                content: "Hello world",
            });
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
        it("writes a plain PDF without annotations through the Rust command", async () => {
            h = EditorHarness.create("Hello world");
            await exportDocument(h.view, "pdf");

            expect(savedPath).toBe("Test Document.pdf");
            expect(invokedPdfPath).toBe("/fake/path/Test Document.pdf");
            expect(savedContent).toBe("");
            expect(vi.mocked(invoke)).toHaveBeenCalledWith("cmd_export_pdf_with_dialog", {
                defaultName: "Test Document.pdf",
                payload: {
                    title: "Test Document",
                    bodyParagraphs: ["Hello world"],
                    annotations: [],
                },
            });
        });

        it("keeps plain PDF free of annotations even when they exist", async () => {
            h = EditorHarness.create("Hello world");
            const id = h.addComment(0, 5);
            h.addThreadMessage(id, "Nice greeting!", "Alice");

            await exportDocument(h.view, "pdf");

            expect(invokedPdfPayload).toEqual({
                title: "Test Document",
                bodyParagraphs: ["Hello world"],
                annotations: [],
            });
        });

        it("includes annotations in the annotated PDF payload", async () => {
            h = EditorHarness.create("Hello world");
            const id = h.addComment(0, 5);
            h.addThreadMessage(id, "Nice greeting!", "Alice");

            await exportDocument(h.view, "pdf+annotations");

            expect(invokedPdfPayload).toEqual({
                title: "Test Document",
                bodyParagraphs: ["Hello world"],
                annotations: [
                    {
                        kind: "comment",
                        title: "1. Comment (0-5)",
                        subtitle: 'On: "Hello"',
                        body: ["Alice: Nice greeting!"],
                        children: [],
                    },
                ],
            });
        });

        it("includes revision threads and nested annotations in the annotated PDF payload", async () => {
            h = EditorHarness.create("Hello world");
            const revisionId = h.addRevision(
                0,
                5,
                [
                    {
                        id: "v0",
                        doc: "Hello",
                        annotationField: {
                            "0": {
                                _type: "comment",
                                id: 0,
                                thread: [{ message: "Nested note", author: "Bob", time: 1 }],
                                selection: {
                                    ranges: [{ anchor: 0, head: 5 }],
                                    main: 0,
                                },
                            },
                        },
                    } as VersionState,
                ],
                0,
            );
            h.addThreadMessage(revisionId, "Top-level revision thread", "Alice");

            await exportDocument(h.view, "pdf+annotations");

            expect(invokedPdfPayload).toEqual({
                title: "Test Document",
                bodyParagraphs: ["Hello world"],
                annotations: [
                    {
                        kind: "revision",
                        title: "1. Revision (0-5)",
                        subtitle: 'On: "Hello"',
                        body: ["Alice: Top-level revision thread"],
                        children: [
                            {
                                kind: "version",
                                title: "Version 1 [active]",
                                body: ["Hello"],
                                children: [
                                    {
                                        kind: "comment",
                                        title: "1. Comment (0-5)",
                                        subtitle: 'On: "Hello"',
                                        body: ["Bob: Nested note"],
                                        children: [],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            });
        });

        it("exports library PDFs through the Rust command with the unsanitized title", async () => {
            await exportDocumentById("doc-1", 'My/Doc: "Draft"', "pdf");

            expect(savedPath).toBe("My-Doc- -Draft-.pdf");
            expect(invokedPdfPath).toBe("/fake/path/My-Doc- -Draft-.pdf");
            expect(invokedPdfPayload).toEqual({
                title: 'My/Doc: "Draft"',
                bodyParagraphs: [],
                annotations: [],
            });
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

        it("preserves the original title inside exported JSON", async () => {
            currentDocumentTitle.set('My/Doc: "Draft"');
            h = EditorHarness.create("test");
            await exportDocument(h.view, "json");

            const parsed = JSON.parse(savedContent);
            expect(parsed.title).toBe('My/Doc: "Draft"');
        });

        it("falls back to 'document' for empty title", async () => {
            currentDocumentTitle.set("");
            h = EditorHarness.create("test");
            await exportDocument(h.view, "txt");

            expect(savedPath).toBe("document.txt");
        });
    });
});
