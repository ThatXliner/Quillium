<!--
    SearchSection.svelte — Settings: semantic search opt-in.

    Backend-persisted (the Rust index worker reads it at startup), so it lives
    outside the settings draft/save flow and applies immediately on toggle.
    Fully self-contained: owns the enabled/status/busy state and polling.
-->
<script lang="ts">
import {
    getSemanticSearchEnabled,
    pollSearchStatus,
    setSemanticSearchEnabled,
    uninstallSemanticModel,
} from "$lib/db";
import posthog, { captureException } from "$lib/posthog";
import { Trash2 } from "lucide-svelte";
import SettingToggle from "../SettingToggle.svelte";

let semanticEnabled = $state(false);
let semanticStatus = $state("disabled");
let semanticBusy = $state(false);
let semanticModelInstalled = $state(false);
getSemanticSearchEnabled()
    .then((enabled) => {
        // `=== true` guards against the e2e Tauri mock, which answers
        // unknown commands with null.
        semanticEnabled = enabled === true;
        // If ever enabled, the model was (or is being) downloaded.
        semanticModelInstalled = enabled === true;
    })
    .catch(() => {});

// Poll the index status while enabled so the row can show download/index
// progress; stops once the index settles (ready/error). A null reading
// (status command failed) keeps the last shown status.
$effect(() => {
    if (!semanticEnabled) return;
    return pollSearchStatus((status) => {
        if (status !== null) semanticStatus = status;
    });
});

async function toggleSemanticSearch() {
    if (semanticBusy) return;
    semanticBusy = true;
    const next = !semanticEnabled;
    try {
        await setSemanticSearchEnabled(next);
        semanticEnabled = next;
        semanticStatus = next ? "starting" : "disabled";
        if (next) semanticModelInstalled = true;
        posthog.capture("semantic_search_toggled", { enabled: next });
    } catch (e) {
        console.error("[settings] failed to toggle semantic search:", e);
        captureException(e);
    } finally {
        semanticBusy = false;
    }
}

async function uninstallModel() {
    if (semanticBusy) return;
    semanticBusy = true;
    try {
        await uninstallSemanticModel();
        semanticEnabled = false;
        semanticStatus = "disabled";
        semanticModelInstalled = false;
        posthog.capture("semantic_search_model_uninstalled");
    } catch (e) {
        console.error("[settings] failed to uninstall semantic model:", e);
        captureException(e);
    } finally {
        semanticBusy = false;
    }
}
</script>

<div class="section-label">Search</div>

<SettingToggle
    title="Search by meaning"
    settingId="semantic-search"
    checked={semanticEnabled}
    ariaLabel="Toggle search by meaning"
    disabled={semanticBusy}
    onchange={toggleSemanticSearch}
>
    {#snippet descriptionExtra()}
        Match documents by concept, not just keywords. Uses a ~30 MB on-device model — nothing leaves your computer.
        {#if semanticEnabled}
            {#if semanticStatus === "starting" || semanticStatus === "loading-model"}
                <span class="text-blue-500/80">Downloading model…</span>
            {:else if semanticStatus === "indexing"}
                <span class="text-blue-500/80">Indexing your documents…</span>
            {:else if semanticStatus === "ready"}
                <span class="text-green-600/80">Ready</span>
            {:else if semanticStatus === "unavailable"}
                <span class="text-black/40">Not available on this device</span>
            {:else if semanticStatus.startsWith("error")}
                <span class="text-red-500/80">
                    Couldn't download the model — check your connection
                    and toggle again to retry
                </span>
            {/if}
        {/if}
    {/snippet}
    {#snippet beforeSwitch()}
        {#if !semanticEnabled && semanticModelInstalled}
            <button
                title="Uninstall model (~30 MB)"
                aria-label="Uninstall semantic search model"
                disabled={semanticBusy}
                class="text-black/30 hover:text-red-500 disabled:opacity-40 transition-colors"
                onclick={uninstallModel}
            ><Trash2 size={14} /></button>
        {/if}
    {/snippet}
</SettingToggle>
