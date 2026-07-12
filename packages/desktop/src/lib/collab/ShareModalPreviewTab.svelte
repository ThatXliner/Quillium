<!--
    ShareModalPreviewTab.svelte — "Web preview" tab of the share modal.

    Presentational: renders the public-link toggle, auto-update controls, and
    publish/copy actions from the ReadonlySharePublisher's state. All async
    operations happen through the callbacks so GoLiveButton (which also drives
    the out-of-modal badge and quick-action button) stays the single owner of
    the publish flow.
-->
<script lang="ts">
import {
    READONLY_SHARE_AUTO_UPDATE_DEFAULT_DEBOUNCE_MS,
    READONLY_SHARE_AUTO_UPDATE_MAX_DEBOUNCE_MS,
    READONLY_SHARE_AUTO_UPDATE_MIN_DEBOUNCE_MS,
} from "$lib/collab/readonlyShareAutoUpdate";
import type { ReadonlySharePublisher } from "$lib/collab/readonlySharePublisher.svelte";
import { appSettings } from "$lib/settings.svelte";
import type { ReadonlyShareScope } from "@quillium/share";
import { Copy, Link, Loader2, LogIn, RefreshCcw } from "lucide-svelte";

const {
    authenticated,
    publisher,
    shareId,
    shareUrl,
    shareUpToDate,
    autoUpdateDelaySeconds,
    autoUpdateDebounceMs,
    autoUpdatePausedAfterFailure,
    draftAnnotationCount,
    shareScope,
    hasPreviewText,
    onpublish,
    ontoggleshare,
    oncopylink,
    onsetautoupdate,
    ondebounceinput,
    onresetdebounce,
    onsharescopechange,
    onopenauth,
}: {
    authenticated: boolean;
    publisher: ReadonlySharePublisher;
    shareId: string;
    shareUrl: string;
    shareUpToDate: boolean;
    autoUpdateDelaySeconds: number;
    autoUpdateDebounceMs: number;
    autoUpdatePausedAfterFailure: boolean;
    draftAnnotationCount: number;
    shareScope: ReadonlyShareScope;
    hasPreviewText: boolean;
    onpublish: () => void;
    ontoggleshare: () => void;
    oncopylink: () => void;
    onsetautoupdate: (enabled: boolean) => void;
    ondebounceinput: (event: Event) => void;
    onresetdebounce: () => void;
    onsharescopechange: (scope: ReadonlyShareScope) => void;
    onopenauth: () => void;
} = $props();

const readonlyShare = $derived(publisher.share);
const shareBusy = $derived(publisher.busy);
const shareLoading = $derived(publisher.loading);

function formatShareTimestamp(value: string | null): string {
    if (!value) return "Not published yet";
    return new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
    }).format(new Date(value));
}
</script>

