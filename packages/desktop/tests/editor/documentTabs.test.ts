import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { TabMeta } from "$lib/db/types";
import DocumentTabs from "$lib/editor/DocumentTabs.svelte";

// vitest globals are disabled, so testing-library can't self-register cleanup.
afterEach(cleanup);

function makeTab(id: string, label: string, position = 0): TabMeta {
    return {
        id,
        documentId: "doc-1",
        tabType: "draft",
        label,
        position,
        createdAt: 0,
    };
}

const TAB_A = makeTab("a", "Tab A", 0);
const TAB_B = makeTab("b", "Tab B", 1);
const TAB_C = makeTab("c", "Tab C", 2);

function defaultProps(
    overrides: Partial<{
        tabs: TabMeta[];
        activeTabId: string | null;
        readOnly: boolean;
        highlightedTabId: string | null;
        ontabselect: (id: string) => void;
        ontabcreate: () => void;
        ontabrename: (id: string, label: string) => void;
        ontabdelete: (id: string) => void;
        ontabreorder: (orderedIds: string[]) => void;
    }> = {},
) {
    return {
        tabs: [TAB_A, TAB_B],
        activeTabId: "a",
        readOnly: false,
        highlightedTabId: null,
        ontabselect: vi.fn(),
        ontabcreate: vi.fn(),
        ontabrename: vi.fn(),
        ontabdelete: vi.fn(),
        ontabreorder: vi.fn(),
        ...overrides,
    };
}

