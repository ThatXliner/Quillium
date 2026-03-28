import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import "@testing-library/jest-dom/vitest";
import DocumentTabs from "$lib/editor/DocumentTabs.svelte";
import type { TabMeta } from "$lib/db/types";

function makeTab(id: string, label: string, position = 0): TabMeta {
    return {
        id,
        documentId: `doc-${id}`,
        label,
        position,
        draftId: `draft-${id}`,
        createdAt: 0,
    };
}

const TAB_A = makeTab("a", "Tab A", 0);
const TAB_B = makeTab("b", "Tab B", 1);

function defaultProps(overrides: Partial<{
    tabs: TabMeta[];
    activeTabId: string | null;
    ontabselect: (id: string) => void;
    ontabcreate: () => void;
    ontabrename: (id: string, label: string) => void;
    ontabdelete: (id: string) => void;
}> = {}) {
    return {
        tabs: [TAB_A, TAB_B],
        activeTabId: "a",
        ontabselect: vi.fn(),
        ontabcreate: vi.fn(),
        ontabrename: vi.fn(),
        ontabdelete: vi.fn(),
        ...overrides,
    };
}

describe("DocumentTabs", () => {
    // 1. Renders all tab labels
    it("renders all tab labels", () => {
        const { getByText } = render(DocumentTabs, { props: defaultProps() });
        expect(getByText("Tab A")).toBeInTheDocument();
        expect(getByText("Tab B")).toBeInTheDocument();
    });

    // 2. ontabselect called with correct tabId on click
    it("calls ontabselect with correct tabId on click", async () => {
        const ontabselect = vi.fn();
        const { getByText } = render(DocumentTabs, { props: defaultProps({ ontabselect }) });
        await fireEvent.click(getByText("Tab B").closest("[role='tab']")!);
        expect(ontabselect).toHaveBeenCalledWith("b");
    });

    // 3. Close button absent when tabs.length === 1
    it("does not render close button when only one tab", () => {
        const { queryByRole } = render(DocumentTabs, {
            props: defaultProps({ tabs: [TAB_A], activeTabId: "a" }),
        });
        expect(queryByRole("button", { name: "Close tab" })).not.toBeInTheDocument();
    });

    // 4. Close button present when tabs.length > 1
    it("renders close buttons when more than one tab", () => {
        const { getAllByRole } = render(DocumentTabs, { props: defaultProps() });
        const closeBtns = getAllByRole("button", { name: "Close tab" });
        expect(closeBtns).toHaveLength(2);
    });

    // 5. ontabdelete called with correct tabId when × clicked
    it("calls ontabdelete with correct tabId when × clicked", async () => {
        const ontabdelete = vi.fn();
        const { getAllByRole } = render(DocumentTabs, { props: defaultProps({ ontabdelete }) });
        const closeBtns = getAllByRole("button", { name: "Close tab" });
        // First close button corresponds to TAB_A
        await fireEvent.click(closeBtns[0]);
        expect(ontabdelete).toHaveBeenCalledWith("a");
    });

    // 6. Double-click enters rename mode (input appears)
    it("shows rename input after double-clicking a tab label", async () => {
        const { getByText, queryByRole } = render(DocumentTabs, { props: defaultProps() });
        const tabEl = getByText("Tab A").closest("[role='tab']")!;
        await fireEvent.dblClick(tabEl);
        await new Promise((r) => setTimeout(r, 0));
        expect(queryByRole("textbox", { name: "Rename tab" })).toBeInTheDocument();
    });

    // 7. Enter key commits rename, calls ontabrename(tabId, trimmedValue)
    it("commits rename on Enter and calls ontabrename with trimmed value", async () => {
        const ontabrename = vi.fn();
        const { getByText, getByRole } = render(DocumentTabs, {
            props: defaultProps({ ontabrename }),
        });
        const tabEl = getByText("Tab A").closest("[role='tab']")!;
        await fireEvent.dblClick(tabEl);
        await new Promise((r) => setTimeout(r, 0));

        const input = getByRole("textbox", { name: "Rename tab" }) as HTMLInputElement;
        input.value = "  New Name  ";
        await fireEvent.input(input);
        await fireEvent.keyDown(input, { key: "Enter" });

        expect(ontabrename).toHaveBeenCalledWith("a", "New Name");
    });

    // 8. Escape cancels rename — input disappears, ontabrename not called
    it("cancels rename on Escape without calling ontabrename", async () => {
        const ontabrename = vi.fn();
        const { getByText, queryByRole } = render(DocumentTabs, {
            props: defaultProps({ ontabrename }),
        });
        const tabEl = getByText("Tab A").closest("[role='tab']")!;
        await fireEvent.dblClick(tabEl);
        await new Promise((r) => setTimeout(r, 0));

        const input = queryByRole("textbox", { name: "Rename tab" }) as HTMLInputElement;
        expect(input).toBeInTheDocument();
        await fireEvent.keyDown(input, { key: "Escape" });

        expect(queryByRole("textbox", { name: "Rename tab" })).not.toBeInTheDocument();
        expect(ontabrename).not.toHaveBeenCalled();
    });

    // 9. Empty string rename falls back to "Tab" before calling ontabrename
    it("falls back to 'Tab' when rename value is empty or whitespace", async () => {
        const ontabrename = vi.fn();
        const { getByText, getByRole } = render(DocumentTabs, {
            props: defaultProps({ ontabrename }),
        });
        const tabEl = getByText("Tab A").closest("[role='tab']")!;
        await fireEvent.dblClick(tabEl);
        await new Promise((r) => setTimeout(r, 0));

        const input = getByRole("textbox", { name: "Rename tab" }) as HTMLInputElement;
        input.value = "   ";
        await fireEvent.input(input);
        await fireEvent.keyDown(input, { key: "Enter" });

        expect(ontabrename).toHaveBeenCalledWith("a", "Tab");
    });

    // 10. Blur commits rename (same as Enter)
    it("commits rename on blur", async () => {
        const ontabrename = vi.fn();
        const { getByText, getByRole } = render(DocumentTabs, {
            props: defaultProps({ ontabrename }),
        });
        const tabEl = getByText("Tab A").closest("[role='tab']")!;
        await fireEvent.dblClick(tabEl);
        await new Promise((r) => setTimeout(r, 0));

        const input = getByRole("textbox", { name: "Rename tab" }) as HTMLInputElement;
        input.value = "Blurred Name";
        await fireEvent.input(input);
        await fireEvent.blur(input);

        expect(ontabrename).toHaveBeenCalledWith("a", "Blurred Name");
    });

    // 11. ontabcreate called when + button clicked
    it("calls ontabcreate when + button is clicked", async () => {
        const ontabcreate = vi.fn();
        const { getByRole } = render(DocumentTabs, { props: defaultProps({ ontabcreate }) });
        await fireEvent.click(getByRole("button", { name: "New tab" }));
        expect(ontabcreate).toHaveBeenCalledOnce();
    });
});
