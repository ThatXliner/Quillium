import { logAppEvent } from "$lib/appLog";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { flushPersistence, flushPersistenceForClose } from "./listeners";

export function startPersistenceLifecycle(): () => void {
    let disposed = false;
    let closing = false;
    const cleanup: Array<() => void> = [];
    const reportFailure = (error: unknown): void => {
        console.error("[persistenceLifecycle] checkpoint failed", error);
        void logAppEvent("error", "persistence", "lifecycle checkpoint failed", {
            error: error instanceof Error ? error.message : String(error),
        });
    };
    const background = (): void => {
        void flushPersistence().catch(reportFailure);
    };
    const visibilityChanged = (): void => {
        if (document.visibilityState === "hidden") background();
    };
    document.addEventListener("visibilitychange", visibilityChanged);
    cleanup.push(() => document.removeEventListener("visibilitychange", visibilityChanged));

    if (isTauri()) {
        const window = getCurrentWindow();
        const register = async (registration: Promise<() => void>): Promise<void> => {
            const stop = await registration;
            if (disposed) stop();
            else cleanup.push(stop);
        };
        void register(
            window.onFocusChanged(({ payload: focused }) => {
                if (!disposed && !focused) background();
            }),
        ).catch(reportFailure);
        void register(
            window.onCloseRequested(async (event) => {
                if (disposed) return;
                if (closing) {
                    event.preventDefault();
                    return;
                }
                closing = true;
                try {
                    await flushPersistenceForClose();
                } catch (error) {
                    closing = false;
                    event.preventDefault();
                    reportFailure(error);
                }
            }),
        ).catch(reportFailure);
    }

    return () => {
        disposed = true;
        for (const stop of cleanup) stop();
    };
}
