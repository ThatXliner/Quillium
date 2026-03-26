<script lang="ts">
import {
    X,
    AlertTriangle,
    OctagonAlert,
    Download,
    RotateCcw,
    History,
    RefreshCw,
    ChevronDown,
    ChevronUp,
} from "lucide-svelte";
import { errorBanner } from "./stores";
import { readBackup, clearBackup } from "./errorGuard";
import type { BackupEntry } from "./errorGuard";
import { FEEDBACK_FORM_URL } from "./constants";
import { openUrl } from "@tauri-apps/plugin-opener";
import { goToHistory } from "./navigation";

let showDetails = $state(false);

function dismiss() {
    $errorBanner = null;
    showDetails = false;
}

function downloadBackup() {
    const backup: BackupEntry | null = readBackup("crash");
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

function restoreFromBackup() {
    const backup: BackupEntry | null = readBackup("crash");
    if (!backup) return;

    window.dispatchEvent(new CustomEvent("quillium:restore-backup", { detail: backup }));
    clearBackup("crash");
    $errorBanner = null;
}

function viewHistory() {
    $errorBanner = null;
    showDetails = false;
    goToHistory();
}

function reloadApp() {
    window.location.reload();
}

function reportIssue() {
    openUrl(FEEDBACK_FORM_URL);
}
</script>

{#if $errorBanner}
    {@const isCrash = $errorBanner.backupType === "crash"}
    <div
        class="fixed top-0 left-0 right-0 z-[9999] flex flex-col {isCrash
            ? 'bg-red-50 border-b border-red-200'
            : 'bg-amber-50 border-b border-amber-200'} shadow-md"
        role="alert"
        aria-live="assertive"
    >
        <div class="flex items-start gap-3 px-4 py-3">
            {#if isCrash}
                <OctagonAlert size={18} class="shrink-0 text-red-600 mt-0.5" />
            {:else}
                <AlertTriangle size={18} class="shrink-0 text-amber-600 mt-0.5" />
            {/if}

            <div class="flex-1 min-w-0">
                <p class="text-sm font-medium {isCrash ? 'text-red-900' : 'text-amber-900'}">
                    {$errorBanner.message}
                </p>
                <p class="text-xs {isCrash ? 'text-red-700' : 'text-amber-700'} mt-0.5">
                    {#if isCrash && $errorBanner.hasBackup}
                        Your writing has been backed up.
                    {/if}
                    <button
                        onclick={reportIssue}
                        class="underline hover:{isCrash
                            ? 'text-red-900'
                            : 'text-amber-900'} transition-colors"
                    >
                        Report this issue
                    </button>
                    to help us fix it.
                    {#if $errorBanner.details}
                        <button
                            onclick={() => (showDetails = !showDetails)}
                            class="inline-flex items-center gap-0.5 underline hover:{isCrash
                                ? 'text-red-900'
                                : 'text-amber-900'} transition-colors ml-1"
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
                {#if isCrash}
                    <!-- Crash: restore from localStorage backup + download + reload -->
                    {#if $errorBanner.hasBackup}
                        <button
                            onclick={restoreFromBackup}
                            title="Restore to the version before the crash"
                            class="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-md transition-colors"
                        >
                            <RotateCcw size={12} />
                            Restore previous
                        </button>
                        <button
                            onclick={downloadBackup}
                            title="Download your writing as plain text"
                            class="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-red-800 bg-red-100 hover:bg-red-200 border border-red-300 rounded-md transition-colors"
                        >
                            <Download size={12} />
                            Save copy
                        </button>
                    {/if}
                    <button
                        onclick={reloadApp}
                        title="Reload the app"
                        class="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-red-800 bg-red-100 hover:bg-red-200 border border-red-300 rounded-md transition-colors"
                    >
                        <RefreshCw size={12} />
                        Reload app
                    </button>
                {:else}
                    <!-- Suspicious deletion: point to version history -->
                    <button
                        onclick={viewHistory}
                        title="Browse snapshots to restore a previous version"
                        class="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-md transition-colors"
                    >
                        <History size={12} />
                        View version history
                    </button>
                {/if}
                <button
                    onclick={dismiss}
                    title="Dismiss"
                    class="p-1 {isCrash
                        ? 'text-red-600 hover:text-red-900 hover:bg-red-100'
                        : 'text-amber-600 hover:text-amber-900 hover:bg-amber-100'} rounded transition-colors"
                    aria-label="Dismiss error banner"
                >
                    <X size={16} />
                </button>
            </div>
        </div>

        {#if $errorBanner.details && showDetails}
            <div class="px-4 pb-3">
                <pre
                    class="text-[11px] leading-relaxed {isCrash
                        ? 'text-red-800 bg-red-100/60 border-red-200'
                        : 'text-amber-800 bg-amber-100/60 border-amber-200'} border rounded-md p-2.5 overflow-x-auto whitespace-pre-wrap break-all max-h-40 overflow-y-auto font-mono">{$errorBanner.details}</pre>
            </div>
        {/if}
    </div>
{/if}
