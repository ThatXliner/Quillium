<script lang="ts">
import { appSettings } from "$lib/settings.svelte";
import UpdateBanner from "$lib/ui/UpdateBanner.svelte";
import { isTauri } from "@tauri-apps/api/core";
import { onMount } from "svelte";
import {
    checkFrontendUpdate,
    downloadFrontendUpdate,
    frontendUpdateStatus,
    restartForUpdate,
} from "./lifecycle";
import { canCheckForUpdatesNow } from "./schedule";
import { nativeUpdateVisible } from "./visibility";

let candidate = $state<{ version: string; ready: boolean } | null>(null);
let working = $state(false);
let error = $state("");
let dismissed = $state(false);

onMount(() => {
    if (!isTauri() || !appSettings.checkForUpdates || !canCheckForUpdatesNow()) return;
    let disposed = false;
    void (async () => {
        const status = await frontendUpdateStatus();
        if (!status.enabled || status.blockedReason || disposed) return;
        if (status.stagedVersion) {
            candidate = { version: status.stagedVersion, ready: true };
            return;
        }
        const update = await checkFrontendUpdate();
        if (disposed) return;
        if (update.status === "available" || update.status === "staged") {
            candidate = { version: update.version, ready: update.status === "staged" };
        }
    })().catch((error) => console.warn("[updater] frontend check failed", error));
    return () => {
        disposed = true;
    };
});

async function install(): Promise<void> {
    if (!candidate || working) return;
    const wasReady = candidate.ready;
    working = true;
    error = "";
    try {
        if (candidate.ready) await restartForUpdate();
        else {
            const update = await downloadFrontendUpdate();
            if (update.status === "staged") candidate = { version: update.version, ready: true };
            else if (update.status === "refused")
                error = "This update needs a newer version of Quillium.";
            else if (update.status === "current" || update.status === "disabled") candidate = null;
        }
    } catch {
        error = wasReady
            ? "Your writing could not be saved in every window. Try again after checking your open documents."
            : "The update couldn’t be downloaded and verified. Try again later.";
    } finally {
        working = false;
    }
}
</script>

{#if candidate && !dismissed && !$nativeUpdateVisible}
    <UpdateBanner version={candidate.version} ready={candidate.ready} installing={working} {error}
        oninstall={() => void install()} ondismiss={() => { dismissed = true; }} />
{/if}
