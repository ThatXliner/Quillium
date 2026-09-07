import "@testing-library/jest-dom/vitest";
import Sidebar from "$lib/sidebar/Sidebar.svelte";
import type { SidebarPanelContribution, SidebarPanelProps } from "$lib/sidebar/panels";
import { currentDocumentId, currentDraftId, currentTabId, selectedText } from "$lib/stores";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/svelte";
import { CircleIcon } from "lucide-svelte";
import type { Component } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PanelFixture from "./fixtures/PanelFixture.svelte";
import ThrowingPanel from "./fixtures/ThrowingPanel.svelte";
import { panelProbe, resetPanelProbe, throwingPanelState } from "./fixtures/probe";

vi.mock("$lib/sidebar/builtInPanels", () => ({ builtInPanels: [] }));

const { appSettings, ensureApiKeyLoaded, hasApiKey, stopAllAi } = vi.hoisted(() => ({
    appSettings: {
        aiEnabled: true,
        collapseContextSummary: false,
    },
    ensureApiKeyLoaded: vi.fn(() => Promise.resolve()),
    hasApiKey: vi.fn(() => false),
    stopAllAi: vi.fn(),
}));

vi.mock("$lib/ai/settings.svelte", () => ({
    aiProcessing: { active: false },
    documentContext: { freeform: "", decisions: [] },
    ensureApiKeyLoaded,
    hasApiKey,
    stopAllAi,
    useDocumentContextEffects: vi.fn(),
}));
vi.mock("$lib/settings.svelte", () => ({ appSettings }));
vi.mock("$lib/posthog", () => ({ default: { capture: vi.fn() } }));
vi.mock("$lib/ai/context", () => ({
    buildAiContextPacket: vi.fn(() => null),
    shouldShowContextSummary: vi.fn(() => false),
}));
vi.mock("$lib/ai/annotationContext", () => ({
    buildAnnotationContextInputs: vi.fn(() => []),
}));

function contribution(overrides: Partial<SidebarPanelContribution> = {}): SidebarPanelContribution {
    return {
        id: "local",
        component: PanelFixture as Component<SidebarPanelProps>,
        icon: CircleIcon,
        label: "Local panel",
        title: "Local panel",
        order: 1,
        shortcutKey: "4",
        placement: "main",
        activeClass: "text-blue-600 bg-white/60",
        hoverClass: "hover:text-blue-600",
        requiresModel: false,
        contentClass: "flex flex-col",
        mount: "eager",
        ...overrides,
    };
}

function resetStores(): void {
    currentDocumentId.set(null);
    currentTabId.set(null);
    currentDraftId.set(null);
    selectedText.set("");
}

function setTarget(): void {
    currentDocumentId.set("document-1");
    currentTabId.set("tab-1");
    currentDraftId.set("draft-1");
}

function expandedToolbar(container: HTMLElement): HTMLElement {
    return within(container).getAllByRole("toolbar", { name: "Sidebar panels" })[1];
}

function collapsedToolbar(container: HTMLElement): HTMLElement {
    return within(container).getAllByRole("toolbar", { name: "Sidebar panels" })[0];
}

function collapsedPanelButton(container: HTMLElement, label: RegExp): HTMLButtonElement {
    return within(collapsedToolbar(container)).getByRole("button", { name: label });
}

function hasInertAncestor(element: Element): boolean {
    let current: Element | null = element;
    while (current) {
        if (current.matches("[inert]") || (current as HTMLElement & { inert?: boolean }).inert) {
            return true;
        }
        current = current.parentElement;
    }
    return false;
}

beforeEach(() => {
    resetPanelProbe();
    throwingPanelState.shouldThrow = true;
    resetStores();
    appSettings.aiEnabled = true;
    appSettings.collapseContextSummary = false;
    ensureApiKeyLoaded.mockClear();
    hasApiKey.mockClear();
    stopAllAi.mockClear();

    if (!window.ResizeObserver) {
        window.ResizeObserver = class {
            observe(): void {}
            disconnect(): void {}
            unobserve(): void {}
        } as unknown as typeof ResizeObserver;
    }
    Element.prototype.scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollBy = vi.fn();
    if (!CSS.escape) {
        CSS.escape = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
    }
});

afterEach(() => {
    cleanup();
    resetStores();
});

