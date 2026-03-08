import { goto } from "$app/navigation";

export function goToLibrary() {
    document.documentElement.setAttribute("data-direction", "left");
    goto("/library");
}

export function goToEditor() {
    document.documentElement.setAttribute("data-direction", "right");
    goto("/");
}
