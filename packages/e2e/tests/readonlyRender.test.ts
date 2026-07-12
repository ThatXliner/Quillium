/**
 * readonlyRender.test.ts — Mounts the landing `ReadonlyDocument` component with
 * a real wire payload and asserts it renders the shared document through the
 * actual read-only CodeMirror editor (not the legacy flat renderer).
 *
 * This is the DOM-level counterpart to shareRoundTrip.test.ts: it proves the
 * wire payload survives all the way to rendered content + annotation cards.
 */
import {
    ContextViewport,
    ReadonlyAnnotationCard,
    ReadonlyAnnotationModal,
    ReadonlyDocument,
    ReadonlyShareView,
    RevisionContextPanel,
} from "@quillium/share";
import { fireEvent, render, waitFor, within } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import { buildFixtureState, buildNestedLinkedFixtureState, serializeFixtureWire } from "./fixtures";

describe("ReadonlyDocument renders through the real editor", () => {
    it("mounts the CodeMirror view with the active-version document text", async () => {
        const { state } = buildFixtureState();
        const wire = serializeFixtureWire(state);

        const { container } = render(ReadonlyDocument, {
            props: { serializedState: wire },
        });

        await waitFor(() => {
            const content = container.querySelector(".cm-content");
            expect(content).not.toBeNull();
            // v0 of each revision is active: "quick" / "fox".
            expect(content?.textContent).toContain("quick");
            expect(content?.textContent).toContain("fox");
        });

        expect(container.querySelector(".mount-error")).toBeNull();
    });

    it("renders a sidebar card for every annotation", async () => {
        const { state } = buildFixtureState();
        const wire = serializeFixtureWire(state);

        const { container } = render(ReadonlyDocument, {
            props: { serializedState: wire },
        });

        await waitFor(() => {
            // The empty-state paragraph is only shown when there are no
            // annotations; our fixture has four (comment + suggestion + two revisions).
            expect(container.querySelector(".annotation-empty-state")).toBeNull();
            expect(container.querySelectorAll("[data-annotation-card-view]")).toHaveLength(4);
        });

        // These hooks are owned by the shared card views consumed by desktop,
        // history, and Web Preview. Their presence guards against Web Preview
        // quietly growing another look-alike card implementation.
        expect(container.querySelectorAll('[data-annotation-card-view="comment"]')).toHaveLength(1);
        expect(container.querySelectorAll('[data-annotation-card-view="revision"]')).toHaveLength(
            2,
        );
        expect(container.querySelectorAll('[data-annotation-card-view="suggestion"]')).toHaveLength(
            1,
        );
    });

    it("switches a revision through the UI and cascades its linked partner", async () => {
        const { state } = buildFixtureState();
        const { container, getByTitle } = render(ReadonlyDocument, {
            props: { serializedState: serializeFixtureWire(state) },
        });

        await waitFor(() => expect(container.querySelector(".cm-content")).not.toBeNull());
        await fireEvent.click(getByTitle("swift"));

        await waitFor(() => {
            expect(container.querySelector(".cm-content")?.textContent).toContain(
                "The swift brown hound",
            );
        });
    });

    it("shows linked groups without exposing editing controls", async () => {
        const { state } = buildFixtureState();
        const { container, queryByRole } = render(ReadonlyDocument, {
            props: { serializedState: serializeFixtureWire(state) },
        });

        await waitFor(() => {
            expect(container.querySelectorAll("[data-version-group-id]")).toHaveLength(2);
        });

        const sharedCards = container.querySelectorAll<HTMLElement>("[data-annotation-card-view]");
        expect(sharedCards).toHaveLength(4);
        expect(
            Array.from(sharedCards).filter((card) => card.dataset.active === "true"),
        ).toHaveLength(1);

        const linkedPills = Array.from(
            container.querySelectorAll<HTMLElement>("[data-version-group-id]"),
        );
        expect(linkedPills.map((pill) => pill.title)).toEqual([
            'Linked — group "Formal voice" (2 versions)',
            'Linked — group "Formal voice" (2 versions)',
        ]);
        expect(linkedPills[0].querySelector("span")?.style.backgroundColor).toBe(
            linkedPills[1].querySelector("span")?.style.backgroundColor,
        );

        for (const name of [
            "Link version",
            "Delete entire revision",
            "New Version",
            "Branch instead",
            "Apply",
        ]) {
            expect(queryByRole("button", { name })).toBeNull();
        }
        expect(container.querySelector("textarea, input")).toBeNull();
    });

    it("shows a safe error state for malformed serialized editor state", async () => {
        const { container } = render(ReadonlyDocument, {
            props: { serializedState: { doc: 42, annotationField: "broken" } },
        });

        await waitFor(() => {
            expect(container.querySelector(".mount-error")?.textContent).toContain(
                "couldn't be rendered",
            );
        });
    });
});

