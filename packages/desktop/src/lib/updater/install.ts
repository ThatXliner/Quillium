/**
 * install.ts — Testable updater installation orchestration.
 *
 * Keeps platform/location checks and failure classification out of the page
 * component so every updater outcome can be covered without a live Tauri app.
 */

import { errorText } from "./errors";

export interface UpdateCandidate {
    downloadAndInstall: () => Promise<void>;
}

export type UpdateInstallFailureKind =
    | "disk-image"
    | "permission"
    | "network"
    | "signature"
    | "unknown";

export interface UpdateInstallFailure {
    kind: UpdateInstallFailureKind;
    technicalMessage: string;
}

export type UpdateInstallResult =
    | { status: "ready" }
    | { status: "relaunched" }
    | { status: "not-available" }
    | { status: "failed"; failure: UpdateInstallFailure };

interface PerformUpdateInstallOptions {
    ready: boolean;
    checkForUpdate: () => Promise<UpdateCandidate | null>;
    relaunchApp: () => Promise<void>;
    getExecutableDir: () => Promise<string>;
}

export function isMacDiskImagePath(path: string): boolean {
    return path === "/Volumes" || path.startsWith("/Volumes/");
}

export function classifyUpdateInstallError(error: unknown): UpdateInstallFailure {
    const technicalMessage = errorText(error);
    const normalized = technicalMessage.toLowerCase();

    if (
        /cross-device|read-only|permission denied|operation not permitted/.test(normalized) ||
        normalized.includes("failed to move the new app into place") ||
        normalized.includes("authentication failed")
    ) {
        return { kind: "permission", technicalMessage };
    }

    if (
        /signature|unexpected key|verification failed|invalid encoding in minisign/.test(normalized)
    ) {
        return { kind: "signature", technicalMessage };
    }

    if (
        /network|timed? out|dns|connection|download|http status|too many requests/.test(normalized)
    ) {
        return { kind: "network", technicalMessage };
    }

    return { kind: "unknown", technicalMessage };
}

export function updateFailureDescription(failure: UpdateInstallFailure): string {
    switch (failure.kind) {
        case "disk-image":
            return "Quillium is running from a disk image. Drag it to Applications, quit this copy, then open Quillium from Applications.";
        case "permission":
            return "Quillium can’t replace this copy. Move it to Applications, reopen it there, and try again.";
        case "network":
            return "The update couldn’t be downloaded. Check your connection and try again.";
        case "signature":
            return "The update couldn’t be verified. Download the latest version manually instead.";
        default:
            return "The update couldn’t be installed. Download the latest version manually or check App Logs for details.";
    }
}

export async function performUpdateInstall({
    ready,
    checkForUpdate,
    relaunchApp,
    getExecutableDir,
}: PerformUpdateInstallOptions): Promise<UpdateInstallResult> {
    try {
        if (ready) {
            await relaunchApp();
            return { status: "relaunched" };
        }

        // A macOS app launched directly from a mounted DMG lives under /Volumes.
        // Tauri must rename the running .app during installation, which cannot
        // cross from that read-only volume to its temporary backup directory.
        try {
            const executableDir = await getExecutableDir();
            if (isMacDiskImagePath(executableDir)) {
                return {
                    status: "failed",
                    failure: {
                        kind: "disk-image",
                        technicalMessage: `Updater blocked for executable directory: ${executableDir}`,
                    },
                };
            }
        } catch {
            // Location detection is a guardrail. The updater remains usable if
            // an older runtime does not expose executableDir().
        }

        const update = await checkForUpdate();
        if (!update) return { status: "not-available" };

        await update.downloadAndInstall();
        return { status: "ready" };
    } catch (error) {
        return { status: "failed", failure: classifyUpdateInstallError(error) };
    }
}
