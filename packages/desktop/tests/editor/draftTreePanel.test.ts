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
        readOnly: boolean;
        highlightedDraftId: string | null;
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
        readOnly: false,
        highlightedDraftId: null,
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

    it("keeps inactive drafts selectable in read-only mode", async () => {
        const ondraftselect = vi.fn();
        const { getByText } = render(DraftTreePanel, {
            props: defaultProps({ readOnly: true, ondraftselect }),
        });

        await fireEvent.click(getByText("main"));

        expect(ondraftselect).toHaveBeenCalledWith("main");
    });

    it("omits every draft mutation control in read-only mode", () => {
        const { queryByRole } = render(DraftTreePanel, {
            props: defaultProps({ readOnly: true }),
        });

        expect(queryByRole("button", { name: "Delete v1" })).not.toBeInTheDocument();
        expect(queryByRole("button", { name: "Iterate v1" })).not.toBeInTheDocument();
        expect(queryByRole("button", { name: "Branch from main" })).not.toBeInTheDocument();
        expect(queryByRole("button", { name: "Branch from v1" })).not.toBeInTheDocument();
        expect(queryByRole("button", { name: "Unlock main" })).not.toBeInTheDocument();
        expect(queryByRole("button", { name: "Lock v1" })).not.toBeInTheDocument();
    });

    it("does not enter rename mode after a read-only draft is double-clicked", async () => {
        const ondraftrename = vi.fn();
        const { getByText, queryByRole } = render(DraftTreePanel, {
            props: defaultProps({ readOnly: true, ondraftrename }),
        });

        await fireEvent.dblClick(getByText("v1"));
        await new Promise((r) => setTimeout(r, 0));

        expect(queryByRole("textbox", { name: "Rename draft" })).not.toBeInTheDocument();
        expect(ondraftrename).not.toHaveBeenCalled();
    });

    it("marks a highlighted draft independently from the active draft", () => {
        const { container } = render(DraftTreePanel, {
            props: defaultProps({ activeDraftId: "v1", highlightedDraftId: "main" }),
        });

        const highlighted = container.querySelector('[data-highlighted="true"]');
        expect(highlighted).toHaveTextContent("main");
        const button = highlighted?.querySelector("button");
        expect(button).not.toHaveAttribute("aria-current");
        expect(button).toHaveAttribute("aria-describedby", "draft-timeline-target");
        expect(container.querySelector("#draft-timeline-target")).toHaveTextContent(
            "Timeline target",
        );
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

    it("offers Branch on every draft, including main", () => {
        const { getByRole } = render(DraftTreePanel, { props: defaultProps() });
        expect(getByRole("button", { name: "Branch from v1" })).toBeInTheDocument();
        expect(getByRole("button", { name: "Branch from main" })).toBeInTheDocument();
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

    it("offers delete on unlocked non-root drafts, including parents", () => {
        // main → v1 → v2, all unlocked: v1 can be deleted even though it is a
        // parent, but the storyline root stays protected.
        const drafts = [
            makeDraft("main", "main", { createdAt: 0 }),
            makeDraft("v1", "v1", { parentDraftId: "main", createdAt: 1 }),
            makeDraft("v2", "v2", { parentDraftId: "v1", createdAt: 2 }),
        ];
        const { getByRole, queryByRole } = render(DraftTreePanel, {
            props: defaultProps({ drafts, activeDraftId: "v2" }),
        });
        expect(queryByRole("button", { name: "Delete main" })).not.toBeInTheDocument();
        expect(getByRole("button", { name: "Delete v1" })).toBeInTheDocument();
        expect(getByRole("button", { name: "Delete v2" })).toBeInTheDocument();
    });

    it("offers delete on an unlocked branch root", () => {
        const drafts = [
            makeDraft("main", "main", { createdAt: 0 }),
            makeDraft("b1", "b1", { branchedFrom: "main", createdAt: 1 }),
        ];
        const { getByRole } = render(DraftTreePanel, {
            props: defaultProps({ drafts, activeDraftId: "b1" }),
        });
        expect(getByRole("button", { name: "Delete b1" })).toBeInTheDocument();
    });

    it("hides delete on a locked draft", () => {
        // Default fixture: main is locked (superseded), v1 is the unlocked tip.
        const { getByRole, queryByRole } = render(DraftTreePanel, { props: defaultProps() });
        expect(getByRole("button", { name: "Delete v1" })).toBeInTheDocument();
        expect(queryByRole("button", { name: "Delete main" })).not.toBeInTheDocument();
    });

    it("calls ondraftdelete with the row's draft id", async () => {
        const ondraftdelete = vi.fn();
        const { getByRole } = render(DraftTreePanel, { props: defaultProps({ ondraftdelete }) });
        await fireEvent.click(getByRole("button", { name: "Delete v1" }));
        expect(ondraftdelete).toHaveBeenCalledWith("v1");
    });

    it("draws a branch elbow rail on an indented branch row", () => {
        // main → v1 (run tip), branch b1 off v1. b1 indents one level, so it
        // renders an amber elbow connector into v1's column.
        const drafts = [
            makeDraft("main", "main", { createdAt: 0, locked: true }),
            makeDraft("v1", "v1", { parentDraftId: "main", createdAt: 1 }),
            makeDraft("b1", "b1", { branchedFrom: "v1", createdAt: 2 }),
        ];
        const { container } = render(DraftTreePanel, {
            props: defaultProps({ drafts, activeDraftId: "v1" }),
        });
        // b1 is the only branch off the run tip → a corner elbow.
        expect(container.querySelector('[data-rail="branch-corner"]')).toBeInTheDocument();
    });

    it("draws a branch-start rail when a leaf draft has a branch", () => {
        const drafts = [
            makeDraft("main", "main", { createdAt: 0 }),
            makeDraft("b1", "new take", { branchedFrom: "main", createdAt: 1 }),
        ];
        const { container } = render(DraftTreePanel, {
            props: defaultProps({ drafts, activeDraftId: "b1" }),
        });
        expect(container.querySelector('[data-rail="branch-start"]')).toBeInTheDocument();
    });

    it("draws a run-continuation spine for an iteration that has a successor", () => {
        // main → v1: main continues its run downward, so it draws a spine below.
        const { container } = render(DraftTreePanel, { props: defaultProps() });
        expect(container.querySelector('[data-rail="run-continues"]')).toBeInTheDocument();
    });

    it("draws no rails for a single flat run with no branches", () => {
        const { container } = render(DraftTreePanel, {
            props: defaultProps({
                drafts: [makeDraft("only", "only", { createdAt: 0 })],
                activeDraftId: "only",
            }),
        });
        expect(container.querySelector("[data-rail]")).not.toBeInTheDocument();
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
