import { goto } from "$app/navigation";
import posthog from "$lib/posthog";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { deregisterOpenDoc } from "$lib/db";

export function goToLibrary(): Promise<void> {
    document.documentElement.setAttribute("data-direction", "left");
    posthog.capture("navigated_to_library");
    deregisterOpenDoc(getCurrentWebviewWindow().label).catch(console.error);
    return goto("/library");
}

export function goToHistory(): Promise<void> {
    document.documentElement.setAttribute("data-direction", "left");
    posthog.capture("navigated_to_history");
    return goto("/history");
}

export function goToEditor(): Promise<void> {
    document.documentElement.setAttribute("data-direction", "right");
    posthog.capture("navigated_to_editor");
    return goto("/");
}
