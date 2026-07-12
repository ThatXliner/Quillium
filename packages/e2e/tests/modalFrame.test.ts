import { AnnotationModalFrame, AnnotationModalHeader } from "@quillium/share";
import { fireEvent, render } from "@testing-library/svelte";
import { createRawSnippet } from "svelte";
import { describe, expect, it, vi } from "vitest";

const content = createRawSnippet(() => ({
    render: () => '<main data-test-modal-content="true">Modal body</main>',
}));
const leading = createRawSnippet(() => ({
    render: () => '<nav data-test-modal-leading="true">Breadcrumbs</nav>',
}));
const actions = createRawSnippet(() => ({
    render: () => '<button data-test-modal-action="true">Delete</button>',
}));

describe("annotation modal primitives", () => {
    it.each([
        ["revision", "1160px"],
        ["comment", "1060px"],
        ["suggestion", "820px"],
    ] as const)("exposes the canonical %s frame variant", (variant, width) => {
        const { container } = render(AnnotationModalFrame, {
            props: { variant, children: content },
        });

        const frame = container.querySelector<HTMLElement>("[data-annotation-modal-frame]");
        expect(frame?.dataset.annotationModalFrame).toBe(variant);
        expect(frame?.classList.contains(`annotation-modal-frame-${variant}`)).toBe(true);
        expect(frame?.dataset.annotationModalWidth).toBe(width);
        expect(frame?.style.getPropertyValue("--annotation-modal-width")).toBe(width);
        expect(frame?.querySelector("[data-test-modal-content]")?.textContent).toBe("Modal body");
    });

    it("renders optional host actions and owns the canonical close affordance", async () => {
        const onClose = vi.fn();
        const { container, getByRole } = render(AnnotationModalHeader, {
            props: {
                accent: "comment",
                leading,
                actions,
                onClose,
                closeLabel: "Close comment",
            },
        });

        const header = container.querySelector<HTMLElement>("[data-annotation-modal-header]");
        expect(header?.dataset.annotationModalHeader).toBe("comment");
        expect(header?.querySelector("[data-test-modal-leading]")?.textContent).toBe("Breadcrumbs");
        expect(header?.querySelector("[data-test-modal-action]")?.textContent).toBe("Delete");

        await fireEvent.click(getByRole("button", { name: "Close comment" }));
        expect(onClose).toHaveBeenCalledOnce();
    });

    it("omits the capability region when no actions are supplied", () => {
        const { container } = render(AnnotationModalHeader, {
            props: { accent: "suggestion", leading, onClose: vi.fn() },
        });

        expect(container.querySelector("[data-annotation-modal-actions]")).toBeNull();
        expect(
            container.querySelector('[data-annotation-modal-header="suggestion"]'),
        ).not.toBeNull();
    });
});
