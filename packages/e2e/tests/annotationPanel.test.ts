import { AnnotationPanel } from "@quillium/share";
import { fireEvent, render, waitFor } from "@testing-library/svelte";
import { createRawSnippet } from "svelte";
import { describe, expect, it, vi } from "vitest";

const panelContent = createRawSnippet(() => ({
    render: () => '<article data-test-panel-card="true">Annotation card</article>',
}));
const panelEmpty = createRawSnippet(() => ({
    render: () => '<p data-test-panel-empty="true">Nothing here</p>',
}));
const panelToolbar = createRawSnippet<[boolean]>((collapsed) => ({
    render: () => `<span data-test-panel-toolbar="true">${collapsed() ? "closed" : "open"}</span>`,
}));

describe("AnnotationPanel", () => {
    it("owns the shared header, toolbar, scroll region, and collapse lifecycle", async () => {
        const onCollapsedChange = vi.fn();
        const { container, getByRole } = render(AnnotationPanel, {
            props: {
                content: panelContent,
                empty: panelEmpty,
                toolbar: panelToolbar,
                onCollapsedChange,
            },
        });

        const panel = container.querySelector<HTMLElement>("[data-annotation-panel]");
        expect(panel?.dataset.collapsed).toBe("false");
        expect(panel?.querySelector("[data-annotation-panel-scroll]")).not.toBeNull();
        expect(panel?.querySelector("[data-test-panel-card]")?.textContent).toBe("Annotation card");
        expect(panel?.querySelector("[data-test-panel-toolbar]")?.textContent).toBe("open");

        await fireEvent.click(getByRole("button", { name: "Collapse Annotations" }));
        await waitFor(() => {
            expect(panel?.dataset.collapsed).toBe("true");
            expect(getByRole("button", { name: "Expand Annotations" })).toBeTruthy();
        });
        expect(onCollapsedChange).toHaveBeenCalledWith(true);
    });

    it("renders the host-provided empty state inside the same scroll container", () => {
        const { container } = render(AnnotationPanel, {
            props: {
                hasContent: false,
                content: panelContent,
                empty: panelEmpty,
            },
        });

        const scroll = container.querySelector("[data-annotation-panel-scroll]");
        expect(scroll?.querySelector("[data-test-panel-card]")).toBeNull();
        expect(scroll?.querySelector("[data-test-panel-empty]")?.textContent).toBe("Nothing here");
    });
});
