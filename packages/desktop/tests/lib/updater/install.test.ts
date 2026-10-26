import {
    classifyUpdateInstallError,
    isMacDiskImagePath,
    performUpdateInstall,
    updateFailureDescription,
} from "$lib/updater/install";
import { describe, expect, it, vi } from "vitest";

describe("performUpdateInstall", () => {
    it("blocks updates launched from a mounted macOS disk image", async () => {
        const checkForUpdate = vi.fn();
        const result = await performUpdateInstall({
            ready: false,
            checkForUpdate,
            relaunchApp: vi.fn(),
            getExecutableDir: vi.fn(async () => "/Volumes/Quillium/Quillium.app/Contents/MacOS"),
        });

        expect(result).toMatchObject({
            status: "failed",
            failure: { kind: "disk-image" },
        });
        expect(checkForUpdate).not.toHaveBeenCalled();
    });

    it("downloads and installs an available update", async () => {
        const downloadAndInstall = vi.fn(async () => {});
        const result = await performUpdateInstall({
            ready: false,
            checkForUpdate: vi.fn(async () => ({ downloadAndInstall })),
            relaunchApp: vi.fn(),
            getExecutableDir: vi.fn(async () => "/Applications/Quillium.app/Contents/MacOS"),
        });

        expect(result).toEqual({ status: "ready" });
        expect(downloadAndInstall).toHaveBeenCalledTimes(1);
    });

    it("relaunches a previously installed update without checking again", async () => {
        const checkForUpdate = vi.fn();
        const relaunchApp = vi.fn(async () => {});
        const result = await performUpdateInstall({
            ready: true,
            checkForUpdate,
            relaunchApp,
            getExecutableDir: vi.fn(),
        });

        expect(result).toEqual({ status: "relaunched" });
        expect(relaunchApp).toHaveBeenCalledTimes(1);
        expect(checkForUpdate).not.toHaveBeenCalled();
    });

    it("reports when an advertised update is no longer available", async () => {
        const result = await performUpdateInstall({
            ready: false,
            checkForUpdate: vi.fn(async () => null),
            relaunchApp: vi.fn(),
            getExecutableDir: vi.fn(async () => "/Applications/Quillium.app/Contents/MacOS"),
        });

        expect(result).toEqual({ status: "not-available" });
    });

    it("does not block installation when executable location detection is unavailable", async () => {
        const downloadAndInstall = vi.fn(async () => {});
        const result = await performUpdateInstall({
            ready: false,
            checkForUpdate: vi.fn(async () => ({ downloadAndInstall })),
            relaunchApp: vi.fn(),
            getExecutableDir: vi.fn(async () => {
                throw new Error("path API unavailable");
            }),
        });

        expect(result).toEqual({ status: "ready" });
        expect(downloadAndInstall).toHaveBeenCalledTimes(1);
    });

    it("returns an actionable failure instead of throwing install errors", async () => {
        const result = await performUpdateInstall({
            ready: false,
            checkForUpdate: vi.fn(async () => ({
                downloadAndInstall: vi.fn(async () => {
                    throw new Error("Cross-device link while moving current app");
                }),
            })),
            relaunchApp: vi.fn(),
            getExecutableDir: vi.fn(async () => "/Applications/Quillium.app/Contents/MacOS"),
        });

        expect(result).toMatchObject({
            status: "failed",
            failure: { kind: "permission" },
        });
    });
});

describe("updater failure classification", () => {
    it.each([
        ["Permission denied while replacing app", "permission"],
        ["connection timed out while downloading", "network"],
        ["The signature verification failed", "signature"],
        ["something surprising happened", "unknown"],
    ] as const)("classifies %s as %s", (message, kind) => {
        expect(classifyUpdateInstallError(message).kind).toBe(kind);
    });

    it("provides disk-image installation instructions", () => {
        const description = updateFailureDescription({
            kind: "disk-image",
            technicalMessage: "mounted under /Volumes",
        });

        expect(description).toContain("Drag it to Applications");
        expect(description).toContain("open Quillium from Applications");
    });
});

describe("isMacDiskImagePath", () => {
    it("only matches mounted volume paths", () => {
        expect(isMacDiskImagePath("/Volumes/Quillium/Quillium.app/Contents/MacOS")).toBe(true);
        expect(isMacDiskImagePath("/Applications/Quillium.app/Contents/MacOS")).toBe(false);
        expect(isMacDiskImagePath("C:\\Program Files\\Quillium")).toBe(false);
    });
});
