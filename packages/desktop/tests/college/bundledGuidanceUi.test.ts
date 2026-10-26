import BundledGuidance from "$lib/college/BundledGuidance.svelte";
import type { CollegeCapabilities } from "$lib/college/capabilities";
import { newCollegeSetup } from "$lib/college/presets";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

afterEach(cleanup);

describe("bundled guidance review", () => {
    it("previews local guidance without saving and applies only on explicit acceptance", async () => {
        const setup = newCollegeSetup("uc-piq");
        setup.references = [];
        const acceptBundledGuidance = vi.fn().mockResolvedValue(undefined);
        const college = { acceptBundledGuidance } as unknown as CollegeCapabilities;
        const ui = render(BundledGuidance, { college, setup, saving: false });

        await fireEvent.click(ui.getByRole("button", { name: "Check for updated guidance" }));
        expect(ui.getByRole("region", { name: "Bundled guidance review" })).toBeTruthy();
        expect(ui.getAllByText("New guidance").length).toBeGreaterThan(0);
        expect(acceptBundledGuidance).not.toHaveBeenCalled();
        await fireEvent.click(ui.getByRole("button", { name: "Apply guidance update" }));
        await waitFor(() => expect(acceptBundledGuidance).toHaveBeenCalledWith(setup));
        expect(ui.getByRole("status").textContent).toContain("Bundled guidance saved");
    });

    it("blocks a stale preview when the prompt changes until the writer checks again", async () => {
        const setup = newCollegeSetup("common-app");
        setup.references = [];
        const acceptBundledGuidance = vi.fn();
        const college = { acceptBundledGuidance } as unknown as CollegeCapabilities;
        const ui = render(BundledGuidance, { college, setup, saving: false });
        await fireEvent.click(ui.getByRole("button", { name: "Check for updated guidance" }));

        await ui.rerender({ setup: { ...setup, intent: "A changed essay plan" } });
        const apply = ui.getByRole("button", {
            name: "Apply guidance update",
        }) as HTMLButtonElement;
        expect(apply.disabled).toBe(true);
        expect(ui.getByRole("status").textContent).toContain("setup changed");
        expect(acceptBundledGuidance).not.toHaveBeenCalled();

        await fireEvent.click(ui.getByRole("button", { name: "Check again" }));
        expect(
            (ui.getByRole("button", { name: "Apply guidance update" }) as HTMLButtonElement)
                .disabled,
        ).toBe(false);
    });

    it("reports current bundled guidance without offering a save", async () => {
        const setup = newCollegeSetup("uc-piq");
        const college = { acceptBundledGuidance: vi.fn() } as unknown as CollegeCapabilities;
        const ui = render(BundledGuidance, { college, setup, saving: false });
        await fireEvent.click(ui.getByRole("button", { name: "Check for updated guidance" }));
        expect(ui.getByRole("status").textContent).toContain("up to date");
        expect(ui.queryByRole("button", { name: "Apply guidance update" })).toBeNull();
    });

    it("does not claim custom prompt guidance is up to date", async () => {
        const setup = newCollegeSetup("uc-piq");
        setup.prompts[0].text = "A custom prompt";
        const college = { acceptBundledGuidance: vi.fn() } as unknown as CollegeCapabilities;
        const ui = render(BundledGuidance, { college, setup, saving: false });
        await fireEvent.click(ui.getByRole("button", { name: "Check for updated guidance" }));
        expect(ui.getByRole("status").textContent).toContain("No bundled guidance is available");
    });
});
