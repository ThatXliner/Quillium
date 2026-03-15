<script lang="ts">
import { X, AlertTriangle, Download, RotateCcw, ChevronDown, ChevronUp, Copy, Check } from "lucide-svelte";
import { errorBanner } from "./stores";
import { readBackup, clearBackup } from "./errorGuard";
import type { BackupEntry } from "./errorGuard";

let expanded = $state(false);
let copied = $state(false);

function copyStack() {
    const stack = $errorBanner?.stack;
    if (!stack) return;
    navigator.clipboard.writeText(stack).then(() => {
        copied = true;
        setTimeout(() => { copied = false; }, 2000);
    });
}


const FEEDBACK_FORM_URL = "https://forms.gle/aYJkMnhiYrr688ug7";

function dismiss() {
    $errorBanner = null;
    expanded = false;
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
    const date = new Date(backup.timestamp).toISOString().slice(0, 19).replace("T", "_").replace(/:/g, "-");
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

function reportIssue() {
    window.open(FEEDBACK_FORM_URL, "_blank", "noopener,noreferrer");
}
</script>

{#if $errorBanner}
    <div
        class="fixed top-0 left-0 right-0 z-[9999] flex items-start gap-3 px-4 py-3 bg-amber-50 border-b border-amber-200 shadow-md"
        role="alert"
        aria-live="assertive"
    >
        <AlertTriangle size={18} class="shrink-0 text-amber-600 mt-0.5" />

        <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-amber-900">
                {$errorBanner.message}
            </p>
            <div class="flex items-center gap-2 flex-wrap mt-0.5">
                <span class="text-xs text-amber-700">
                    {#if $errorBanner.hasBackup}Your writing has been backed up.{/if}
                </span>
                <button
                    onclick={reportIssue}
                    class="text-xs text-amber-700 underline hover:text-amber-900 transition-colors"
                >
                    Report this issue
                </button>
                {#if $errorBanner.stack}
                    <button
                        onclick={() => expanded = !expanded}
                        class="inline-flex items-center gap-0.5 text-xs text-amber-700 underline hover:text-amber-900 transition-colors"
                    >
                        {#if expanded}<ChevronUp size={11} />{:else}<ChevronDown size={11} />{/if}
                        {expanded ? "Hide" : "Show"} traceback
                    </button>
                {/if}
            </div>
            {#if expanded && $errorBanner.stack}
                <div class="relative mt-2">
                    <pre class="p-2 pr-8 text-xs text-amber-900 bg-amber-100 border border-amber-200 rounded h-28 overflow-y-auto whitespace-pre font-mono">{$errorBanner.stack}</pre>
                    <button
                        onclick={copyStack}
                        title="Copy full traceback"
                        class="absolute top-1.5 right-1.5 p-1 text-amber-600 hover:text-amber-900 hover:bg-amber-200 rounded transition-colors"
                    >
                        {#if copied}<Check size={12} />{:else}<Copy size={12} />{/if}
                    </button>
                </div>
            {/if}
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
                onclick={dismiss}
                title="Dismiss"
                class="p-1 text-amber-600 hover:text-amber-900 hover:bg-amber-100 rounded transition-colors"
                aria-label="Dismiss error banner"
            >
                <X size={16} />
            </button>
        </div>
    </div>
{/if}
