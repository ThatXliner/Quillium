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
import ErrorBanner from "$lib/ErrorBanner.svelte";
import { readBackup, saveEmergencyBackup, saveEmergencySnapshot } from "$lib/errorGuard";
import posthog from "$lib/posthog";
import { errorBanner } from "$lib/stores";

const { children } = $props();

onNavigate((navigation) => {
    if (!document.startViewTransition) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    return new Promise((resolve) => {
        const transition = document.startViewTransition(async () => {
            resolve();
            await navigation.complete;
        });
        transition.finished.catch(() => {});
    });
});
</script>

<!-- Banner lives outside the boundary so it survives component tree errors -->
<ErrorBanner />

<svelte:boundary
    onerror={(error) => {
        saveEmergencyBackup(`Svelte component error: ${error instanceof Error ? error.message : String(error)}`);
        saveEmergencySnapshot("Before crash (auto)");
        const hasCrashBackup = Boolean(readBackup("crash"));
        const err = error instanceof Error ? error : new Error(String(error));
        const stack = err.stack ?? err.message;
        const details = stack.startsWith(err.name) ? stack : `${err.name}: ${err.message}\n${stack}`;
        errorBanner.set({
            message: hasCrashBackup
                ? "Something went wrong. Your work has been backed up."
                : "Something went wrong.",
            hasBackup: hasCrashBackup,
            backupType: "crash",
            details,
        });
        posthog.captureException(err);
    }}
>
    {@render children()}
</svelte:boundary>

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
