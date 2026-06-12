import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { DraftMeta } from "$lib/db/types";
import DraftTreePanel from "$lib/editor/DraftTreePanel.svelte";

// vitest globals are disabled, so testing-library can't self-register cleanup.
afterEach(cleanup);

function makeDraft(
    id: string,
    label: string,
    parentDraftId: string | null = null,
    createdAt = 0,
    locked = false,
): DraftMeta {
    return {
        id,
        documentId: "doc-1",
        label,
        createdAt,
        isActive: true,
        tabId: "tab-1",
        parentDraftId,
        locked,
    };
}

const MAIN = makeDraft("main", "main", null, 0, true);
const V1 = makeDraft("v1", "v1", "main", 1);

function defaultProps(
    overrides: Partial<{
        drafts: DraftMeta[];
        activeDraftId: string | null;
        ondraftselect: (id: string) => void;
        ondraftfork: (id: string) => void;
        ondraftrename: (id: string, label: string) => void;
        ondraftdelete: (id: string) => void;
        ontogglelock: (id: string, locked: boolean) => void;
    }> = {},
) {
    return {
        drafts: [MAIN, V1],
        activeDraftId: "v1",
        ondraftselect: vi.fn(),
        ondraftfork: vi.fn(),
        ondraftrename: vi.fn(),
        ondraftdelete: vi.fn(),
        ontogglelock: vi.fn(),
        ...overrides,
    };
}

describe("DraftTreePanel", () => {
    it("renders every draft label", () => {
        const { getByText } = render(DraftTreePanel, { props: defaultProps() });
        expect(getByText("main")).toBeInTheDocument();
        expect(getByText("v1")).toBeInTheDocument();
    });

    it("calls ondraftselect when clicking an inactive draft", async () => {
        const ondraftselect = vi.fn();
        const { getByText } = render(DraftTreePanel, { props: defaultProps({ ondraftselect }) });
        await fireEvent.click(getByText("main"));
        expect(ondraftselect).toHaveBeenCalledWith("main");
    });

    it("does not call ondraftselect when clicking the active draft", async () => {
        const ondraftselect = vi.fn();
        const { getByText } = render(DraftTreePanel, { props: defaultProps({ ondraftselect }) });
        await fireEvent.click(getByText("v1"));
        expect(ondraftselect).not.toHaveBeenCalled();
    });

    it("calls ondraftfork with the row's draft id", async () => {
        const ondraftfork = vi.fn();
        const { getByRole } = render(DraftTreePanel, { props: defaultProps({ ondraftfork }) });
        await fireEvent.click(getByRole("button", { name: "Branch from v1" }));
        expect(ondraftfork).toHaveBeenCalledWith("v1");
    });

    it("shows an unlock action only for locked drafts", () => {
        const { getByRole, queryByRole } = render(DraftTreePanel, { props: defaultProps() });
        expect(getByRole("button", { name: "Unlock main" })).toBeInTheDocument();
        expect(queryByRole("button", { name: "Unlock v1" })).not.toBeInTheDocument();
    });

    it("calls ontogglelock(id, false) when unlocking", async () => {
        const ontogglelock = vi.fn();
        const { getByRole } = render(DraftTreePanel, { props: defaultProps({ ontogglelock }) });
        await fireEvent.click(getByRole("button", { name: "Unlock main" }));
        expect(ontogglelock).toHaveBeenCalledWith("main", false);
    });

    it("only offers delete on deletable leaves", () => {
        const { getByRole, queryByRole } = render(DraftTreePanel, { props: defaultProps() });
        expect(getByRole("button", { name: "Delete v1" })).toBeInTheDocument();
        // "main" has a child, so it can't be deleted.
        expect(queryByRole("button", { name: "Delete main" })).not.toBeInTheDocument();
    });

    it("calls ondraftdelete for a leaf draft", async () => {
        const ondraftdelete = vi.fn();
        const { getByRole } = render(DraftTreePanel, { props: defaultProps({ ondraftdelete }) });
        await fireEvent.click(getByRole("button", { name: "Delete v1" }));
        expect(ondraftdelete).toHaveBeenCalledWith("v1");
    });

    it("commits inline rename on Enter", async () => {
        const ondraftrename = vi.fn();
        const { getByText, getByRole } = render(DraftTreePanel, {
            props: defaultProps({ ondraftrename }),
        });
        await fireEvent.dblClick(getByText("v1"));
        await new Promise((r) => setTimeout(r, 0));

        const input = getByRole("textbox", { name: "Rename draft" }) as HTMLInputElement;
        await fireEvent.input(input, { target: { value: "  better title  " } });
        await fireEvent.keyDown(input, { key: "Enter" });

        expect(ondraftrename).toHaveBeenCalledWith("v1", "better title");
    });
});
