import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { DraftMeta } from "$lib/db/types";
import DraftTreePanel from "$lib/editor/DraftTreePanel.svelte";

// vitest globals are disabled, so testing-library can't self-register cleanup.
afterEach(cleanup);

function makeDraft(id: string, label: string, over: Partial<DraftMeta> = {}): DraftMeta {
    return {
        id,
        documentId: "doc-1",
        label,
        createdAt: 0,
        isActive: true,
        tabId: "tab-1",
        parentDraftId: null,
        branchedFrom: null,
        locked: false,
        ...over,
    };
}

// main (run head, locked because superseded) → v1 (run tip).
const MAIN = makeDraft("main", "main", { createdAt: 0, locked: true });
const V1 = makeDraft("v1", "v1", { parentDraftId: "main", createdAt: 1 });

function defaultProps(
    overrides: Partial<{
        drafts: DraftMeta[];
        activeDraftId: string | null;
        ondraftselect: (id: string) => void;
        ondraftiterate: (id: string) => void;
        ondraftbranch: (id: string) => void;
        ondraftrename: (id: string, label: string) => void;
        ondraftdelete: (id: string) => void;
        ontogglelock: (id: string, locked: boolean) => void;
    }> = {},
) {
    return {
        drafts: [MAIN, V1],
        activeDraftId: "v1",
        ondraftselect: vi.fn(),
        ondraftiterate: vi.fn(),
        ondraftbranch: vi.fn(),
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

    it("offers Iterate only on the run tip", () => {
        const { getByRole, queryByRole } = render(DraftTreePanel, { props: defaultProps() });
        expect(getByRole("button", { name: "Iterate v1" })).toBeInTheDocument();
        // main is superseded (not the tip) — no iterate action.
        expect(queryByRole("button", { name: "Iterate main" })).not.toBeInTheDocument();
    });

    it("calls ondraftiterate with the tip's id", async () => {
        const ondraftiterate = vi.fn();
        const { getByRole } = render(DraftTreePanel, { props: defaultProps({ ondraftiterate }) });
        await fireEvent.click(getByRole("button", { name: "Iterate v1" }));
        expect(ondraftiterate).toHaveBeenCalledWith("v1");
    });

    it("offers Branch on non-run-heads but not on main", () => {
        const { getByRole, queryByRole } = render(DraftTreePanel, { props: defaultProps() });
        expect(getByRole("button", { name: "Branch from v1" })).toBeInTheDocument();
        // main is a run head — a top-level take is a new tab, not a branch.
        expect(queryByRole("button", { name: "Branch from main" })).not.toBeInTheDocument();
    });

    it("calls ondraftbranch with the row's draft id", async () => {
        const ondraftbranch = vi.fn();
        const { getByRole } = render(DraftTreePanel, { props: defaultProps({ ondraftbranch }) });
        await fireEvent.click(getByRole("button", { name: "Branch from v1" }));
        expect(ondraftbranch).toHaveBeenCalledWith("v1");
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

    it("shows a manual lock action on unlocked drafts", () => {
        const { getByRole, queryByRole } = render(DraftTreePanel, { props: defaultProps() });
        expect(getByRole("button", { name: "Lock v1" })).toBeInTheDocument();
        // "main" is already locked, so it only offers unlock.
        expect(queryByRole("button", { name: "Lock main" })).not.toBeInTheDocument();
    });

    it("calls ontogglelock(id, true) when locking manually", async () => {
        const ontogglelock = vi.fn();
        const { getByRole } = render(DraftTreePanel, { props: defaultProps({ ontogglelock }) });
        await fireEvent.click(getByRole("button", { name: "Lock v1" }));
        expect(ontogglelock).toHaveBeenCalledWith("v1", true);
    });

    it("only offers delete on deletable leaves", () => {
        const { getByRole, queryByRole } = render(DraftTreePanel, { props: defaultProps() });
        expect(getByRole("button", { name: "Delete v1" })).toBeInTheDocument();
        // "main" has a live iteration after it, so it can't be deleted.
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