describe("Sidebar panel host", () => {
    it("opens a local contribution without loading credentials", async () => {
        const ui = render(Sidebar, {
            props: { contributions: [contribution()] },
        });

        await fireEvent.click(collapsedPanelButton(ui.container, /^Local panel/));

        const region = ui.container.querySelector('[data-panel-id="local"]');
        expect(region).toBeInTheDocument();
        expect(region).toHaveFocus();
        expect(ui.getByTestId("panel-active")).toHaveTextContent("active");
        expect(ui.getByTestId("panel-session")).toHaveTextContent("none/none/none");
        expect(ensureApiKeyLoaded).not.toHaveBeenCalled();
        expect(stopAllAi).not.toHaveBeenCalled();
    });

    it("reads selection through the scoped session and aborts it when hidden while retaining eager content", async () => {
        setTarget();
        const ui = render(Sidebar, {
            props: { contributions: [contribution()] },
        });
        selectedText.set("selected words");

        await fireEvent.click(collapsedPanelButton(ui.container, /^Local panel/));
        await fireEvent.click(ui.getByRole("button", { name: "Read selection" }));
        expect(ui.getByTestId("panel-selection")).toHaveTextContent("selected words");

        const firstSession = panelProbe.updates.at(-1)?.session;
        expect(firstSession).not.toBeNull();
        expect(panelProbe.mountCount).toBe(1);

        await fireEvent.click(ui.getByRole("button", { name: "Close" }));
        await waitFor(() => expect(firstSession?.signal.aborted).toBe(true));
        expect(panelProbe.mountCount).toBe(1);
        expect(panelProbe.unmountCount).toBe(0);
        expect(ui.container.querySelector('[data-panel-id="local"]')).toBeInTheDocument();
        expect(ui.getByTestId("panel-active")).toHaveTextContent("inactive");

        await fireEvent.click(collapsedPanelButton(ui.container, /^Local panel/));
        expect(panelProbe.mountCount).toBe(1);
        expect(panelProbe.unmountCount).toBe(0);
        expect(panelProbe.updates.at(-1)?.session).not.toBe(firstSession);
    });

    it("mounts active-only contributions only while open", async () => {
        const ui = render(Sidebar, {
            props: {
                contributions: [
                    contribution({
                        id: "active-only",
                        label: "Active only",
                        title: "Active only",
                        mount: "active",
                        shortcutKey: undefined,
                    }),
                ],
            },
        });
        expect(panelProbe.mountCount).toBe(0);

        await fireEvent.click(collapsedPanelButton(ui.container, /^Active only/));
        expect(panelProbe.mountCount).toBe(1);
        const firstSession = panelProbe.updates.at(-1)?.session;
        expect(firstSession).not.toBeNull();

        await fireEvent.click(ui.getByRole("button", { name: "Close" }));
        await waitFor(() => expect(firstSession?.signal.aborted).toBe(true));
        expect(panelProbe.unmountCount).toBe(1);
        expect(ui.container.querySelector('[data-panel-id="active-only"]')).not.toBeInTheDocument();

        await fireEvent.click(collapsedPanelButton(ui.container, /^Active only/));
        expect(panelProbe.mountCount).toBe(2);
        expect(panelProbe.unmountCount).toBe(1);
        expect(ui.container.querySelectorAll('[data-panel-id="active-only"]')).toHaveLength(1);
    });

    it("removes a disabled panel and creates one instance when re-enabled", async () => {
        const panels = [contribution()];
        const ui = render(Sidebar, {
            props: { contributions: panels },
        });
        await fireEvent.click(collapsedPanelButton(ui.container, /^Local panel/));
        expect(panelProbe.mountCount).toBe(1);

        await ui.rerender({ contributions: panels, disabledPanelIds: ["local"] });
        expect(ui.queryByRole("button", { name: "Local panel" })).not.toBeInTheDocument();
        expect(ui.container.querySelector('[data-panel-id="local"]')).not.toBeInTheDocument();
        expect(panelProbe.unmountCount).toBe(1);

        await ui.rerender({ contributions: panels, disabledPanelIds: [] });
        expect(collapsedPanelButton(ui.container, /^Local panel/)).toBeInTheDocument();
        await fireEvent.click(collapsedPanelButton(ui.container, /^Local panel/));
        expect(panelProbe.mountCount).toBe(2);
        expect(panelProbe.unmountCount).toBe(1);
        expect(ui.container.querySelectorAll('[data-panel-id="local"]')).toHaveLength(1);
    });

    it.each([
        ["document", currentDocumentId, "document-2"],
        ["tab", currentTabId, "tab-2"],
        ["draft", currentDraftId, "draft-2"],
    ])("aborts the old session when the %s identity changes", async (_name, store, value) => {
        setTarget();
        const ui = render(Sidebar, {
            props: { contributions: [contribution()] },
        });
        await fireEvent.click(collapsedPanelButton(ui.container, /^Local panel/));

        const oldSession = panelProbe.updates.at(-1)?.session;
        expect(oldSession).not.toBeNull();
        (store as typeof currentDocumentId).set(value);

        await waitFor(() => expect(oldSession?.signal.aborted).toBe(true));
        await waitFor(() => expect(panelProbe.updates.at(-1)?.session).not.toBe(oldSession));
        expect(panelProbe.updates.at(-1)?.session?.isCurrent()).toBe(true);
    });

    it("moves focus through icon buttons with arrows, Home, and End", async () => {
        const ui = render(Sidebar, {
            props: {
                contributions: [
                    contribution({
                        id: "one",
                        label: "One",
                        title: "One",
                        order: 1,
                        shortcutKey: "1",
                    }),
                    contribution({
                        id: "two",
                        label: "Two",
                        title: "Two",
                        order: 2,
                        shortcutKey: "2",
                    }),
                    contribution({
                        id: "three",
                        label: "Three",
                        title: "Three",
                        order: 3,
                        shortcutKey: "3",
                    }),
                ],
            },
        });

        const collapsedButtons = within(collapsedToolbar(ui.container)).getAllByRole("button");
        collapsedButtons[0].focus();
        await fireEvent.keyDown(collapsedButtons[0], { key: "ArrowDown" });
        expect(document.activeElement).toBe(collapsedButtons[1]);
        await fireEvent.keyDown(collapsedButtons[1], { key: "Home" });
        expect(document.activeElement).toBe(collapsedButtons[0]);
        await fireEvent.keyDown(collapsedButtons[0], { key: "End" });
        expect(document.activeElement).toBe(collapsedButtons[2]);

        await fireEvent.click(collapsedButtons[0]);
        const expandedButtons = within(expandedToolbar(ui.container)).getAllByRole("button");
        expandedButtons[0].focus();
        await fireEvent.keyDown(expandedButtons[0], { key: "ArrowRight" });
        expect(document.activeElement).toBe(expandedButtons[1]);
    });

    it("renders many extra contributions in order in both overflow strips", async () => {
        const contributions = Array.from({ length: 12 }, (_, index) =>
            contribution({
                id: `extra-${index + 1}`,
                label: `Extra ${index + 1}`,
                title: `Extra ${index + 1}`,
                order: index + 1,
                shortcutKey: undefined,
            }),
        );
        const ui = render(Sidebar, { props: { contributions } });

        const collapsed = collapsedToolbar(ui.container);
        expect(collapsed).toHaveClass("overflow-y-auto");
        expect(
            within(collapsed)
                .getAllByRole("button")
                .map((button) => button.getAttribute("aria-label")),
        ).toEqual(contributions.map((panel) => panel.label));

        await fireEvent.click(within(collapsed).getByRole("button", { name: "Extra 1" }));
        const expanded = expandedToolbar(ui.container);
        expect(expanded).toHaveClass("overflow-x-auto");
        expect(
            within(expanded)
                .getAllByRole("button")
                .map((button) => button.getAttribute("aria-label")),
        ).toEqual(contributions.map((panel) => panel.label));
        expect(ui.container.querySelector('[data-panel-id="extra-1"]')).toBeInTheDocument();
    });

    it("makes collapsed and hidden panel chrome inert", async () => {
        const ui = render(Sidebar, {
            props: { contributions: [contribution()] },
        });
        const collapsed = collapsedToolbar(ui.container);
        const expanded = expandedToolbar(ui.container);
        expect(hasInertAncestor(collapsed)).toBe(false);
        expect(hasInertAncestor(expanded)).toBe(true);

        await fireEvent.click(collapsedPanelButton(ui.container, /^Local panel/));
        expect(hasInertAncestor(collapsed)).toBe(true);
        expect(hasInertAncestor(expanded)).toBe(false);
        expect(hasInertAncestor(ui.container.querySelector('[data-panel-id="local"]')!)).toBe(
            false,
        );

        await fireEvent.click(ui.getByRole("button", { name: "Close" }));
        expect(hasInertAncestor(collapsed)).toBe(false);
        expect(hasInertAncestor(expanded)).toBe(true);
        expect(hasInertAncestor(ui.container.querySelector('[data-panel-id="local"]')!)).toBe(true);
    });

    it("contains a panel render failure and retries it independently", async () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        const ui = render(Sidebar, {
            props: {
                contributions: [
                    contribution({
                        id: "broken",
                        label: "Broken",
                        title: "Broken",
                        component: ThrowingPanel as Component<SidebarPanelProps>,
                    }),
                ],
            },
        });

        await fireEvent.click(collapsedPanelButton(ui.container, /^Broken/));
        expect(await ui.findByRole("alert")).toHaveTextContent("Broken could not be displayed.");

        throwingPanelState.shouldThrow = false;
        await fireEvent.click(ui.getByRole("button", { name: "Try again" }));
        expect(await ui.findByTestId("throwing-panel")).toHaveTextContent("Recovered panel");
        expect(consoleError).toHaveBeenCalled();
        consoleError.mockRestore();
    });
});