describe("ReadonlyShareView integration paths", () => {
    it("renders the complete share shell around serialized editor state", async () => {
        const { state } = buildFixtureState();
        const onView = vi.fn();
        const onInstallClick = vi.fn();
        const { container, getByRole, getByText } = render(ReadonlyShareView, {
            props: {
                share: {
                    token: crypto.randomUUID(),
                    title: "E2E fixture",
                    excerpt: "The quick brown fox",
                    content: state.doc.toString(),
                    annotations: [],
                    state: serializeFixtureWire(state),
                    authorName: "Ada Writer",
                    publishedAt: "2026-07-09T12:00:00.000Z",
                    canonicalUrl: "https://example.test/share/example",
                },
                downloadUrl: "/download",
                onView,
                onInstallClick,
            },
        });

        expect(getByText("Read-only")).toBeTruthy();
        expect(getByText("E2E fixture")).toBeTruthy();
        expect(getByText(/Ada Writer/)).toBeTruthy();
        await waitFor(() => expect(container.querySelector(".cm-content")).not.toBeNull());
        expect(onView).toHaveBeenCalledOnce();

        const installLink = getByRole("link", { name: "Edit in Quillium" });
        installLink.addEventListener("click", (event) => event.preventDefault());
        await fireEvent.click(installLink);
        expect(onInstallClick).toHaveBeenCalledWith("toolbar");
    });

    it("keeps the legacy flat renderer usable for pre-migration shares", async () => {
        const { container, getByRole, getByText } = render(ReadonlyShareView, {
            props: {
                share: {
                    token: crypto.randomUUID(),
                    title: "Legacy fixture",
                    excerpt: "Hello world",
                    content: "Hello world",
                    state: null,
                    annotations: [
                        {
                            id: "suggestion-1",
                            type: "suggestion",
                            from: 6,
                            to: 11,
                            selectedText: "world",
                            thread: [
                                {
                                    author: "AI",
                                    message: "Try a warmer word.",
                                    time: 1,
                                },
                            ],
                            replacements: [{ text: "friend", rationale: "Warmer tone" }],
                            author: "AI",
                        },
                    ],
                    authorName: null,
                    publishedAt: null,
                    canonicalUrl: "https://example.test/share/legacy",
                },
            },
        });

        expect(container.querySelector('[data-readonly-renderer="legacy-static"]')).not.toBeNull();
        expect(container.querySelector(".cm-content")).toBeNull();
        expect(getByText("AI Suggestion")).toBeTruthy();
        expect(getByText("friend")).toBeTruthy();

        await fireEvent.click(getByRole("button", { name: "Expand suggestion diff" }));
        await waitFor(() => expect(container.querySelector(".readonly-modal")).not.toBeNull());
    });
});

describe("shared read-only thread adapters", () => {
    const callbacks = {
        selectedRevisionVersionIndex: null,
        onSelect: vi.fn(),
        onSelectRevisionVersion: vi.fn(),
    };

    it("collapses comment replies and expands the complete shared thread", () => {
        const annotation = {
            id: "comment-thread",
            type: "comment" as const,
            from: 0,
            to: 4,
            selectedText: "Text",
            thread: [
                { author: "Ada", message: "First", time: 1 },
                { author: "Bea", message: "Second", time: 2 },
                { author: "Cy", message: "Third", time: 3 },
            ],
        };
        const collapsed = render(ReadonlyAnnotationCard, {
            props: { annotation, active: false, ...callbacks },
        });
        expect(collapsed.getByText("First")).toBeTruthy();
        expect(collapsed.queryByText("Second")).toBeNull();
        expect(collapsed.getByText("2 more replies")).toBeTruthy();
        collapsed.unmount();

        const expanded = render(ReadonlyAnnotationCard, {
            props: { annotation, active: true, ...callbacks },
        });
        expect(expanded.getByText("First")).toBeTruthy();
        expect(expanded.getByText("Second")).toBeTruthy();
        expect(expanded.getByText("Third")).toBeTruthy();
    });

    it("shows a suggestion AI summary once and preserves human replies", () => {
        const { getAllByText, getByText } = render(ReadonlyAnnotationCard, {
            props: {
                annotation: {
                    id: "suggestion-thread",
                    type: "suggestion",
                    from: 0,
                    to: 5,
                    selectedText: "brown",
                    replacements: [{ text: "russet" }],
                    thread: [
                        { author: "AI", message: "Use a richer color.", time: 1 },
                        { author: "Writer", message: "Agreed.", time: 2 },
                    ],
                },
                active: true,
                ...callbacks,
            },
        });
        expect(getAllByText("Use a richer color.")).toHaveLength(1);
        expect(getByText("Agreed.")).toBeTruthy();
    });
});

