/**
 * readonlyRender.test.ts — Mounts the landing `ReadonlyDocument` component with
 * a real wire payload and asserts it renders the shared document through the
 * actual read-only CodeMirror editor (not the legacy flat renderer).
 *
 * This is the DOM-level counterpart to shareRoundTrip.test.ts: it proves the
 * wire payload survives all the way to rendered content + annotation cards.
 */
import { ReadonlyDocument } from "@quillium/share";
import { render, waitFor } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import { buildFixtureState, serializeFixtureWire } from "./fixtures";

describe("ReadonlyDocument renders through the real editor", () => {
    it("mounts the CodeMirror view with the active-version document text", async () => {
        const { state } = buildFixtureState();
        const wire = serializeFixtureWire(state);

        const { container } = render(ReadonlyDocument, {
            props: { serializedState: wire },
        });

        await waitFor(() => {
            const content = container.querySelector(".cm-content");
            expect(content).not.toBeNull();
            // v0 of each revision is active: "quick" / "fox".
            expect(content?.textContent).toContain("quick");
            expect(content?.textContent).toContain("fox");
        });

        expect(container.querySelector(".mount-error")).toBeNull();
    });

    it("renders a sidebar card for every annotation", async () => {
        const { state } = buildFixtureState();
        const wire = serializeFixtureWire(state);

        const { container } = render(ReadonlyDocument, {
            props: { serializedState: wire },
        });

        await waitFor(() => {
            // The empty-state paragraph is only shown when there are no
            // annotations; our fixture has three (comment + two revisions).
            expect(container.querySelector(".annotation-empty-state")).toBeNull();
            expect(container.querySelector(".annotation-card-stack")?.children.length).toBe(3);
        });
    });
});
