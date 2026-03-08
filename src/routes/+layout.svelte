<!--
    +layout.svelte — Root layout wrapper.

    Imports the global Tailwind CSS stylesheet (app.css) and renders
    the child route via Svelte 5's `@render` snippet. Adds View
    Transitions API support for directional slide animations between
    the editor and library routes.
-->
<script>
import "../app.css";
import { onNavigate } from "$app/navigation";

const { children } = $props();

onNavigate((navigation) => {
    if (!document.startViewTransition) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    return new Promise((resolve) => {
        document.startViewTransition(async () => {
            resolve();
            await navigation.complete;
        });
    });
});
</script>

{@render children()}

<style>
    @keyframes slide-from-right {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slide-to-left {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(-100%); opacity: 0; }
    }
    @keyframes slide-from-left {
        from { transform: translateX(-100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slide-to-right {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
    }

    :global(html[data-direction="left"]) :global(::view-transition-old(root)) {
        animation: slide-to-left 0.3s ease both;
    }
    :global(html[data-direction="left"]) :global(::view-transition-new(root)) {
        animation: slide-from-right 0.3s ease both;
    }
    :global(html[data-direction="right"]) :global(::view-transition-old(root)) {
        animation: slide-to-right 0.3s ease both;
    }
    :global(html[data-direction="right"]) :global(::view-transition-new(root)) {
        animation: slide-from-left 0.3s ease both;
    }

    @media (prefers-reduced-motion: reduce) {
        :global(::view-transition-old(root)),
        :global(::view-transition-new(root)) {
            animation: none !important;
        }
    }
</style>
