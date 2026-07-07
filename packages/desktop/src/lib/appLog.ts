/**
 * appLog.ts — Lightweight bridge to the persistent native app log.
 *
 * The Rust side writes JSONL records under the app data directory. Frontend
 * callers use this only for diagnostics; failures are intentionally ignored so
 * logging cannot break user actions or crash recovery.
 */

import { invoke } from "@tauri-apps/api/core";

export type AppLogLevel = "debug" | "info" | "warn" | "error";

function stringifyDetails(details: unknown): string | undefined {
    if (details === undefined) return undefined;
    if (typeof details === "string") return details;
    try {
        return JSON.stringify(details);
    } catch {
        return String(details);
    }
}

export async function logAppEvent(
    level: AppLogLevel,
    target: string,
    message: string,
    details?: unknown,
): Promise<void> {
    try {
        await invoke("cmd_log_app_event", {
            level,
            target,
            message,
            details: stringifyDetails(details),
        });
    } catch {
        // Best-effort diagnostics only.
    }
}

export async function readAppLog(): Promise<string> {
    return invoke<string>("cmd_read_app_log");
}

export async function clearAppLog(): Promise<void> {
    await invoke("cmd_clear_app_log");
}

export async function appLogPath(): Promise<string> {
    return invoke<string>("cmd_app_log_path");
}
