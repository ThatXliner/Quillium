import { goto } from "$app/navigation";
import { deregisterOpenDoc } from "$lib/db";
import { flushMetaDebounces, flushPersistQueue } from "$lib/editor/listeners";
import posthog from "$lib/posthog";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

async function flushPending(): Promise<void> {
    flushMetaDebounces();
    await flushPersistQueue();
}

export async function goToLibrary(): Promise<void> {
    document.documentElement.setAttribute("data-direction", "left");
    posthog.capture("navigated_to_library");
    deregisterOpenDoc(getCurrentWebviewWindow().label).catch(console.error);
    await flushPending();
    return goto("/library");
}

export async function goToHistory(): Promise<void> {
    document.documentElement.setAttribute("data-direction", "left");
    posthog.capture("navigated_to_history");
    await flushPending();
    return goto("/history");
}

export async function goToAuthorship(): Promise<void> {
    document.documentElement.setAttribute("data-direction", "left");
    posthog.capture("navigated_to_authorship");
    await flushPending();
    return goto("/authorship");
}

export function goToEditor(): Promise<void> {
    document.documentElement.setAttribute("data-direction", "right");
    posthog.capture("navigated_to_editor");
    return goto("/");
}