{#if authenticated}
    <div class="grid gap-4">
        <div class="flex items-start gap-3">
            <div class="grid size-9 shrink-0 place-items-center rounded-[10px] bg-blue-500/10 text-blue-600">
                <Link size={18} />
            </div>
            <div>
                <h3 class="mb-1 text-sm/[1.25] font-[650] text-black/70">Anyone with the link can read your document</h3>
                <p class="m-0 text-xs/[1.45] text-black/50">
                    Publish a read-only web page with Quillium branding. Keep updates manual
                    or let them publish after your edits settle.
                </p>
            </div>
        </div>

        <fieldset class="grid gap-2 rounded-2xl bg-black/[0.035] px-4 py-[14px]">
            <legend class="sr-only">Choose what to publish</legend>
            <div class="text-[13px] font-bold text-black/75">Share</div>
            <div class="grid grid-cols-2 gap-1 rounded-xl bg-black/[0.045] p-1">
                <button
                    type="button"
                    class={`min-h-9 rounded-lg px-3 text-xs font-[650] transition-[background,color,box-shadow] ${shareScope === "current-tab" ? "bg-white text-black/75 shadow-sm" : "text-black/45 hover:text-black/65"}`}
                    aria-pressed={shareScope === "current-tab"}
                    onclick={() => onsharescopechange("current-tab")}
                    disabled={shareBusy || shareLoading || !shareId}
                >
                    Current tab
                </button>
                <button
                    type="button"
                    class={`min-h-9 rounded-lg px-3 text-xs font-[650] transition-[background,color,box-shadow] ${shareScope === "all-tabs" ? "bg-white text-black/75 shadow-sm" : "text-black/45 hover:text-black/65"}`}
                    aria-pressed={shareScope === "all-tabs"}
                    onclick={() => onsharescopechange("all-tabs")}
                    disabled={shareBusy || shareLoading || !shareId}
                >
                    All tabs
                </button>
            </div>
            <p class="m-0 text-xs/[1.45] text-black/50">
                {shareScope === "all-tabs"
                    ? "Publish the active draft from every prose tab."
                    : "Publish only the tab and draft currently open."}
            </p>
        </fieldset>

        <div class="flex items-center justify-between gap-4 rounded-2xl bg-black/[0.035] px-4 py-[14px]">
            <div>
                <div class="text-[13px] font-bold text-black/75">Public link</div>
                <div class="mt-1 text-xs/[1.45] text-black/50">
                    {#if readonlyShare?.enabled}
                        On. Readers can open the last published snapshot.
                    {:else}
                        Off. Your document stays private until you publish it.
                    {/if}
                </div>
            </div>
            <button
                type="button"
                class={`relative h-[31px] w-[52px] rounded-full p-[3px] transition-colors duration-200 ease-out disabled:cursor-not-allowed disabled:opacity-45 ${readonlyShare?.enabled ? "bg-[linear-gradient(135deg,rgba(16,185,129,0.95),rgba(5,150,105,0.95))]" : "bg-black/10"}`}
                role="switch"
                aria-checked={readonlyShare?.enabled ?? false}
                aria-label="Toggle public read-only link"
                onclick={ontoggleshare}
                disabled={shareBusy || shareLoading || !shareId}
            >
                <span class={`block size-[25px] rounded-full bg-white shadow-[0_3px_10px_rgba(0,0,0,0.18)] transition-transform duration-200 ease-out ${readonlyShare?.enabled ? "translate-x-[21px]" : "translate-x-0"}`}></span>
            </button>
        </div>

        <div class="grid gap-2.5 rounded-2xl bg-black/[0.035] px-4 py-[14px]">
            <div class="flex items-center justify-between gap-4">
                <div>
                    <div class="text-[13px] font-bold text-black/75">Auto update</div>
                    <div class="mt-1 text-xs/[1.45] text-black/50">
                        {#if appSettings.readonlyShareAutoUpdate}
                            {#if readonlyShare?.enabled}
                                {autoUpdatePausedAfterFailure
                                    ? "Paused after a failed update."
                                    : publisher.queued
                                      ? "Waiting for edits to settle."
                                      : "On. Local changes publish after a short pause."}
                            {:else}
                                On. Publish the link once to start automatic updates.
                            {/if}
                        {:else}
                            Off. Use the update button when you want to refresh the web page.
                        {/if}
                    </div>
                </div>
                <button
                    type="button"
                    class={`relative h-[31px] w-[52px] shrink-0 rounded-full p-[3px] transition-colors duration-200 ease-out disabled:cursor-not-allowed disabled:opacity-45 ${appSettings.readonlyShareAutoUpdate ? "bg-[linear-gradient(135deg,rgba(37,99,235,0.95),rgba(29,78,216,0.95))]" : "bg-black/10"}`}
                    role="switch"
                    aria-checked={appSettings.readonlyShareAutoUpdate}
                    aria-label="Toggle automatic public link updates"
                    onclick={() => onsetautoupdate(!appSettings.readonlyShareAutoUpdate)}
                    disabled={shareBusy || shareLoading || !shareId}
                >
                    <span class={`block size-[25px] rounded-full bg-white shadow-[0_3px_10px_rgba(0,0,0,0.18)] transition-transform duration-200 ease-out ${appSettings.readonlyShareAutoUpdate ? "translate-x-[21px]" : "translate-x-0"}`}></span>
                </button>
            </div>

            {#if appSettings.readonlyShareAutoUpdate}
                <div class="grid gap-2 border-t border-black/[0.06] pt-2.5">
                    <div class="flex items-center justify-between gap-3">
                        <label
                            for="readonly-share-auto-delay"
                            class="text-[10px] font-[750] uppercase tracking-[0.06em] text-black/40"
                        >
                            Delay: {autoUpdateDelaySeconds}s
                        </label>
                        {#if autoUpdateDebounceMs !== READONLY_SHARE_AUTO_UPDATE_DEFAULT_DEBOUNCE_MS}
                            <button
                                type="button"
                                class="text-[11px] font-[650] text-blue-600 transition-colors hover:text-blue-700"
                                onclick={onresetdebounce}
                                disabled={shareBusy || shareLoading || !shareId}
                            >
                                Reset
                            </button>
                        {/if}
                    </div>
                    <input
                        id="readonly-share-auto-delay"
                        type="range"
                        min={READONLY_SHARE_AUTO_UPDATE_MIN_DEBOUNCE_MS / 1000}
                        max={READONLY_SHARE_AUTO_UPDATE_MAX_DEBOUNCE_MS / 1000}
                        step="1"
                        value={autoUpdateDelaySeconds}
                        oninput={ondebounceinput}
                        disabled={shareBusy || shareLoading || !shareId}
                        class="h-2 w-full accent-blue-600 disabled:opacity-45"
                    />
                </div>
            {/if}
        </div>

        <div class="grid gap-2.5 rounded-2xl border border-black/[0.055] bg-black/[0.035] px-4 py-[14px]">
            <div class="grid gap-1">
                <span class="text-[10px] font-[750] uppercase tracking-[0.06em] text-black/40">Public URL</span>
                <strong class="break-words text-[13px]/[1.45] text-black/75">{readonlyShare?.enabled ? shareUrl : "Publish to generate a link"}</strong>
            </div>
            <div class="grid gap-1">
                <span class="text-[10px] font-[750] uppercase tracking-[0.06em] text-black/40">Last published</span>
                <strong class="break-words text-[13px]/[1.45] text-black/75">{formatShareTimestamp(readonlyShare?.publishedAt ?? null)}</strong>
            </div>
            <div class="grid gap-1">
                <span class="text-[10px] font-[750] uppercase tracking-[0.06em] text-black/40">Snapshot status</span>
                <strong class={`break-words text-[13px]/[1.45] ${shareUpToDate ? "text-black/50" : "text-black/75"}`}>{readonlyShare?.enabled
                    ? shareUpToDate
                        ? "Already up to date"
                        : "Local draft has unpublished changes"
                    : `Ready to publish${hasPreviewText ? ` • ${draftAnnotationCount} annotation${draftAnnotationCount === 1 ? "" : "s"}` : ""}`}</strong>
            </div>
        </div>

        <div class="mt-1 flex flex-wrap gap-2.5 max-[520px]:flex-col max-[520px]:items-stretch">
            <button
                class={`inline-flex min-h-[38px] flex-1 basis-[220px] items-center justify-center gap-[7px] rounded-[10px] px-4 text-[13px] font-[650] text-white transition-[background,opacity] duration-150 max-[520px]:w-full ${shareUpToDate ? "bg-black/20 text-white/90" : "bg-blue-600 hover:bg-blue-700"} disabled:cursor-not-allowed disabled:opacity-45`}
                onclick={onpublish}
                disabled={shareBusy || shareLoading || !shareId || shareUpToDate}
            >
                {#if shareBusy}
                    <span class="animate-spin" aria-hidden="true">
                        <Loader2 size={15} />
                    </span>
                    Saving
                {:else if readonlyShare?.enabled && shareUpToDate}
                    <RefreshCcw size={15} />
                    Already up to date
                {:else if readonlyShare?.enabled}
                    <RefreshCcw size={15} />
                    Update shared version
                {:else}
                    <Link size={15} />
                    Publish link
                {/if}
            </button>

            <button
                class="inline-flex min-h-[38px] items-center justify-center gap-[7px] rounded-[10px] bg-black/[0.055] px-4 text-[13px] font-[650] text-black/70 transition-[background,color] duration-150 hover:bg-black/[0.085] hover:text-black/80 disabled:cursor-not-allowed disabled:opacity-45 max-[520px]:w-full"
                onclick={oncopylink}
                disabled={!readonlyShare?.enabled || !shareUrl}
            >
                <Copy size={15} />
                Copy link
            </button>
        </div>

        {#if shareLoading}
            <p class="mt-1 text-xs/[1.45] text-black/50">Loading your public link settings…</p>
        {:else if readonlyShare?.enabled}
            <p class="mt-1 text-xs/[1.45] text-black/50">
                {#if shareUpToDate}
                    The public page already matches this draft.
                {:else if autoUpdatePausedAfterFailure}
                    Auto update hit an error. Use
                    <strong>Update shared version</strong> to retry this draft.
                {:else if appSettings.readonlyShareAutoUpdate}
                    Auto update will refresh the public page after edits settle.
                {:else}
                    Readers keep seeing the current snapshot until you click
                    <strong>Update shared version</strong>.
                {/if}
            </p>
        {/if}
    </div>
{:else}
    <div class="flex items-start gap-3">
        <div class="grid size-9 shrink-0 place-items-center rounded-[10px] bg-blue-500/10 text-blue-600">
            <LogIn size={18} />
        </div>
        <div>
            <h3 class="mb-1 text-sm/[1.25] font-[650] text-black/70">Sign in to publish a public link</h3>
            <p class="m-0 text-xs/[1.45] text-black/50">
                Read-only sharing uses your Quillium account so you can turn links on and off.
            </p>
        </div>
    </div>

    <div class="mt-[18px] grid gap-2.5">
        <button
            onclick={onopenauth}
            class="inline-flex min-h-[38px] items-center justify-center gap-[7px] rounded-[10px] bg-blue-600 px-4 text-[13px] font-[650] text-white transition-[background,opacity] duration-150 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-80 disabled:bg-black/[0.04] disabled:text-black/30"
        >
            Sign in
        </button>
    </div>
{/if}
