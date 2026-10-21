import { updateSettings } from "$lib/settings.svelte";
import FrontendUpdateBanner from "$lib/updater/FrontendUpdateBanner.svelte";
import {
    checkFrontendUpdate,
    downloadFrontendUpdate,
    frontendUpdateStatus,
    restartForUpdate,
} from "$lib/updater/lifecycle";
import { nativeUpdateVisible } from "$lib/updater/visibility";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("$lib/updater/lifecycle", () => ({
    checkFrontendUpdate: vi.fn(),
    downloadFrontendUpdate: vi.fn(),
    frontendUpdateStatus: vi.fn(),
    restartForUpdate: vi.fn(),
}));

beforeEach(() => {
    updateSettings({ checkForUpdates: true });
    nativeUpdateVisible.set(false);
    vi.mocked(frontendUpdateStatus).mockResolvedValue({
        enabled: true,
        source: "embedded",
        nativeVersion: "0.25.0",
        frontendVersion: "0.25.0",
        stagedVersion: null,
        blockedReason: null,
    });
    vi.mocked(checkFrontendUpdate).mockResolvedValue({
        status: "available",
        version: "0.25.0-ui.1",
    });
    vi.mocked(downloadFrontendUpdate).mockResolvedValue({
        status: "staged",
        version: "0.25.0-ui.1",
    });
    vi.mocked(restartForUpdate).mockResolvedValue(undefined);
});
afterEach(() => {
    cleanup();
    vi.resetAllMocks();
    nativeUpdateVisible.set(false);
});

describe("frontend update notice", () => {
    it("stages a signed frontend before offering the coordinated relaunch", async () => {
        const { getByRole } = render(FrontendUpdateBanner);
        await waitFor(() => expect(getByRole("button", { name: "Update" })).toBeEnabled());
        await fireEvent.click(getByRole("button", { name: "Update" }));
        await waitFor(() => expect(getByRole("button", { name: "Relaunch" })).toBeEnabled());
        expect(downloadFrontendUpdate).toHaveBeenCalledOnce();
        expect(restartForUpdate).not.toHaveBeenCalled();
        await fireEvent.click(getByRole("button", { name: "Relaunch" }));
        expect(restartForUpdate).toHaveBeenCalledOnce();
    });

    it("keeps save failure visible and yields to a native update notice", async () => {
        vi.mocked(frontendUpdateStatus).mockResolvedValue({
            enabled: true,
            source: "embedded",
            nativeVersion: "0.25.0",
            frontendVersion: "0.25.0",
            stagedVersion: "0.25.0-ui.1",
            blockedReason: null,
        });
        vi.mocked(restartForUpdate).mockRejectedValue(new Error("save failed"));
        const { getByRole, queryByRole } = render(FrontendUpdateBanner);
        await waitFor(() => expect(getByRole("button", { name: "Relaunch" })).toBeEnabled());
        await fireEvent.click(getByRole("button", { name: "Relaunch" }));
        await waitFor(() => expect(getByRole("alert")).toHaveTextContent("could not be saved"));
        nativeUpdateVisible.set(true);
        await waitFor(() =>
            expect(queryByRole("button", { name: "Relaunch" })).not.toBeInTheDocument(),
        );
    });
});
