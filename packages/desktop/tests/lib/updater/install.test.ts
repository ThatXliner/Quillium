import {
    classifyUpdateInstallError,
    isMacDiskImagePath,
    performUpdateInstall,
    updateFailureDescription,
} from "$lib/updater/install";
import { describe, expect, it, vi } from "vitest";

describe("performUpdateInstall", () => {
    it("downloads before freezing every window and installing", async () => {
        const order: string[] = [];
        const result = await performUpdateInstall({
            ready: false,
            checkForUpdate: async () => ({
                download: async () => {
                    order.push("download");
                },
                install: async () => {
                    order.push("install");
                },
            }),
            prepareInstall: async () => {
                order.push("prepare");
                return "attempt";
            },
            cancelInstall: async (attemptId) => {
                order.push(`cancel:${attemptId}`);
            },
            relaunchApp: vi.fn(),
            getExecutableDir: async () => "/Applications/Quillium.app/Contents/MacOS",
        });
        expect(result).toEqual({ status: "ready" });
        expect(order).toEqual(["download", "prepare", "install", "cancel:attempt"]);
    });

    it("does not start the native installer when a window cannot save", async () => {
        const install = vi.fn(async () => {});
        const cancelInstall = vi.fn(async () => {});
        const result = await performUpdateInstall({
            ready: false,
            checkForUpdate: async () => ({ download: async () => {}, install }),
            prepareInstall: async () => {
                throw new Error("Could not save all windows");
            },
            cancelInstall,
            relaunchApp: vi.fn(),
            getExecutableDir: async () => "/Applications/Quillium.app/Contents/MacOS",
        });
        expect(result.status).toBe("failed");
        expect(install).not.toHaveBeenCalled();
        expect(cancelInstall).not.toHaveBeenCalled();
    });

    it("releases the window freeze after the native installer fails", async () => {
        const cancelInstall = vi.fn(async () => {});
        const result = await performUpdateInstall({
            ready: false,
            checkForUpdate: async () => ({
                download: async () => {},
                install: async () => {
                    throw new Error("permission denied");
                },
            }),
            prepareInstall: async () => "attempt",
            cancelInstall,
            relaunchApp: vi.fn(),
            getExecutableDir: async () => "/Applications/Quillium.app/Contents/MacOS",
        });
        expect(result).toMatchObject({ status: "failed", failure: { kind: "permission" } });
        expect(cancelInstall).toHaveBeenCalledWith("attempt");
    });

    it("blocks updates launched from a mounted macOS disk image", async () => {
        const checkForUpdate = vi.fn();
        const result = await performUpdateInstall({
            prepareInstall: vi.fn(async () => "attempt"),
            cancelInstall: vi.fn(async () => {}),
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
        const install = vi.fn(async () => {});
        const result = await performUpdateInstall({
            prepareInstall: vi.fn(async () => "attempt"),
            cancelInstall: vi.fn(async () => {}),
            ready: false,
            checkForUpdate: vi.fn(async () => ({ download: vi.fn(async () => {}), install })),
            relaunchApp: vi.fn(),
            getExecutableDir: vi.fn(async () => "/Applications/Quillium.app/Contents/MacOS"),
        });

        expect(result).toEqual({ status: "ready" });
        expect(install).toHaveBeenCalledTimes(1);
    });

    it("relaunches a previously installed update without checking again", async () => {
        const checkForUpdate = vi.fn();
        const relaunchApp = vi.fn(async () => {});
        const result = await performUpdateInstall({
            prepareInstall: vi.fn(async () => "attempt"),
            cancelInstall: vi.fn(async () => {}),
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
            prepareInstall: vi.fn(async () => "attempt"),
            cancelInstall: vi.fn(async () => {}),
            ready: false,
            checkForUpdate: vi.fn(async () => null),
            relaunchApp: vi.fn(),
            getExecutableDir: vi.fn(async () => "/Applications/Quillium.app/Contents/MacOS"),
        });

        expect(result).toEqual({ status: "not-available" });
    });

    it("does not block installation when executable location detection is unavailable", async () => {
        const install = vi.fn(async () => {});
        const result = await performUpdateInstall({
            prepareInstall: vi.fn(async () => "attempt"),
            cancelInstall: vi.fn(async () => {}),
            ready: false,
            checkForUpdate: vi.fn(async () => ({ download: vi.fn(async () => {}), install })),
            relaunchApp: vi.fn(),
            getExecutableDir: vi.fn(async () => {
                throw new Error("path API unavailable");
            }),
        });

        expect(result).toEqual({ status: "ready" });
        expect(install).toHaveBeenCalledTimes(1);
    });

    it("returns an actionable failure instead of throwing install errors", async () => {
        const result = await performUpdateInstall({
            prepareInstall: vi.fn(async () => "attempt"),
            cancelInstall: vi.fn(async () => {}),
            ready: false,
            checkForUpdate: vi.fn(async () => ({
                download: vi.fn(async () => {}),
                install: vi.fn(async () => {
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
