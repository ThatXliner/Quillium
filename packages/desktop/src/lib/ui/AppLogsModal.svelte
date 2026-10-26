<!--
    AppLogsModal.svelte — User-facing viewer for the persistent native app log.

    Props:
      ondismiss — called when the user closes the modal
-->
<script lang="ts">
import { appLogPath, clearAppLog, logAppEvent, readAppLog } from "$lib/appLog";
import { FEEDBACK_FORM_URL } from "$lib/constants";
import { ModalResizeHandles, RestoreSizeButton } from "@quillium/share";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Bug, Check, Copy, RefreshCw, Trash2, X } from "lucide-svelte";
import { onMount } from "svelte";
import { toast } from "svelte-sonner";

const { ondismiss }: { ondismiss: () => void } = $props();

let loading = $state(false);
let copied = $state(false);
let logText = $state("");
let logPath = $state("");
let logSize = $derived(new TextEncoder().encode(logText).byteLength);

function formatBytes(bytes: number): string {
    if (bytes < 1_000) return `${bytes} B`;
    if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(1)} KB`;
    return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function diagnosticReport(): string {
    return [
        "Quillium diagnostic log",
        `App version: ${typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev"}`,
        `Platform: ${navigator.platform || "Unavailable"}`,
        `User agent: ${navigator.userAgent || "Unavailable"}`,
        `Generated: ${new Date().toISOString()}`,
        `Log path: ${logPath || "Unavailable"}`,
        "",
        logText.trim() || "No app log entries were available.",
    ].join("\n");
}

async function refreshLogs(): Promise<void> {
    loading = true;
    try {
        const [path, text] = await Promise.all([appLogPath(), readAppLog()]);
        logPath = path;
        logText = text;
    } catch (error) {
        console.error("[appLogs] failed to read app log", error);
        toast.error("Could not read app logs", {
            description: error instanceof Error ? error.message : String(error),
        });
    } finally {
        loading = false;
    }
}

async function copyLogs(): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(diagnosticReport());
        copied = true;
        window.setTimeout(() => {
            copied = false;
        }, 1400);
        return true;
    } catch (error) {
        console.error("[appLogs] failed to copy app log", error);
        toast.error("Could not copy app logs");
        return false;
    }
}

async function reportIssue(): Promise<void> {
    if (!(await copyLogs())) return;
    toast.success("Diagnostic log copied", {
        description: "Paste it into the bug report after reviewing it.",
    });
    try {
        await openUrl(FEEDBACK_FORM_URL);
    } catch (error) {
        console.error("[appLogs] failed to open bug report", error);
        toast.error("Could not open the bug report form");
    }
}

async function clearLogs(): Promise<void> {
    try {
        await clearAppLog();
        logText = "";
        await logAppEvent("info", "frontend", "app log cleared from viewer");
    } catch (error) {
        console.error("[appLogs] failed to clear app log", error);
        toast.error("Could not clear app logs");
    }
}

function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") ondismiss();
}

onMount(() => {
    void refreshLogs();
});

let restoreSize = $state<(() => void) | undefined>();
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="fixed inset-0 z-[9999]" role="dialog" aria-modal="true" aria-label="App Logs">
    <button
        type="button"
        class="absolute inset-0 bg-black/55 border-0 p-0 cursor-default"
        aria-label="Close"
        tabindex="-1"
        onclick={ondismiss}
    ></button>

    <div
        class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
            w-[760px] max-w-[calc(100vw-2rem)] max-h-[82vh] bg-white shadow-2xl
            rounded-2xl flex flex-col overflow-hidden border border-black/[0.06]"
        role="document"
    >
        <div class="flex items-start justify-between gap-5 px-7 pt-7 pb-4 shrink-0">
            <div class="min-w-0">
                <h3 class="text-xl font-bold text-black/85 leading-tight">App Logs</h3>
                <p class="text-xs text-black/35 mt-1 truncate">
                    {logPath || "Loading log path"}{logText ? ` · ${formatBytes(logSize)}` : ""}
                </p>
            </div>
            <div class="flex items-center gap-2 shrink-0">
                <button
                    type="button"
                    onclick={refreshLogs}
                    aria-label="Refresh logs"
                    title="Refresh logs"
                    disabled={loading}
                    class="flex items-center justify-center w-8 h-8 rounded-lg bg-black/[0.05]
                        text-black/40 hover:text-black/65 hover:bg-black/[0.1]
                        disabled:opacity-45 transition-colors"
                >
                    <RefreshCw size={16} class={loading ? "animate-spin" : ""} />
                </button>
                <button
                    type="button"
                    onclick={copyLogs}
                    aria-label="Copy logs"
                    title="Copy logs"
                    class="flex items-center justify-center w-8 h-8 rounded-lg bg-black/[0.05]
                        text-black/40 hover:text-black/65 hover:bg-black/[0.1] transition-colors"
                >
                    {#if copied}
                        <Check size={16} />
                    {:else}
                        <Copy size={16} />
                    {/if}
                </button>
                <button
                    type="button"
                    onclick={clearLogs}
                    aria-label="Clear logs"
                    title="Clear logs"
                    class="flex items-center justify-center w-8 h-8 rounded-lg bg-black/[0.05]
                        text-black/40 hover:text-red-600 hover:bg-red-50 transition-colors"
                >
                    <Trash2 size={16} />
                </button>
                <RestoreSizeButton {restoreSize} />
                <button
                    type="button"
                    onclick={ondismiss}
                    aria-label="Close"
                    title="Close"
                    class="flex items-center justify-center w-8 h-8 rounded-lg bg-black/[0.05]
                        text-black/40 hover:text-black/65 hover:bg-black/[0.1] transition-colors"
                >
                    <X size={16} />
                </button>
            </div>
        </div>

        <div class="flex flex-col flex-1 min-h-0 px-7 pb-7">
            <pre
                aria-busy={loading}
                class="h-[54vh] min-h-0 flex-1 overflow-auto rounded-lg
                    border border-black/[0.08] bg-neutral-950 text-neutral-100 p-4
                    text-[11px] leading-relaxed whitespace-pre-wrap break-words font-mono"
            >{logText.trim() || (loading ? "Loading logs..." : "No app log entries yet.")}</pre>
            <div class="shrink-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3 mt-4">
                <p class="text-[11px] leading-relaxed text-black/40 max-w-[470px]">
                    Includes console output, errors, app lifecycle events, and the previous rotated
                    log. It may contain file paths or values printed during a failure, so review it
                    before sharing.
                </p>
                <button
                    type="button"
                    onclick={reportIssue}
                    class="shrink-0 inline-flex items-center justify-center gap-2 rounded-lg
                        bg-rose-500 px-3.5 py-2 text-xs font-semibold text-white
                        hover:bg-rose-600 transition-colors"
                >
                    <Bug size={14} />
                    Copy & report bug
                </button>
            </div>
        </div>
        <ModalResizeHandles bind:restoreSize />
    </div>
</div>
