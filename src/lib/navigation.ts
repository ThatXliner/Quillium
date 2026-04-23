import { goto } from "$app/navigation";
import { flushMetaDebounces, flushPersistQueue } from "$lib/editor/listeners";
import posthog from "$lib/posthog";

async function flushPending(): Promise<void> {
    flushMetaDebounces();
    await flushPersistQueue();
}

export async function goToLibrary(): Promise<void> {
    document.documentElement.setAttribute("data-direction", "left");
    posthog.capture("navigated_to_library");
    await flushPending();
    return goto("/library");
}

export async function goToHistory(): Promise<void> {
    document.documentElement.setAttribute("data-direction", "left");
    posthog.capture("navigated_to_history");
    await flushPending();
    return goto("/history");
}

export function goToEditor(): Promise<void> {
    document.documentElement.setAttribute("data-direction", "right");
    posthog.capture("navigated_to_editor");
    return goto("/");
}
