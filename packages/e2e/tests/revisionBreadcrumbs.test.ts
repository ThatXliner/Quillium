import { type RevisionBreadcrumbCrumbView, RevisionBreadcrumbs } from "@quillium/share";
import { fireEvent, render } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";

const crumbs = [
    {
        id: "outer",
        label: "Outer revision",
        current: false,
        selectedVersionId: "outer-original",
        versions: [
            { id: "outer-original", label: "Outer original" },
            { id: "outer-alternate", label: "Outer alternate" },
        ],
    },
    {
        id: "current",
        label: "Current revision",
        current: true,
        selectedVersionId: "current-draft",
        versions: [
            { id: "current-draft", label: "Draft preview", editableLabel: "Draft name" },
            { id: "current-alternate", label: "Current alternate" },
        ],
    },
] satisfies RevisionBreadcrumbCrumbView[];

describe("RevisionBreadcrumbs", () => {
    it("navigates, selects versions, marks the selection, and closes with Escape", async () => {
        const onNavigate = vi.fn();
        const onSelectVersion = vi.fn();
        const { container, getByRole, queryByText } = render(RevisionBreadcrumbs, {
            props: { crumbs, onNavigate, onSelectVersion },
        });

        await fireEvent.click(getByRole("button", { name: "Outer revision" }));
        expect(onNavigate).toHaveBeenCalledWith("outer");

        const outerTrigger = getByRole("button", {
            name: "Outer revision version: Outer original",
        });
        expect(outerTrigger.classList.contains("version-trigger-ancestor")).toBe(true);
        expect(outerTrigger.className).not.toMatch(/(?:bg|text)-black/);
        await fireEvent.click(outerTrigger);
        expect(
            container.querySelector('[data-breadcrumb-id="outer"] [data-selected="true"]')
                ?.textContent,
        ).toContain("Outer original");

        await fireEvent.click(getByRole("button", { name: "Outer alternate" }));
        expect(onSelectVersion).toHaveBeenCalledWith("outer", "outer-alternate");
        expect(outerTrigger.getAttribute("aria-expanded")).toBe("false");

        const currentTrigger = getByRole("button", {
            name: "Current revision version: Draft preview",
        });
        await fireEvent.click(currentTrigger);
        expect(queryByText("Current alternate")).not.toBeNull();
        await fireEvent.keyDown(currentTrigger, { key: "Escape" });
        expect(currentTrigger.getAttribute("aria-expanded")).toBe("false");
    });

    it("closes on outside click and exposes optional rename/delete capabilities", async () => {
        const onRenameCurrent = vi.fn();
        const onDeleteCurrentVersion = vi.fn();
        const { container, getByRole } = render(RevisionBreadcrumbs, {
            props: {
                crumbs,
                onNavigate: vi.fn(),
                onSelectVersion: vi.fn(),
                onRenameCurrent,
                onDeleteCurrentVersion,
            },
        });

        const currentTrigger = getByRole("button", {
            name: "Current revision version: Draft preview",
        });
        await fireEvent.click(currentTrigger);
        expect(container.querySelector(".version-popover")).not.toBeNull();
        await fireEvent.click(document.body);
        expect(currentTrigger.getAttribute("aria-expanded")).toBe("false");

        await fireEvent.dblClick(currentTrigger);
        const renameInput = getByRole("textbox", { name: "Rename current version" });
        expect((renameInput as HTMLInputElement).value).toBe("Draft name");
        await fireEvent.input(renameInput, { target: { value: "  Final name  " } });
        await fireEvent.keyDown(renameInput, { key: "Enter" });
        expect(onRenameCurrent).toHaveBeenCalledWith("current", "current-draft", "Final name");

        await fireEvent.click(
            getByRole("button", { name: "Current revision version: Draft preview" }),
        );
        await fireEvent.click(getByRole("button", { name: "Delete version 2" }));
        expect(onDeleteCurrentVersion).toHaveBeenCalledWith("current", "current-alternate");
    });

    it("hides mutation affordances when capabilities are omitted", async () => {
        const { container, getByRole, queryByRole } = render(RevisionBreadcrumbs, {
            props: {
                crumbs,
                onNavigate: vi.fn(),
                onSelectVersion: vi.fn(),
            },
        });
        const currentTrigger = getByRole("button", {
            name: "Current revision version: Draft preview",
        });

        await fireEvent.dblClick(currentTrigger);
        expect(queryByRole("textbox", { name: "Rename current version" })).toBeNull();
        await fireEvent.click(currentTrigger);
        expect(container.querySelectorAll('[aria-label^="Delete version"]')).toHaveLength(0);
    });

    it("cancels rename with Escape without closing the surrounding modal", async () => {
        const outerKeydown = vi.fn();
        const { getByRole, queryByRole } = render(RevisionBreadcrumbs, {
            props: {
                crumbs,
                onNavigate: vi.fn(),
                onSelectVersion: vi.fn(),
                onRenameCurrent: vi.fn(),
            },
        });
        await fireEvent.dblClick(
            getByRole("button", { name: "Current revision version: Draft preview" }),
        );
        const renameInput = getByRole("textbox", { name: "Rename current version" });
        window.addEventListener("keydown", outerKeydown);
        try {
            await fireEvent.keyDown(renameInput, { key: "Escape" });
        } finally {
            window.removeEventListener("keydown", outerKeydown);
        }

        expect(queryByRole("textbox", { name: "Rename current version" })).toBeNull();
        expect(outerKeydown).not.toHaveBeenCalled();
    });
});
