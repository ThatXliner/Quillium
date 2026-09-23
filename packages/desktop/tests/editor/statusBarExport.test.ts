import { cleanup, fireEvent, render, within } from "@testing-library/svelte";
import { createRawSnippet } from "svelte";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

// StatusBar requires a `children` snippet; an empty one suffices for these tests.
const emptyChildren = createRawSnippet(() => ({ render: () => "<span></span>" }));

// jsdom lacks ResizeObserver, which StatusBar uses to track strip overflow.
beforeAll(() => {
    globalThis.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
    };
});

// Mock the export module so we can assert the chosen format without touching Tauri.
const { exportDocument } = vi.hoisted(() => ({ exportDocument: vi.fn(async () => {}) }));
vi.mock("$lib/export", () => ({ exportDocument }));

import StatusBar from "$lib/editor/StatusBar.svelte";
import { editorView } from "$lib/stores";

afterEach(() => {
    cleanup();
    exportDocument.mockClear();
    // The store is typed non-nullable; reset to a cleared value for test isolation.
    editorView.set(null as unknown as Parameters<typeof editorView.set>[0]);
});

// A minimal stand-in for an EditorView — StatusBar only needs it to be truthy.
const FAKE_VIEW = { state: {}, focus() {} } as unknown as Parameters<typeof editorView.set>[0];

function openModal() {
    const { getByLabelText } = render(StatusBar, {
        props: { titleVisibility: "never", children: emptyChildren },
    });
    editorView.set(FAKE_VIEW);
    return getByLabelText("Export document");
}

describe("StatusBar export modal (#258)", () => {
    it("opens a centered modal portaled to <body>, not an inline popup", async () => {
        const downloadBtn = openModal();
        await fireEvent.click(downloadBtn);

        const dialog = document.querySelector("[role='dialog'][aria-label='Export document']");
        expect(dialog).not.toBeNull();
        // The dialog must be a direct child of <body> (portaled), so no ancestor
        // backdrop-filter / overflow can clip it.
        expect(dialog?.parentElement).toBe(document.body);
        // It covers the viewport (fixed inset-0) rather than anchoring to the bar.
        expect(dialog).toHaveClass("fixed", "inset-0");
    });

    it("lists every export format", async () => {
        const downloadBtn = openModal();
        await fireEvent.click(downloadBtn);

        const dialog = document.querySelector("[role='dialog']") as HTMLElement;
        const scope = within(dialog);
        for (const label of [
            "Plain Text",
            "Text + Annotations",
            "JSON",
            "Markdown",
            "PDF",
            "Word",
            "Word + Annotations",
            "PDF + Annotations",
        ]) {
            expect(scope.getByText(label)).toBeInTheDocument();
        }
    });

    it("invokes exportDocument with the chosen format and closes", async () => {
        const downloadBtn = openModal();
        await fireEvent.click(downloadBtn);

        const dialog = document.querySelector("[role='dialog']") as HTMLElement;
        await fireEvent.click(within(dialog).getByText("Markdown"));

        expect(exportDocument).toHaveBeenCalledTimes(1);
        expect(exportDocument).toHaveBeenCalledWith(expect.anything(), "md");

        // Modal closes after a successful export.
        await vi.waitFor(() => {
            expect(document.querySelector("[role='dialog']")).toBeNull();
        });
    });

    it("closes on Escape and on backdrop click", async () => {
        const downloadBtn = openModal();

        await fireEvent.click(downloadBtn);
        expect(document.querySelector("[role='dialog']")).not.toBeNull();
        await fireEvent.keyDown(window, { key: "Escape" });
        expect(document.querySelector("[role='dialog']")).toBeNull();

        await fireEvent.click(downloadBtn);
        const backdrop = document.querySelector(
            "[role='dialog'] button[aria-label='Close'][tabindex='-1']",
        ) as HTMLElement;
        await fireEvent.click(backdrop);
        expect(document.querySelector("[role='dialog']")).toBeNull();
    });
});
