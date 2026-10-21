// startup.ts — Local startup evidence, independent of auth and update networking.
import { writable } from "svelte/store";
export const localStartup = writable<"pending" | "ready" | "failed">("pending");
let failed = false;
export function markLocalStartupReady(): void {
    if (!failed) localStartup.set("ready");
}
export function markLocalStartupFailed(): void {
    failed = true;
    localStartup.set("failed");
}