describe("DocumentTabs", () => {
    it("renders all tab labels", () => {
        const { getByText } = render(DocumentTabs, { props: defaultProps() });
        expect(getByText("Tab A")).toBeInTheDocument();
        expect(getByText("Tab B")).toBeInTheDocument();
    });

    it("calls ontabselect with correct tabId on click", async () => {
        const ontabselect = vi.fn();
        const { getByText } = render(DocumentTabs, { props: defaultProps({ ontabselect }) });
        await fireEvent.click(getByText("Tab B").closest("[role='tab']")!);
        expect(ontabselect).toHaveBeenCalledWith("b");
    });

    it("does not call ontabselect when clicking the active tab", async () => {
        const ontabselect = vi.fn();
        const { getByText } = render(DocumentTabs, { props: defaultProps({ ontabselect }) });
        await fireEvent.click(getByText("Tab A").closest("[role='tab']")!);
        expect(ontabselect).not.toHaveBeenCalled();
    });

    it("does not render close button when only one tab", () => {
        const { queryByRole } = render(DocumentTabs, {
            props: defaultProps({ tabs: [TAB_A], activeTabId: "a" }),
        });
        expect(queryByRole("button", { name: "Close tab" })).not.toBeInTheDocument();
    });

    it("renders close buttons when more than one tab", () => {
        const { getAllByRole } = render(DocumentTabs, { props: defaultProps() });
        expect(getAllByRole("button", { name: "Close tab" })).toHaveLength(2);
    });

    it("calls ontabdelete with correct tabId when × clicked", async () => {
        const ontabdelete = vi.fn();
        const { getAllByRole } = render(DocumentTabs, { props: defaultProps({ ontabdelete }) });
        const closeBtns = getAllByRole("button", { name: "Close tab" });
        await fireEvent.click(closeBtns[0]);
        expect(ontabdelete).toHaveBeenCalledWith("a");
    });

    it("shows rename input after double-clicking a tab label", async () => {
        const { getByText, queryByRole } = render(DocumentTabs, { props: defaultProps() });
        await fireEvent.dblClick(getByText("Tab A").closest("[role='tab']")!);
        await new Promise((r) => setTimeout(r, 0));
        expect(queryByRole("textbox", { name: "Rename tab" })).toBeInTheDocument();
    });

    it("commits rename on Enter and calls ontabrename with trimmed value", async () => {
        const ontabrename = vi.fn();
        const { getByText, getByRole } = render(DocumentTabs, {
            props: defaultProps({ ontabrename }),
        });
        await fireEvent.dblClick(getByText("Tab A").closest("[role='tab']")!);
        await new Promise((r) => setTimeout(r, 0));

        const input = getByRole("textbox", { name: "Rename tab" }) as HTMLInputElement;
        await fireEvent.input(input, { target: { value: "  New Name  " } });
        await fireEvent.keyDown(input, { key: "Enter" });

        expect(ontabrename).toHaveBeenCalledWith("a", "New Name");
    });

    it("cancels rename on Escape without calling ontabrename", async () => {
        const ontabrename = vi.fn();
        const { getByText, queryByRole } = render(DocumentTabs, {
            props: defaultProps({ ontabrename }),
        });
        await fireEvent.dblClick(getByText("Tab A").closest("[role='tab']")!);
        await new Promise((r) => setTimeout(r, 0));

        const input = queryByRole("textbox", { name: "Rename tab" }) as HTMLInputElement;
        expect(input).toBeInTheDocument();
        await fireEvent.keyDown(input, { key: "Escape" });

        expect(queryByRole("textbox", { name: "Rename tab" })).not.toBeInTheDocument();
        expect(ontabrename).not.toHaveBeenCalled();
    });

    it("falls back to 'Tab' when rename value is empty or whitespace", async () => {
        const ontabrename = vi.fn();
        const { getByText, getByRole } = render(DocumentTabs, {
            props: defaultProps({ ontabrename }),
        });
        await fireEvent.dblClick(getByText("Tab A").closest("[role='tab']")!);
        await new Promise((r) => setTimeout(r, 0));

        const input = getByRole("textbox", { name: "Rename tab" }) as HTMLInputElement;
        await fireEvent.input(input, { target: { value: "   " } });
        await fireEvent.keyDown(input, { key: "Enter" });

        expect(ontabrename).toHaveBeenCalledWith("a", "Tab");
    });

    it("commits rename on blur", async () => {
        const ontabrename = vi.fn();
        const { getByText, getByRole } = render(DocumentTabs, {
            props: defaultProps({ ontabrename }),
        });
        await fireEvent.dblClick(getByText("Tab A").closest("[role='tab']")!);
        await new Promise((r) => setTimeout(r, 0));

        const input = getByRole("textbox", { name: "Rename tab" }) as HTMLInputElement;
        await fireEvent.input(input, { target: { value: "Blurred Name" } });
        await fireEvent.blur(input);

        expect(ontabrename).toHaveBeenCalledWith("a", "Blurred Name");
    });

    it("calls ontabcreate when + button is clicked", async () => {
        const ontabcreate = vi.fn();
        const { getByRole } = render(DocumentTabs, { props: defaultProps({ ontabcreate }) });
        await fireEvent.click(getByRole("button", { name: "New tab" }));
        expect(ontabcreate).toHaveBeenCalledOnce();
    });

    it("places the labeled new-tab action directly after the rightmost tab", () => {
        const { getByRole } = render(DocumentTabs, { props: defaultProps() });
        const action = getByRole("button", { name: "New tab" });

        expect(action.previousElementSibling).toHaveAttribute("data-tab-id", "b");
        expect(action).toHaveAttribute("title", expect.stringMatching(/^New tab \(.+T\)$/));
        expect(action.className).toContain("focus-visible:ring-2");
    });

    it("keeps inactive tabs selectable in read-only mode", async () => {
        const ontabselect = vi.fn();
        const { getByText } = render(DocumentTabs, {
            props: defaultProps({ readOnly: true, ontabselect }),
        });

        await fireEvent.click(getByText("Tab B").closest("[role='tab']")!);

        expect(ontabselect).toHaveBeenCalledWith("b");
    });

    it("moves between tabs with the keyboard", async () => {
        const ontabselect = vi.fn();
        const { getByText } = render(DocumentTabs, {
            props: defaultProps({ readOnly: true, ontabselect }),
        });

        await fireEvent.keyDown(getByText("Tab A").closest("[role='tab']")!, {
            key: "ArrowRight",
        });

        expect(ontabselect).toHaveBeenCalledWith("b");
    });

    it("omits tab creation and deletion controls in read-only mode", () => {
        const { queryByRole } = render(DocumentTabs, {
            props: defaultProps({ readOnly: true }),
        });

        expect(queryByRole("button", { name: "New tab" })).not.toBeInTheDocument();
        expect(queryByRole("button", { name: "Close tab" })).not.toBeInTheDocument();
    });

    it("does not enter rename mode after a read-only tab is double-clicked", async () => {
        const ontabrename = vi.fn();
        const { getByText, queryByRole } = render(DocumentTabs, {
            props: defaultProps({ readOnly: true, ontabrename }),
        });

        await fireEvent.dblClick(getByText("Tab A").closest("[role='tab']")!);
        await new Promise((r) => setTimeout(r, 0));

        expect(queryByRole("textbox", { name: "Rename tab" })).not.toBeInTheDocument();
        expect(ontabrename).not.toHaveBeenCalled();
    });

    it("marks a highlighted tab independently from the active tab", () => {
        const { container } = render(DocumentTabs, {
            props: defaultProps({ activeTabId: "a", highlightedTabId: "b" }),
        });

        const highlighted = container.querySelector('[data-highlighted="true"]');
        expect(highlighted).toHaveTextContent("Tab B");
        expect(highlighted).toHaveAttribute("aria-selected", "false");
        expect(highlighted).toHaveAttribute("aria-describedby", "document-tab-timeline-target");
        expect(container.querySelector("#document-tab-timeline-target")).toHaveTextContent(
            "Timeline target",
        );
    });

    // Drag is a custom pointer-events implementation. jsdom has no layout and
    // no pointer capture, so we stub element geometry + the capture methods and
    // drive a real pointerdown → move (past threshold) → up sequence. The pure
    // index math is covered separately in tabReorder.test.ts; here we assert
    // the component's observable contract: a real drag commits a changed order,
    // a press without movement does not, and a drag eats the trailing click.
    const TAB_W = 100;

    // Lay each tab out in a 100px slot and stub the strip's geometry so the
    // drag handlers compute against deterministic coordinates.
    function stubGeometry(container: HTMLElement) {
        const strip = container.querySelector("[role='tablist']") as HTMLElement;
        Object.defineProperty(strip, "scrollLeft", { value: 0, writable: true });
        Object.defineProperty(strip, "scrollWidth", { value: 1000, configurable: true });
        Object.defineProperty(strip, "clientWidth", { value: 1000, configurable: true });
        strip.getBoundingClientRect = () =>
            ({
                left: 0,
                right: 1000,
                top: 0,
                bottom: 30,
                width: 1000,
                height: 30,
                x: 0,
                y: 0,
            }) as DOMRect;
        const tabs = [...strip.querySelectorAll("[role='tab']")] as HTMLElement[];
        tabs.forEach((el, i) => {
            const left = i * TAB_W;
            el.getBoundingClientRect = () =>
                ({
                    left,
                    right: left + TAB_W,
                    top: 0,
                    bottom: 30,
                    width: TAB_W,
                    height: 30,
                    x: left,
                    y: 0,
                }) as DOMRect;
            // jsdom lacks pointer capture; the handlers call these.
            el.setPointerCapture = () => {};
            el.releasePointerCapture = () => {};
        });
        return { strip, tabs };
    }

    function pointer(el: HTMLElement, type: string, clientX: number) {
        return fireEvent(
            el,
            new PointerEvent(type, { pointerId: 1, button: 0, clientX, bubbles: true }),
        );
    }

    it("commits a changed order after a pointer drag past a neighbour", async () => {
        const ontabreorder = vi.fn();
        const { container, getByText } = render(DocumentTabs, {
            props: defaultProps({ tabs: [TAB_A, TAB_B, TAB_C], ontabreorder }),
        });
        stubGeometry(container);
        const tabA = getByText("Tab A").closest("[role='tab']") as HTMLElement;

        // Press on A (centre 50), drag right past C's centre (250) → A to end.
        await pointer(tabA, "pointerdown", 50);
        await pointer(tabA, "pointermove", 300);
        await pointer(tabA, "pointerup", 300);

        expect(ontabreorder).toHaveBeenCalledTimes(1);
        expect(ontabreorder.mock.calls[0][0][2]).toBe("a"); // 'a' ends up last
    });

    it("can drag the last tab all the way to the front", async () => {
        const ontabreorder = vi.fn();
        const { container, getByText } = render(DocumentTabs, {
            props: defaultProps({ tabs: [TAB_A, TAB_B, TAB_C], ontabreorder }),
        });
        stubGeometry(container);
        const tabC = getByText("Tab C").closest("[role='tab']") as HTMLElement;

        // Press on C (centre 250), drag left past A's centre (50) → C to front.
        await pointer(tabC, "pointerdown", 250);
        await pointer(tabC, "pointermove", 0);
        await pointer(tabC, "pointerup", 0);

        expect(ontabreorder).toHaveBeenCalledTimes(1);
        expect(ontabreorder.mock.calls[0][0][0]).toBe("c"); // 'c' ends up first
    });

    it("does not call ontabreorder on a click (press without movement)", async () => {
        const ontabreorder = vi.fn();
        const { container, getByText } = render(DocumentTabs, {
            props: defaultProps({ tabs: [TAB_A, TAB_B, TAB_C], ontabreorder }),
        });
        stubGeometry(container);
        const tabA = getByText("Tab A").closest("[role='tab']") as HTMLElement;

        await pointer(tabA, "pointerdown", 50);
        await pointer(tabA, "pointermove", 51); // under the 4px threshold
        await pointer(tabA, "pointerup", 51);

        expect(ontabreorder).not.toHaveBeenCalled();
    });

    it("does not reorder tabs after a pointer drag in read-only mode", async () => {
        const ontabreorder = vi.fn();
        const { container, getByText } = render(DocumentTabs, {
            props: defaultProps({
                tabs: [TAB_A, TAB_B, TAB_C],
                readOnly: true,
                ontabreorder,
            }),
        });
        stubGeometry(container);
        const tabA = getByText("Tab A").closest("[role='tab']") as HTMLElement;

        await pointer(tabA, "pointerdown", 50);
        await pointer(tabA, "pointermove", 300);
        await pointer(tabA, "pointerup", 300);

        expect(ontabreorder).not.toHaveBeenCalled();
        expect(
            [...container.querySelectorAll("[role='tab']")].map((tab) => tab.textContent?.trim()),
        ).toEqual(["Tab A", "Tab B", "Tab C"]);
    });

    it("suppresses the post-drag click so a reordered tab isn't also selected", async () => {
        const ontabselect = vi.fn();
        const ontabreorder = vi.fn();
        const { container, getByText } = render(DocumentTabs, {
            props: defaultProps({
                tabs: [TAB_A, TAB_B, TAB_C],
                activeTabId: "a",
                ontabselect,
                ontabreorder,
            }),
        });
        stubGeometry(container);
        const tabB = getByText("Tab B").closest("[role='tab']") as HTMLElement;

        // Drag B left past A's centre, then the trailing click must be eaten.
        await pointer(tabB, "pointerdown", 150);
        await pointer(tabB, "pointermove", 10);
        await pointer(tabB, "pointerup", 10);
        await fireEvent.click(tabB);

        expect(ontabreorder).toHaveBeenCalledTimes(1);
        expect(ontabselect).not.toHaveBeenCalled();
    });
});
