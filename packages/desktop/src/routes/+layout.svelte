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
import { logAppEvent } from "$lib/appLog";
import { readBackup, saveEmergencyBackup, saveEmergencySnapshot } from "$lib/errorGuard";
import { novelNovemberEnabled, startFeatureFlagSync } from "$lib/featureFlags.svelte";
import posthog from "$lib/posthog";
import { editorView, errorBanner } from "$lib/stores";
import AppLogsModal from "$lib/ui/AppLogsModal.svelte";
import {
    setWritingReminderFeatureEnabled,
    startWritingReminderService,
} from "$lib/writingReminders";
import { listen } from "@tauri-apps/api/event";
import { onMount } from "svelte";
import { Toaster } from "svelte-sonner";

const { children } = $props();

// The logs viewer lives in the layout (not the editor page) so the
// App Logs… menu item works on every route — it used to silently do
// nothing on Library/History, hiding logs exactly when they were
// needed to diagnose a broken state.
let appLogsOpen = $state(false);

$effect(() => setWritingReminderFeatureEnabled($novelNovemberEnabled));

onMount(() => {
    let destroyed = false;
    /** @type {(() => void) | undefined} */
    let unlisten;
    listen("menu:app-logs", () => {
        if (!destroyed) {
            void logAppEvent("info", "diagnostics", "app log viewer opened");
            appLogsOpen = true;
        }
    }).then((u) => {
        if (destroyed) u();
        else unlisten = u;
    });
    return () => {
        destroyed = true;
        unlisten?.();
    };
});

onMount(() => {
    const stopReminders = startWritingReminderService();
    const stopFlags = startFeatureFlagSync();
    return () => {
        stopFlags();
        stopReminders();
    };
});

onNavigate((navigation) => {
    void logAppEvent("info", "navigation", "navigation started", {
        from: navigation.from?.url.pathname,
        to: navigation.to?.url.pathname,
        type: navigation.type,
    });
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
<Toaster position="bottom-right" />

<!-- Logs viewer also outside the boundary: it must stay reachable when a
     page has crashed — that's precisely when the logs matter. -->
{#if appLogsOpen}
    <AppLogsModal
        ondismiss={() => {
            appLogsOpen = false;
            // No-op off the editor route (detached views ignore focus).
            $editorView?.focus();
        }}
    />
{/if}

<svelte:boundary
    onerror={(error) => {
        saveEmergencyBackup(`Svelte component error: ${error instanceof Error ? error.message : String(error)}`);
        saveEmergencySnapshot("Before crash (auto)");
        const hasCrashBackup = Boolean(readBackup("crash"));
        const err = error instanceof Error ? error : new Error(String(error));
        const stack = err.stack ?? err.message;
        const details = stack.startsWith(err.name) ? stack : `${err.name}: ${err.message}\n${stack}`;
        void logAppEvent("error", "frontend", "svelte component boundary error", {
            name: err.name,
            message: err.message,
            stack: details,
        });
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