describe("shared revision context panel", () => {
    it("fills an underflowing viewport without waiting for a scroll event", async () => {
        const onLoadMoreAfter = vi.fn();
        const { container } = render(ContextViewport, {
            props: {
                layers: [
                    {
                        before: "Outer before ",
                        revision: "outer target",
                        after: " outer after",
                        hasMoreBefore: false,
                        hasMoreAfter: true,
                    },
                    {
                        before: "Nested before ",
                        revision: "DEEPEST TARGET",
                        after: " nested after",
                        hasMoreBefore: false,
                        hasMoreAfter: false,
                    },
                ],
                onLoadMoreAfter,
            },
        });
        const context = container.querySelector<HTMLElement>("[data-context-scroll]");
        expect(context).not.toBeNull();
        Object.defineProperties(context, {
            clientHeight: { configurable: true, value: 200 },
            scrollHeight: { configurable: true, value: 200 },
        });

        await waitFor(() => expect(onLoadMoreAfter).toHaveBeenCalledOnce());
        expect(container.querySelector('[data-context-target-depth="1"]')?.textContent).toContain(
            "DEEPEST TARGET",
        );
    });

    it("updates both scroll-edge fades and requests lazy context at the boundary", async () => {
        const onLoadMoreBefore = vi.fn();
        const { container } = render(RevisionContextPanel, {
            props: {
                layers: [
                    {
                        before: "before ".repeat(80),
                        revision: "TARGET",
                        after: " after".repeat(80),
                        hasMoreBefore: true,
                        hasMoreAfter: true,
                    },
                ],
                onLoadMoreBefore,
            },
        });
        const context = container.querySelector<HTMLElement>("[data-revision-context-scroll]");
        expect(context).not.toBeNull();
        Object.defineProperties(context, {
            clientHeight: { configurable: true, value: 200 },
            scrollHeight: { configurable: true, value: 600 },
            scrollTop: { configurable: true, value: 200, writable: true },
        });

        await fireEvent.scroll(context as HTMLElement);
        await waitFor(() => {
            expect(context?.style.maskImage).toMatch(/transparent 0%.*transparent 100%/);
        });

        if (context) context.scrollTop = 0;
        await fireEvent.scroll(context as HTMLElement);
        await waitFor(() => {
            expect(context?.style.maskImage).toMatch(/black 0%.*transparent 100%/);
            expect(onLoadMoreBefore).toHaveBeenCalledOnce();
        });

        if (context) context.scrollTop = 400;
        await fireEvent.scroll(context as HTMLElement);
        await waitFor(() => {
            expect(context?.style.maskImage).toMatch(/transparent 0%.*black 100%/);
        });

        Object.defineProperty(context, "scrollHeight", { configurable: true, value: 100 });
        if (context) context.scrollTop = 0;
        await fireEvent.scroll(context as HTMLElement);
        await waitFor(() => {
            expect(context?.style.maskImage).toMatch(/black 0%.*black 100%/);
        });
    });

    it("renders the whole document through the desktop-derived edge mask", async () => {
        const before = `START-${"a".repeat(700)}`;
        const after = `${"z".repeat(700)}-END`;
        const content = `${before}world${after}`;
        const revision = {
            id: "long-revision",
            type: "revision" as const,
            from: before.length,
            to: before.length + 5,
            selectedText: "world",
            thread: [],
            activeVersionIndex: 0,
            versions: [{ index: 0, versionId: "original", text: "world", annotations: [] }],
        };
        const { container } = render(ReadonlyAnnotationModal, {
            props: {
                annotation: revision,
                rootContent: content,
                rootAnnotations: [revision],
                onClose: vi.fn(),
                onSelectRevisionVersion: vi.fn(),
            },
        });

        const context = container.querySelector<HTMLElement>("[data-revision-context-scroll]");
        expect(context).not.toBeNull();
        expect(context?.textContent).toContain("START-");
        expect(context?.textContent).toContain("-END");
        await waitFor(() => {
            expect(context?.style.maskImage).toContain("linear-gradient");
        });
    });
});

