/**
 * readonlyRender.test.ts — Mounts the landing `ReadonlyDocument` component with
 * a real wire payload and asserts it renders the shared document through the
 * actual read-only CodeMirror editor (not the legacy flat renderer).
 *
 * This is the DOM-level counterpart to shareRoundTrip.test.ts: it proves the
 * wire payload survives all the way to rendered content + annotation cards.
 */
import { ReadonlyDocument, ReadonlyShareView } from "@quillium/share";
import { fireEvent, render, waitFor } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import { buildFixtureState, serializeFixtureWire } from "./fixtures";

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
            expect(container.querySelector(".annotation-card-stack")?.children.length).toBe(4);
        });
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

        expect(container.querySelector(".cm-content")).toBeNull();
        expect(getByText("AI Suggestion")).toBeTruthy();
        expect(getByText("friend")).toBeTruthy();

        await fireEvent.click(getByRole("button", { name: "Expand suggestion diff" }));
        await waitFor(() => expect(container.querySelector(".readonly-modal")).not.toBeNull());
    });
});
