import { goto } from "$app/navigation";
import posthog from "$lib/posthog";

export function goToLibrary(): Promise<void> {
    document.documentElement.setAttribute("data-direction", "left");
    posthog.capture("navigated_to_library");
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
