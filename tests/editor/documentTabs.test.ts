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

    // Reordering is driven by svelte-dnd-action, whose pointer-based drag
    // can't be faithfully simulated in jsdom (it needs real layout + pointer
    // capture). Instead we drive the component's own `finalize`/`consider`
    // handlers by dispatching the CustomEvents the library emits, with a
    // reordered `items` payload — exercising our persistence + suppression
    // logic without depending on the library's internals.
    function dispatchDnd(
        zone: HTMLElement,
        name: "consider" | "finalize",
        items: TabMeta[],
        info: { trigger: string; source: string; id?: string },
    ) {
        return fireEvent(zone, new CustomEvent(name, { detail: { items, info } }));
    }

    it("commits the new order on finalize after a reorder", async () => {
        const ontabreorder = vi.fn();
        const { getByRole } = render(DocumentTabs, {
            props: defaultProps({ tabs: [TAB_A, TAB_B, TAB_C], ontabreorder }),
        });
        const zone = getByRole("tablist");

        await dispatchDnd(zone, "finalize", [TAB_B, TAB_C, TAB_A], {
            trigger: "droppedIntoZone",
            source: "pointer",
        });

        expect(ontabreorder).toHaveBeenCalledWith(["b", "c", "a"]);
    });

    it("does not call ontabreorder when the order is unchanged", async () => {
        const ontabreorder = vi.fn();
        const { getByRole } = render(DocumentTabs, {
            props: defaultProps({ tabs: [TAB_A, TAB_B, TAB_C], ontabreorder }),
        });
        const zone = getByRole("tablist");

        await dispatchDnd(zone, "finalize", [TAB_A, TAB_B, TAB_C], {
            trigger: "droppedIntoZone",
            source: "pointer",
        });

        expect(ontabreorder).not.toHaveBeenCalled();
    });

    it("suppresses the post-drag click so a reordered tab isn't also selected", async () => {
        const ontabselect = vi.fn();
        const ontabreorder = vi.fn();
        const { getByRole, getByText } = render(DocumentTabs, {
            props: defaultProps({
                tabs: [TAB_A, TAB_B, TAB_C],
                activeTabId: "a",
                ontabselect,
                ontabreorder,
            }),
        });
        const zone = getByRole("tablist");

        await dispatchDnd(zone, "finalize", [TAB_B, TAB_A, TAB_C], {
            trigger: "droppedIntoZone",
            source: "pointer",
        });
        // The drop fires a trailing click on the moved tab; it must be eaten.
        await fireEvent.click(getByText("Tab B").closest("[role='tab']")!);

        expect(ontabreorder).toHaveBeenCalledWith(["b", "a", "c"]);
        expect(ontabselect).not.toHaveBeenCalled();
    });
});
