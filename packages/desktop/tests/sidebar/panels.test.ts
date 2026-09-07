import {
    type SidebarPanelContribution,
    type SidebarPanelProps,
    type SidebarPanelTarget,
    createSidebarPanelSession,
    createSidebarPanels,
} from "$lib/sidebar/panels";
import { MessageCircleIcon } from "lucide-svelte";
import type { Component } from "svelte";
import { describe, expect, it, vi } from "vitest";

const Panel = (() => ({})) satisfies Component<SidebarPanelProps>;

function contribution(overrides: Partial<SidebarPanelContribution> = {}): SidebarPanelContribution {
    return {
        id: "panel",
        component: Panel,
        icon: MessageCircleIcon,
        label: "Panel",
        title: "Panel",
        order: 1,
        placement: "main",
        activeClass: "active",
        hoverClass: "hover",
        requiresModel: false,
        contentClass: "flex flex-col",
        mount: "active",
        requiresAi: false,
        ...overrides,
    };
}

function target(overrides: Partial<SidebarPanelTarget> = {}): SidebarPanelTarget {
    return {
        documentId: "document-1",
        tabId: "tab-1",
        draftId: "draft-1",
        ...overrides,
    };
}

describe("createSidebarPanels", () => {
    it("sorts a frozen snapshot by order while preserving equal-order input order", () => {
        const first = contribution({ id: "first", order: 2 });
        const second = contribution({ id: "second", order: 1 });
        const third = contribution({ id: "third", order: 2 });

        const panels = createSidebarPanels([first, second, third]);

        expect(panels.map((panel) => panel.id)).toEqual(["second", "first", "third"]);
        expect(Object.isFrozen(panels)).toBe(true);
        expect(Object.isFrozen(panels[0])).toBe(true);
        expect(() => (panels as SidebarPanelContribution[]).push(contribution())).toThrow();
    });

    it("does not change when the source contribution is mutated", () => {
        const source = { ...contribution({ label: "Original" }) };
        const panels = createSidebarPanels([source]);

        source.label = "Changed";

        expect(panels[0].label).toBe("Original");
    });

    it("rejects empty or duplicate ids and duplicate shortcut keys", () => {
        expect(() => createSidebarPanels([contribution({ id: "  " })])).toThrow("nonempty id");
        expect(() =>
            createSidebarPanels([contribution({ id: "same" }), contribution({ id: "same" })]),
        ).toThrow("duplicate panel id");
        expect(() =>
            createSidebarPanels([
                contribution({ id: "one", shortcutKey: "x" }),
                contribution({ id: "two", shortcutKey: "x" }),
            ]),
        ).toThrow("duplicate shortcut key");
    });

    it("accepts a non-AI panel without model credentials", () => {
        const panel = createSidebarPanels([
            contribution({ id: "local-outline", requiresModel: false, mount: "active" }),
        ])[0];

        expect(panel.requiresModel).toBe(false);
        expect(panel.requiresAi).toBe(false);
        expect(panel.mount).toBe("active");
    });

    it("keeps the AI feature gate separate from the model credential gate", () => {
        const panel = createSidebarPanels([
            contribution({ id: "local-ai-context", requiresAi: true, requiresModel: false }),
        ])[0];

        expect(panel.requiresAi).toBe(true);
        expect(panel.requiresModel).toBe(false);
    });
});

describe("createSidebarPanelSession", () => {
    it("keeps a frozen target snapshot and makes stale reads return null", () => {
        let current = target();
        const readSelection = vi.fn(() => "selected text");
        const { session } = createSidebarPanelSession(current, {
            readTarget: () => current,
            readSelection,
        });

        expect(Object.isFrozen(session.target)).toBe(true);
        expect(session.target).toEqual(current);
        expect(session.isCurrent()).toBe(true);
        expect(session.readSelection()).toBe("selected text");

        current = target({ documentId: "document-2" });
        expect(session.isCurrent()).toBe(false);
        expect(session.readSelection()).toBeNull();
        expect(readSelection).toHaveBeenCalledTimes(1);
    });

    it.each([
        ["documentId", { documentId: "document-2" }],
        ["tabId", { tabId: "tab-2" }],
        ["draftId", { draftId: "draft-2" }],
    ])("treats a %s switch as stale", (_identity, changed) => {
        let current = target();
        const { session } = createSidebarPanelSession(current, {
            readTarget: () => current,
            readSelection: () => "selection",
        });

        current = target(changed);

        expect(session.isCurrent()).toBe(false);
        expect(session.readSelection()).toBeNull();
    });

    it("does not read selection while the target has no draft", () => {
        const current = target({ draftId: null });
        const readSelection = vi.fn(() => "selection");
        const { session } = createSidebarPanelSession(current, {
            readTarget: () => current,
            readSelection,
        });

        expect(session.isCurrent()).toBe(true);
        expect(session.readSelection()).toBeNull();
        expect(readSelection).not.toHaveBeenCalled();
    });

    it("aborts its signal and becomes stale on disposal", () => {
        const current = target();
        const { session, dispose } = createSidebarPanelSession(current, {
            readTarget: () => current,
            readSelection: () => "selection",
        });

        dispose();
        dispose();

        expect(session.signal.aborted).toBe(true);
        expect(session.isCurrent()).toBe(false);
        expect(session.readSelection()).toBeNull();
    });

    it("exposes only scoped, read-only panel capabilities", () => {
        const current = target();
        const { session } = createSidebarPanelSession(current, {
            readTarget: () => current,
            readSelection: () => "selection",
        });

        expect(Object.keys(session).sort()).toEqual([
            "isCurrent",
            "readSelection",
            "signal",
            "target",
        ]);
        expect(session).not.toHaveProperty("editorView");
        expect(session).not.toHaveProperty("stores");
        expect(session).not.toHaveProperty("provider");
        expect(session).not.toHaveProperty("credentials");
    });
});
