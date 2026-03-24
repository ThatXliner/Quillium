<script lang="ts">
import {
    X,
    AlertTriangle,
    Download,
    RotateCcw,
    RefreshCw,
    ChevronDown,
    ChevronUp,
} from "lucide-svelte";
import { errorBanner } from "./stores";
import { readBackup, clearBackup } from "./errorGuard";
import type { BackupEntry } from "./errorGuard";
import { FEEDBACK_FORM_URL } from "./constants";
import { openUrl } from "@tauri-apps/plugin-opener";

let showDetails = $state(false);

function dismiss() {
    $errorBanner = null;
    showDetails = false;
}

function downloadBackup() {
    const banner = $errorBanner;
    if (!banner) return;
    const backup: BackupEntry | null = readBackup(banner.backupType);
    if (!backup) return;

    const blob = new Blob([backup.documentText], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const date = new Date(backup.timestamp)
        .toISOString()
        .slice(0, 19)
        .replace("T", "_")
        .replace(/:/g, "-");
    a.download = `${backup.documentTitle || "document"}_backup_${date}.txt`;
    a.click();
    setTimeout(() => {
        URL.revokeObjectURL(url);
    }, 0);
}

function restoreBackup() {
    const banner = $errorBanner;
    if (!banner) return;
    const backup: BackupEntry | null = readBackup(banner.backupType);
    if (!backup) return;

    // Dispatch a custom event that Editor.svelte listens for
    window.dispatchEvent(new CustomEvent("quillium:restore-backup", { detail: backup }));
    clearBackup(banner.backupType);
    $errorBanner = null;
}

function reloadApp() {
    window.location.reload();
}

function reportIssue() {
    openUrl(FEEDBACK_FORM_URL);
}
</script>

{#if $errorBanner}
    <div
        class="fixed top-0 left-0 right-0 z-[9999] flex flex-col bg-amber-50 border-b border-amber-200 shadow-md"
        role="alert"
        aria-live="assertive"
    >
        <div class="flex items-start gap-3 px-4 py-3">
            <AlertTriangle size={18} class="shrink-0 text-amber-600 mt-0.5" />

            <div class="flex-1 min-w-0">
                <p class="text-sm font-medium text-amber-900">
                    {$errorBanner.message}
                </p>
                <p class="text-xs text-amber-700 mt-0.5">
                    {#if $errorBanner.hasBackup}
                        Your writing has been backed up.
                    {/if}
                    <button
                        onclick={reportIssue}
                        class="underline hover:text-amber-900 transition-colors"
                    >
                        Report this issue
                    </button>
                    to help us fix it.
                    {#if $errorBanner.details}
                        <button
                            onclick={() => (showDetails = !showDetails)}
                            class="inline-flex items-center gap-0.5 underline hover:text-amber-900 transition-colors ml-1"
                        >
                            {showDetails ? "Hide" : "Show"} details
                            {#if showDetails}
                                <ChevronUp size={10} />
                            {:else}
                                <ChevronDown size={10} />
                            {/if}
                        </button>
                    {/if}
                </p>
            </div>

            <div class="flex items-center gap-2 shrink-0">
                {#if $errorBanner.hasBackup}
                    <button
                        onclick={downloadBackup}
                        title="Download your writing as plain text"
                        class="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-amber-800 bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded-md transition-colors"
                    >
                        <Download size={12} />
                        Save copy
                    </button>
                    <button
                        onclick={restoreBackup}
                        title="Restore to the version before the problem occurred"
                        class="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-md transition-colors"
                    >
                        <RotateCcw size={12} />
                        Restore previous
                    </button>
                {/if}
                <button
                    onclick={reloadApp}
                    title="Reload the app"
                    class="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-amber-800 bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded-md transition-colors"
                >
                    <RefreshCw size={12} />
                    Reload app
                </button>
                <button
                    onclick={dismiss}
                    title="Dismiss"
                    class="p-1 text-amber-600 hover:text-amber-900 hover:bg-amber-100 rounded transition-colors"
                    aria-label="Dismiss error banner"
                >
                    <X size={16} />
                </button>
            </div>
        </div>

        {#if $errorBanner.details && showDetails}
            <div class="px-4 pb-3">
                <pre class="text-[11px] leading-relaxed text-amber-800 bg-amber-100/60 border border-amber-200 rounded-md p-2.5 overflow-x-auto whitespace-pre-wrap break-all max-h-40 overflow-y-auto font-mono">{$errorBanner.details}</pre>
            </div>
        {/if}
    </div>
{/if}
