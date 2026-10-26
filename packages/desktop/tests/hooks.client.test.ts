import { PersistenceError } from "$lib/editor/persistenceError";
import { errorBanner } from "$lib/stores";
import { get } from "svelte/store";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { saveEmergencyBackup, saveEmergencySnapshot } = vi.hoisted(() => ({
    saveEmergencyBackup: vi.fn(),
    saveEmergencySnapshot: vi.fn(),
}));

vi.mock("$lib/appLog", () => ({ logAppEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("$lib/errorGuard", () => ({
    readBackup: vi.fn(),
    saveEmergencyBackup,
    saveEmergencySnapshot,
}));
vi.mock("$lib/posthog", () => ({ default: { captureException: vi.fn() } }));

beforeAll(async () => {
    await import("../src/hooks.client");
});

beforeEach(() => {
    vi.clearAllMocks();
    errorBanner.set(null);
});

function reject(reason: Error): Event {
    const event = new Event("unhandledrejection", { cancelable: true });
    Object.defineProperty(event, "reason", { value: reason });
    window.dispatchEvent(event);
    return event;
}

describe("unhandled navigation rejection", () => {
    it("keeps a refused persistence transition out of crash snapshot recovery", () => {
        const error = new PersistenceError(new Error("disk full"));
        const banner = { message: error.message, hasBackup: false, backupType: "auto" as const };
        errorBanner.set(banner);
        const event = reject(error);
        expect(event.defaultPrevented).toBe(true);
        expect(get(errorBanner)).toEqual(banner);
        expect(saveEmergencyBackup).not.toHaveBeenCalled();
        expect(saveEmergencySnapshot).not.toHaveBeenCalled();
    });

    it("still backs up unexpected failures", () => {
        reject(new Error("unexpected crash"));
        expect(saveEmergencyBackup).toHaveBeenCalledOnce();
        expect(saveEmergencySnapshot).toHaveBeenCalledOnce();
    });
});