describe("shared annotation modal parity", () => {
    it("passes serialized breadcrumb version indices instead of array positions", async () => {
        const onSelectRevisionVersion = vi.fn();
        const revision = {
            id: "sparse-revision",
            type: "revision" as const,
            from: 0,
            to: 5,
            selectedText: "first",
            thread: [],
            activeVersionIndex: 2,
            versions: [
                {
                    index: 2,
                    versionId: "sparse-first",
                    label: "First sparse",
                    text: "first",
                    annotations: [],
                },
                {
                    index: 7,
                    versionId: "sparse-second",
                    label: "Second sparse",
                    text: "second",
                    annotations: [],
                },
            ],
        };
        const { getByRole } = render(ReadonlyAnnotationModal, {
            props: {
                annotation: revision,
                rootContent: "first",
                rootAnnotations: [revision],
                onClose: vi.fn(),
                onSelectRevisionVersion,
            },
        });

        await fireEvent.click(getByRole("button", { name: "Revision version: First sparse" }));
        await fireEvent.click(getByRole("button", { name: "Second sparse" }));
        expect(onSelectRevisionVersion).toHaveBeenCalledWith("sparse-revision", 7);
    });

    it("uses a real read-only CodeMirror host for state-backed revision versions", async () => {
        const revisionState = {
            doc: "Alpha beta",
            annotationField: {
                0: {
                    id: 0,
                    _type: "comment",
                    thread: [],
                    selection: { ranges: [{ anchor: 0, head: 5 }], main: 0 },
                },
            },
            versionGroupField: {},
        };
        const nestedComment = {
            id: "1.v0.0",
            type: "comment" as const,
            from: 0,
            to: 5,
            selectedText: "Alpha",
            thread: [],
        };
        const revision = {
            id: "1",
            type: "revision" as const,
            from: 0,
            to: 10,
            selectedText: "Alpha beta",
            thread: [],
            activeVersionIndex: 0,
            versions: [
                {
                    index: 0,
                    versionId: "v0",
                    text: "Alpha beta",
                    annotations: [nestedComment],
                },
            ],
        };

        const { container } = render(ReadonlyAnnotationModal, {
            props: {
                annotation: revision,
                rootContent: "Alpha beta",
                rootAnnotations: [revision],
                revisionState,
                onClose: vi.fn(),
                onSelectRevisionVersion: vi.fn(),
            },
        });

        await waitFor(() => {
            expect(
                container.querySelector('[data-revision-modal-editor="codemirror"]'),
            ).not.toBeNull();
            expect(container.querySelector(".cm-content")?.textContent).toBe("Alpha beta");
            expect(container.querySelector(".cm-comment")).not.toBeNull();
        });
        expect(container.querySelector('[data-revision-modal-editor="legacy-static"]')).toBeNull();
        expect(container.querySelector('[data-annotation-card-view="comment"]')).not.toBeNull();
        expect(container.querySelector(".cm-comment-active")).not.toBeNull();
        expect(
            container
                .querySelector('[data-annotation-card-view="comment"]')
                ?.getAttribute("data-active"),
        ).toBe("true");
        expect(container.querySelector(".cm-content")?.getAttribute("contenteditable")).toBe(
            "false",
        );
    });

    it("keeps linked nested revision choices after the modal host cascades them", async () => {
        const state = buildNestedLinkedFixtureState();
        const { container, getByRole } = render(ReadonlyDocument, {
            props: { serializedState: serializeFixtureWire(state) },
        });

        await waitFor(() => expect(container.querySelector(".cm-content")).not.toBeNull());
        await fireEvent.click(getByRole("button", { name: "Expand revision editor" }));
        const modal = await waitFor(() => {
            const element = container.querySelector<HTMLElement>(".readonly-modal");
            expect(element).not.toBeNull();
            return element as HTMLElement;
        });
        await waitFor(() => {
            expect(modal.querySelector(".cm-content")?.textContent).toContain(
                "The quick brown fox",
            );
        });

        await fireEvent.click(within(modal).getByTitle("swift"));
        await waitFor(() => {
            expect(modal.querySelector(".cm-content")?.textContent).toContain(
                "The swift brown hound",
            );
            expect(within(modal).getByTitle("swift").hasAttribute("disabled")).toBe(true);
            expect(within(modal).getByTitle("hound").hasAttribute("disabled")).toBe(true);
        });
    });

    it("shows full surrounding comment context through the shared viewport", async () => {
        const before = `START ${"before ".repeat(80)}`;
        const after = `${" after".repeat(80)} END`;
        const content = `${before}TARGET${after}`;
        const comment = {
            id: "comment-context",
            type: "comment" as const,
            from: before.length,
            to: before.length + 6,
            selectedText: "TARGET",
            thread: [],
        };
        const { container, getByRole } = render(ReadonlyAnnotationModal, {
            props: {
                annotation: comment,
                rootContent: content,
                rootAnnotations: [comment],
                onClose: vi.fn(),
                onSelectRevisionVersion: vi.fn(),
            },
        });

        const context = container.querySelector<HTMLElement>("[data-comment-context-scroll]");
        expect(context?.textContent).toContain("START");
        expect(context?.textContent).toContain("TARGET");
        expect(context?.textContent).toContain("END");
        expect(context?.style.maskImage).toContain("linear-gradient");

        await fireEvent.click(getByRole("button", { name: "Collapse Context" }));
        await waitFor(() => {
            expect(
                getByRole("button", { name: "Expand Context" }).getAttribute("aria-expanded"),
            ).toBe("false");
        });
    });

    it("switches suggestion replacements, renders token diffs, and preserves replies", async () => {
        const suggestion = {
            id: "suggestion-modal",
            type: "suggestion" as const,
            from: 0,
            to: 9,
            selectedText: "brown fox",
            replacements: [
                { text: "russet fox", rationale: "Specific color" },
                { text: "brown hound", rationale: "Different animal" },
            ],
            thread: [
                { author: "AI", message: "Try one focused change.", time: 1 },
                { author: "Writer", message: "The second option fits.", time: 2 },
            ],
        };
        const onClose = vi.fn();
        const onSelectRevisionVersion = vi.fn();
        const { container, getAllByText, getByRole, getByText, rerender } = render(
            ReadonlyAnnotationModal,
            {
                props: {
                    annotation: suggestion,
                    rootContent: suggestion.selectedText,
                    rootAnnotations: [suggestion],
                    onClose,
                    onSelectRevisionVersion,
                },
            },
        );

        expect(getAllByText("Try one focused change.")).toHaveLength(1);
        expect(getByText("The second option fits.")).toBeTruthy();
        expect(container.querySelector('[data-suggestion-diff="delete"]')?.textContent).toBe(
            "brown",
        );
        expect(container.querySelector('[data-suggestion-diff="insert"]')?.textContent).toBe(
            "russet",
        );

        await fireEvent.click(getByRole("button", { name: /brown hound/ }));
        expect(container.querySelector('[data-suggestion-diff="delete"]')?.textContent).toBe("fox");
        expect(container.querySelector('[data-suggestion-diff="insert"]')?.textContent).toBe(
            "hound",
        );
        expect(getByText("Different animal")).toBeTruthy();

        const nextSuggestion = {
            ...suggestion,
            id: "suggestion-modal-next",
            selectedText: "quiet lake",
            replacements: [{ text: "still lake" }, { text: "quiet sea" }],
        };
        await rerender({
            annotation: nextSuggestion,
            rootContent: nextSuggestion.selectedText,
            rootAnnotations: [nextSuggestion],
            onClose,
            onSelectRevisionVersion,
        });
        await waitFor(() => {
            expect(container.querySelector('[data-suggestion-diff="delete"]')?.textContent).toBe(
                "quiet",
            );
            expect(container.querySelector('[data-suggestion-diff="insert"]')?.textContent).toBe(
                "still",
            );
        });
    });
});
