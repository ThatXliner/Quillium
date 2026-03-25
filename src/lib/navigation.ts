import { goto } from "$app/navigation";

export function goToLibrary(): Promise<void> {
    document.documentElement.setAttribute("data-direction", "left");
    return goto("/library");
}

export function goToHistory(): Promise<void> {
    document.documentElement.setAttribute("data-direction", "left");
    return goto("/history");
}

export function goToEditor(): Promise<void> {
    document.documentElement.setAttribute("data-direction", "right");
    return goto("/");
}
