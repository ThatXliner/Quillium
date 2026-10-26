import UpdateBanner from "$lib/ui/UpdateBanner.svelte";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

afterEach(() => cleanup());

describe("UpdateBanner", () => {
    it("keeps an install failure visible and offers a retry", async () => {
        const oninstall = vi.fn();
        const { getByRole } = render(UpdateBanner, {
            props: {
                version: "0.23.0",
                error: "Drag it to Applications, then reopen Quillium.",
                oninstall,
                ondismiss: vi.fn(),
            },
        });

        expect(getByRole("alert")).toHaveTextContent("Drag it to Applications");
        const retry = getByRole("button", { name: "Try Again" });
        expect(retry).toBeEnabled();
        await fireEvent.click(retry);
        expect(oninstall).toHaveBeenCalledTimes(1);
    });

    it("disables the install button while downloading", () => {
        const { getByRole } = render(UpdateBanner, {
            props: {
                version: "0.23.0",
                installing: true,
                oninstall: vi.fn(),
                ondismiss: vi.fn(),
            },
        });

        expect(getByRole("button", { name: "Downloading…" })).toBeDisabled();
    });

    it("switches to the relaunch action after installation", () => {
        const { getByRole, getByText } = render(UpdateBanner, {
            props: {
                version: "0.23.0",
                ready: true,
                oninstall: vi.fn(),
                ondismiss: vi.fn(),
            },
        });

        expect(getByText(/is ready — relaunch to finish/)).toBeInTheDocument();
        expect(getByRole("button", { name: "Relaunch" })).toBeEnabled();
    });
});
