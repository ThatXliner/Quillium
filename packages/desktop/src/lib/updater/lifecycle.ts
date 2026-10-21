import { collabSession, collabState } from "$lib/collab/store";
import { flushPersistenceForRestart } from "$lib/editor/listeners";
import { flushNestedEditorsForRestart } from "$lib/editor/plugins/annotations/NestedEditorController";
// lifecycle.ts — Quillium's per-window update readiness and save protocol.
import { appEventBus } from "$lib/events/appEventBus";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { type UnlistenFn, listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { tick } from "svelte";
import { get } from "svelte/store";
import { z } from "zod";
import {
    beginRestart,
    cancelRestart,
    drainDatabaseWrites,
    flushNestedForRestart,
    flushRestartParticipants,
} from "./restartState";
import { localStartup } from "./startup";

const AttemptSchema = z.object({ attemptId: z.string().min(1) });
export const OtaResultSchema = z.discriminatedUnion("status", [
    z.object({ status: z.literal("available"), version: z.string() }),
    z.object({ status: z.literal("staged"), version: z.string() }),
    z.object({ status: z.literal("current") }),
    z.object({ status: z.literal("disabled") }),
    z.object({ status: z.literal("refused"), reason: z.string() }),
]);
export const OtaStatusSchema = z.object({
    enabled: z.boolean(),
    nativeVersion: z.string(),
    frontendVersion: z.string(),
    source: z.enum(["embedded", "ota"]),
    stagedVersion: z.string().nullable(),
    blockedReason: z.string().nullable(),
});
export async function checkFrontendUpdate(): Promise<z.infer<typeof OtaResultSchema>> {
    return OtaResultSchema.parse(await invoke<unknown>("cmd_ota_check"));
}
export async function downloadFrontendUpdate(): Promise<z.infer<typeof OtaResultSchema>> {
    return OtaResultSchema.parse(await invoke<unknown>("cmd_ota_download"));
}
export async function frontendUpdateStatus(): Promise<z.infer<typeof OtaStatusSchema>> {
    return OtaStatusSchema.parse(await invoke<unknown>("cmd_ota_status"));
}
export function prepareNativeInstall(): Promise<string> {
    return invoke<string>("cmd_update_prepare");
}
export function cancelNativeInstall(attemptId: string): Promise<void> {
    return invoke<void>("cmd_update_cancel", { attemptId });
}
export function restartForUpdate(): Promise<void> {
    return invoke<void>("cmd_update_restart");
}

export async function prepareWindowForRestart(attemptId: string): Promise<void> {
    if (get(collabSession) || get(collabState) !== "disconnected") {
        await invoke<void>("cmd_update_save_result", {
            attemptId,
            error: "Leave the live writing session before restarting.",
        });
        return;
    }
    if (!beginRestart(attemptId)) return;
    let error: string | null = null;
    try {
        appEventBus.emit({ type: "stop-ai" });
        await flushRestartParticipants();
        flushNestedForRestart(flushNestedEditorsForRestart);
        await drainDatabaseWrites();
        await flushPersistenceForRestart();
        await drainDatabaseWrites();
    } catch {
        // The bridge must never carry document text from a failed persistence operation.
        error = "This window could not save all changes. Restart was cancelled.";
    }
    await invoke<void>("cmd_update_save_result", { attemptId, error });
}

export function startUpdateLifecycle(): () => void {
    if (!isTauri()) return () => {};
    let disposed = false;
    const stops: UnlistenFn[] = [];
    const bind = async (event: "update:prepare" | "update:cancel"): Promise<void> => {
        const stop = await listen<unknown>(event, ({ payload }) => {
            const parsed = AttemptSchema.safeParse(payload);
            if (!parsed.success || disposed) return;
            if (event === "update:cancel") cancelRestart(parsed.data.attemptId);
            else
                void prepareWindowForRestart(parsed.data.attemptId).catch((error) => {
                    console.error("[updater] save acknowledgement failed", error);
                });
        });
        if (disposed) stop();
        else stops.push(stop);
    };
    const listenersReady = Promise.all([bind("update:prepare"), bind("update:cancel")]);
    void listenersReady.catch((error) => {
        console.error("[updater] save listener registration failed", error);
    });
    let confirming = false;
    const unsubscribe = localStartup.subscribe((status) => {
        if (status !== "ready" || confirming || getCurrentWebviewWindow().label !== "main") return;
        confirming = true;
        void tick()
            .then(async () => {
                await listenersReady;
                if (!disposed && get(localStartup) === "ready") await invoke("cmd_ota_ready");
            })
            .catch((error) => console.error("[updater] startup confirmation failed", error));
    });
    return () => {
        disposed = true;
        unsubscribe();
        for (const stop of stops) stop();
    };
}
