<!--
    GoLiveButton.svelte -- Top-right collab toggle and share modal shell.

    Per D-56: "Go Live" toggle in top-right area (near AuthButton).
    Per D-57: Live Room mode only -- session ends when owner leaves.
    Per D-58: Snapshot before pulling remote state.
    Per D-59: Manual toggle for owner's own documents.
    Per D-70: Updated for Yjs migration.

    Composition:
      - LiveSessionController (liveSession.svelte.ts) owns the go-live /
        join / leave lifecycle; thin $effects here forward store signals.
      - ReadonlySharePublisher (readonlySharePublisher.svelte.ts) owns the
        public-link state and publish/disable flow; the staleness
        fingerprints stay here because they derive from reactive stores.
      - ShareModalPreviewTab / ShareModalCollabTab render the two tabs.
-->
<script lang="ts">
import { getUser, isAuthenticated } from "$lib/auth/auth.svelte";
import { supabaseConfigured } from "$lib/auth/supabase";
import { collabState, ownerLeftSignal, reconnectAttempt, relayConfigured } from "$lib/collab";
import ShareModalCollabTab from "$lib/collab/ShareModalCollabTab.svelte";
import ShareModalPreviewTab from "$lib/collab/ShareModalPreviewTab.svelte";
import { LiveSessionController } from "$lib/collab/liveSession.svelte";
import { serializeLoadedShareState } from "$lib/collab/loadedShareState";
import {
    READONLY_SHARE_AUTO_UPDATE_DEFAULT_DEBOUNCE_MS,
    normalizeReadonlyShareAutoUpdateDebounceMs,
    shouldScheduleReadonlyShareAutoUpdate,
} from "$lib/collab/readonlyShareAutoUpdate";
import { ReadonlySharePublisher } from "$lib/collab/readonlySharePublisher.svelte";
import { buildReadonlyShareUrl, buildSharePreviewText } from "$lib/collab/share";
import {
    buildShareFingerprint,
    serializeAnnotations,
    serializeShareState,
} from "$lib/collab/sharePayload";
import { withoutTransientShareSelection } from "$lib/collab/shareState";
import { getActiveDraft, listTabDrafts, listTabs, loadDocumentState } from "$lib/db";
import { annotationField, versionGroupField } from "$lib/editor/plugins/annotations";
import posthog from "$lib/posthog";
import { appSettings, updateSettings } from "$lib/settings.svelte";
import {
    annotations,
    currentDocumentId,
    currentDocumentTitle,
    currentDraftId,
    currentTabId,
    documentContent,
    editorView,
    versionGroups,
} from "$lib/stores";
import {
    type ReadonlyShareScope,
    includesReadonlyShareTab,
    readonlyShareScopeOf,
} from "@quillium/share";
import { Loader2, RefreshCcw, Share2, X } from "lucide-svelte";
import { toast } from "svelte-sonner";
import { get } from "svelte/store";

const { onauthclick }: { onauthclick?: () => void } = $props();

type ShareTab = "preview" | "collaborate";

const session = new LiveSessionController();
const publisher = new ReadonlySharePublisher();

let modalOpen = $state(false);
let dialogEl = $state<HTMLDialogElement | undefined>(undefined);
let activeTab = $state<ShareTab>("preview");
let tabTrackEl = $state<HTMLElement | undefined>(undefined);
let tabPillStyle = $state("");

function shouldShowForScreenshot(): boolean {
    return (
        import.meta.env.DEV &&
        typeof window !== "undefined" &&
        Boolean((window as unknown as Record<string, unknown>).__QUILLIUM_SCREENSHOT_AUTH_ONLINE__)
    );
}

const authenticated = $derived(isAuthenticated());
const canShowShare = $derived(relayConfigured || supabaseConfigured || shouldShowForScreenshot());
// Live-collab room key: still per-draft (the live room mirrors one editor view).
const currentId = $derived($currentDraftId ?? "");
// Web Preview key: one stable share per document. The versioned payload chooses
// the current tab or all tabs, so republishing can change the visible draft set
// without minting a new link.
const shareId = $derived($currentDocumentId ?? "");
const readonlyShare = $derived(publisher.share);
const shareUrl = $derived(readonlyShare ? buildReadonlyShareUrl(readonlyShare.shareToken) : "");
const shareComparisonPayload = $derived(
    readonlyShare?.enabled
        ? {
              title: $currentDocumentTitle,
              content: $documentContent,
              annotations: serializeAnnotations(
                  $documentContent,
                  $annotations,
                  $versionGroups ?? {},
              ),
          }
        : null,
);
let multiTabFingerprint = $state("");
let shareScope = $state<ReadonlyShareScope>("all-tabs");
let hydratedShareUpdatedAt = $state<string | null>(null);
const currentShareFingerprint = $derived(
    multiTabFingerprint ||
        (shareComparisonPayload
            ? buildShareFingerprint(
                  shareComparisonPayload.title,
                  shareComparisonPayload.content,
                  shareComparisonPayload.annotations,
              )
            : ""),
);
const publishedShareFingerprint = $derived(
    readonlyShare?.enabled
        ? fingerprintPayload(readonlyShare.publishedTitle, readonlyShare.publishedState)
        : "",
);
const shareUpToDate = $derived(
    !!readonlyShare?.enabled && currentShareFingerprint === publishedShareFingerprint,
);
const shareNeedsUpdate = $derived(!!readonlyShare?.enabled && !shareUpToDate);
const autoUpdateDebounceMs = $derived(
    normalizeReadonlyShareAutoUpdateDebounceMs(appSettings.readonlyShareAutoUpdateDebounceMs),
);
const autoUpdateDelaySeconds = $derived(Math.round(autoUpdateDebounceMs / 1000));
const autoUpdatePausedAfterFailure = $derived(
    publisher.failedFingerprint !== "" && publisher.failedFingerprint === currentShareFingerprint,
);
const draftAnnotationCount = $derived(
    modalOpen && activeTab === "preview" && !readonlyShare?.enabled
        ? serializeAnnotations($documentContent, $annotations, $versionGroups ?? {}).length
        : 0,
);

$effect(() => {
    if (modalOpen && dialogEl && !dialogEl.open) {
        dialogEl.showModal();
    }
});

$effect(() => {
    const share = readonlyShare;
    if (!share?.enabled || share.updatedAt === hydratedShareUpdatedAt) return;
    shareScope = readonlyShareScopeOf(share.publishedState);
    hydratedShareUpdatedAt = share.updatedAt;
});

$effect(() => {
    const title = $currentDocumentTitle;
    const content = $documentContent;
    const annotationsSnapshot = $annotations;
    const tabId = $currentTabId;
    const draftId = $currentDraftId;
    const scope = shareScope;
    if (!authenticated || !shareId || !readonlyShare?.enabled) {
        multiTabFingerprint = "";
        return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
        void buildPublishPayload(scope)
            .then((payload) => {
                if (!cancelled) {
                    multiTabFingerprint = fingerprintPayload(payload.title, payload.state);
                }
            })
            .catch((error: unknown) => {
                console.error("[share] Failed to fingerprint multi-tab preview:", error);
                if (!cancelled) multiTabFingerprint = "";
            });
    }, 150);
    void title;
    void content;
    void annotationsSnapshot;
    void tabId;
    void draftId;
    return () => {
        cancelled = true;
        window.clearTimeout(timer);
    };
});

$effect(() => {
    if (!tabTrackEl) return;
    const buttons = tabTrackEl.querySelectorAll<HTMLButtonElement>(".share-tab-btn");
    const idx = activeTab === "collaborate" ? 0 : 1;
    const btn = buttons[idx];
    if (!btn) return;
    tabPillStyle = `--share-pill-width: ${btn.offsetWidth}px; --share-pill-x: ${btn.offsetLeft - 3}px;`;
});

// Load (or drop) the share row when auth/document context changes.
$effect(() => {
    if (!authenticated || !shareId) {
        publisher.clear();
        return;
    }
    publisher.refresh(shareId);
});

// Auto-update scheduler: when enabled and the published snapshot is stale,
// publish after the debounce window (cancelled if inputs change meanwhile).
$effect(() => {
    const debounceMs = autoUpdateDebounceMs;
    const fingerprint = currentShareFingerprint;
    const shouldAutoPublish = shouldScheduleReadonlyShareAutoUpdate({
        enabled: appSettings.readonlyShareAutoUpdate,
        authenticated,
        shareId,
        shareEnabled: readonlyShare?.enabled ?? false,
        shareNeedsUpdate,
        shareBusy: publisher.busy,
        shareLoading: publisher.loading,
        currentFingerprint: fingerprint,
        lastFailedFingerprint: publisher.failedFingerprint,
    });

    if (!shouldAutoPublish) {
        publisher.queued = false;
        return;
    }

    publisher.queued = true;
    const timer = window.setTimeout(() => {
        publisher.queued = false;
        void publishCurrentSnapshot({ automatic: true });
    }, debounceMs);

    return () => {
        window.clearTimeout(timer);
        publisher.queued = false;
    };
});

// React when owner ends the session (ownerLeftSignal is incremented by yjsProvider)
$effect(() => {
    if ($ownerLeftSignal > 0 && session.isLive) {
        session.handleOwnerLeft();
    }
});

// React to reconnection state changes
$effect(() => {
    session.trackCollabState($collabState, $reconnectAttempt);
});

function closeModal() {
    modalOpen = false;
    if (dialogEl?.open) dialogEl.close();
}

function handleBackdropClick(e: MouseEvent) {
    if (e.target === dialogEl) closeModal();
}

function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && modalOpen) {
        e.preventDefault();
        closeModal();
    }
}

function openAuth() {
    closeModal();
    onauthclick?.();
}

function fingerprintPayload(title: string, state: Record<string, unknown> | null): string {
    return buildShareFingerprint(title, JSON.stringify(withoutTransientShareSelection(state)), []);
}

async function buildPublishPayload(scope: ReadonlyShareScope = shareScope) {
    const view = get(editorView);
    const content = view?.state.doc.toString() ?? $documentContent;
    const liveAnnotations = view?.state.field(annotationField, false) ?? $annotations;
    const liveVersionGroups = view?.state.field(versionGroupField, false) ?? $versionGroups ?? {};

    const tabs = (await listTabs(shareId)).filter(
        (tab) => tab.tabType === "draft" && includesReadonlyShareTab(scope, tab.id, $currentTabId),
    );
    const publishedTabs = await Promise.all(
        tabs.map(async (tab) => {
            const drafts = await listTabDrafts(tab.id);
            const activeDraftId = await getActiveDraft(tab.id);
            const draft = drafts.find((item) => item.id === activeDraftId) ?? drafts[0];
            if (!draft) return null;
            const state =
                tab.id === $currentTabId && draft.id === $currentDraftId && view
                    ? serializeShareState(view.state)
                    : serializeLoadedShareState(await loadDocumentState(shareId, draft.id));
            return { id: tab.id, label: tab.label, draftId: draft.id, state };
        }),
    );
    const activeTabId = publishedTabs.some((tab) => tab?.id === $currentTabId)
        ? $currentTabId
        : (publishedTabs[0]?.id ?? null);

    return {
        documentId: shareId,
        ownerId: getUser()?.id ?? "",
        title: $currentDocumentTitle,
        content,
        annotations: serializeAnnotations(content, liveAnnotations, liveVersionGroups),
        // Versioned document payload: every prose tab carries the selected
        // draft's real CM state for the shared read-only editor renderer.
        state: {
            kind: "quillium-readonly-share",
            version: 2,
            scope,
            activeTabId,
            tabs: publishedTabs.filter((tab) => tab !== null),
        },
    };
}

function setReadonlyShareAutoUpdate(enabled: boolean) {
    updateSettings({
        readonlyShareAutoUpdate: enabled,
        readonlyShareAutoUpdateDebounceMs: autoUpdateDebounceMs,
    });
    publisher.failedFingerprint = "";
    posthog.capture("readonly_share_auto_update_toggled", { enabled });
}

function handleAutoUpdateDebounceInput(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    updateSettings({ readonlyShareAutoUpdateDebounceMs: Number(input.value) * 1000 });
}

function resetAutoUpdateDebounce() {
    updateSettings({
        readonlyShareAutoUpdateDebounceMs: READONLY_SHARE_AUTO_UPDATE_DEFAULT_DEBOUNCE_MS,
    });
}

async function copyReadonlyLink() {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    posthog.capture("readonly_share_link_copied");
    toast.success("Public link copied");
}

async function publishCurrentSnapshot(options: { automatic?: boolean } = {}) {
    const user = getUser();
    if (!user || !shareId) {
        toast.error("Open a document and sign in to publish it");
        return;
    }

    const payload = await buildPublishPayload();
    payload.ownerId = user.id;
    const payloadFingerprint = fingerprintPayload(payload.title, payload.state);
    await publisher.publish(payload, payloadFingerprint, options);
}

async function updateWebPreviewQuickAction() {
    activeTab = "preview";
    await publishCurrentSnapshot();
}

async function toggleReadonlyShare() {
    if (!readonlyShare?.enabled) {
        await publishCurrentSnapshot();
        return;
    }
    await publisher.disable(shareId);
}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if canShowShare}
    <div class="group relative flex flex-col items-end gap-2">
        <div class="relative">
            <!-- Split into two layers: WebKit renders a square drop-shadow when backdrop-filter
                 and overflow-hidden share an element. OUTER keeps the shadow + radius (no
                 backdrop-filter, no overflow-hidden) so the shadow stays rounded; INNER carries the
                 backdrop-blur + same radius + overflow-hidden + background so the blur is clipped. -->
            <button
                onclick={() => (modalOpen = true)}
                class="relative inline-flex rounded-full text-xs font-semibold shadow-md transition-colors"
                aria-haspopup="dialog"
                aria-label={shareNeedsUpdate
                    ? "Share, public link has unpublished changes"
                    : "Share"}
            >
                <span
                    class="inline-flex items-center gap-2 overflow-hidden rounded-full px-4 py-2
                        {session.isLive
                            ? 'bg-emerald-500 text-white hover:bg-emerald-600'
                            : 'text-black/55 bg-white/55 backdrop-blur-md hover:text-black/75 hover:bg-white/70'}"
                >
                    <Share2 size={14} />
                    Share
                </span>
            </button>

            <!-- Badge is a sibling, not a button child: overflow-hidden on the button (needed to
                 clip backdrop-blur to the rounded corner in WebKit) would otherwise clip this
                 negatively-offset dot and its outer ring shadow. -->
            {#if shareNeedsUpdate}
                <span
                    class="pointer-events-none absolute -right-[3px] -top-[3px] size-2.5 rounded-full bg-blue-600 shadow-[0_0_0_3px_rgba(255,255,255,0.92),0_4px_10px_rgba(59,130,246,0.2)]"
                    aria-hidden="true"
                ></span>
            {/if}
        </div>

        {#if shareNeedsUpdate}
            <button
                type="button"
                class="pointer-events-none inline-flex min-h-8 items-center justify-center gap-1.5 rounded-full border border-blue-500/15 bg-blue-500/10 px-3 text-xs font-[650] text-blue-700 shadow-[0_10px_28px_rgba(59,130,246,0.12),inset_0_1px_0_rgba(255,255,255,0.7)] opacity-0 transition-[background,color,transform,opacity,visibility] duration-150 invisible -translate-y-2 scale-95 group-hover:pointer-events-auto group-hover:visible group-hover:translate-y-0 group-hover:scale-100 group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:scale-100 group-focus-within:opacity-100 hover:bg-blue-500/20 hover:text-blue-800 hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-45 max-[520px]:pointer-events-auto max-[520px]:visible max-[520px]:translate-y-0 max-[520px]:scale-100 max-[520px]:opacity-100"
                onclick={updateWebPreviewQuickAction}
                disabled={publisher.busy || publisher.loading || !shareId}
            >
                {#if publisher.busy}
                    <span class="animate-spin" aria-hidden="true">
                        <Loader2 size={13} />
                    </span>
                    Updating link
                {:else}
                    <RefreshCcw size={13} />
                    Update link
                {/if}
            </button>
        {/if}
    </div>

    {#if modalOpen}
        <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
        <dialog
            bind:this={dialogEl}
            class="m-0 flex h-screen max-h-screen w-screen max-w-screen items-center justify-center border-none bg-transparent p-0 [&::backdrop]:bg-black/20 [&::backdrop]:backdrop-blur-[5px]"
            onclick={handleBackdropClick}
        >
            <div class="w-[min(560px,calc(100vw-32px))] overflow-hidden rounded-2xl border border-black/5 bg-white/95 shadow-[0_24px_70px_rgba(0,0,0,0.2)] max-[520px]:w-[calc(100vw-20px)]">
                <header class="flex items-start justify-between gap-4 px-6 pb-2.5 pt-[22px]">
                    <div>
                        <div class="flex items-center gap-2.5">
                            <h2 class="m-0 text-2xl/[1.1] font-[650] text-black/80">Share your document</h2>
                            <span class="inline-flex h-5 items-center rounded-full bg-amber-400/15 px-2 text-[10px] font-[750] uppercase tracking-[0.06em] text-amber-600">Beta</span>
                        </div>
                    </div>
                    <button
                        onclick={closeModal}
                        aria-label="Close"
                        class="inline-flex items-center gap-1 rounded-lg px-1.5 py-1 pl-2 text-black/30 transition-[color,background] duration-150 hover:bg-black/5 hover:text-black/55"
                    >
                        <span class="font-mono text-[9px] text-black/20">esc</span>
                        <X size={15} />
                    </button>
                </header>

                <p class="m-0 px-6 pb-4 text-xs/[1.45] text-black/45">
                    Because writing is better together, always.
                </p>

                <div
                    class="relative mx-6 flex gap-0.5 rounded-full bg-black/[0.055] p-[3px] shadow-[inset_0_1px_2px_rgba(0,0,0,0.06)]"
                    bind:this={tabTrackEl}
                    style={tabPillStyle}
                    role="tablist"
                    aria-label="Share modes"
                >
                    <div
                        class="absolute left-[3px] top-[3px] h-[calc(100%-6px)] rounded-full bg-white/80 shadow-[0_1px_4px_rgba(0,0,0,0.12),inset_0_1px_0_rgba(255,255,255,0.95)] transition-[transform,width] duration-[250ms] [transition-timing-function:cubic-bezier(0.34,1.2,0.64,1)]"
                        style="width: var(--share-pill-width, 50%); transform: translateX(var(--share-pill-x, 0px));"
                    ></div>
                    <button
                        role="tab"
                        aria-selected={activeTab === "collaborate"}
                        onclick={() => (activeTab = "collaborate")}
                        class={`share-tab-btn relative z-[1] min-w-0 flex-1 rounded-full px-2.5 py-[7px] text-xs font-semibold transition-colors ${activeTab === "collaborate" ? "text-black/70" : "text-black/40 hover:text-black/60"}`}
                    >
                        Omni
                    </button>
                    <button
                        role="tab"
                        aria-selected={activeTab === "preview"}
                        onclick={() => (activeTab = "preview")}
                        class={`share-tab-btn relative z-[1] min-w-0 flex-1 rounded-full px-2.5 py-[7px] text-xs font-semibold transition-colors ${activeTab === "preview" ? "text-black/70" : "text-black/40 hover:text-black/60"}`}
                    >
                        Web preview
                    </button>
                </div>

                <section class="m-[14px_18px_18px] rounded-[14px] border border-black/[0.07] bg-white/80 p-[18px]">
                    {#if activeTab === "preview"}
                        <ShareModalPreviewTab
                            {authenticated}
                            {publisher}
                            {shareId}
                            {shareUrl}
                            {shareUpToDate}
                            {autoUpdateDelaySeconds}
                            {autoUpdateDebounceMs}
                            {autoUpdatePausedAfterFailure}
                            {draftAnnotationCount}
                            {shareScope}
                            hasPreviewText={buildSharePreviewText($documentContent).length > 0}
                            onpublish={() => publishCurrentSnapshot()}
                            ontoggleshare={toggleReadonlyShare}
                            oncopylink={copyReadonlyLink}
                            onsetautoupdate={setReadonlyShareAutoUpdate}
                            ondebounceinput={handleAutoUpdateDebounceInput}
                            onresetdebounce={resetAutoUpdateDebounce}
                            onsharescopechange={(scope) => (shareScope = scope)}
                            onopenauth={openAuth}
                        />
                    {:else}
                        <ShareModalCollabTab
                            {authenticated}
                            {session}
                            {currentId}
                            onopenauth={openAuth}
                        />
                    {/if}
                </section>
            </div>
        </dialog>
    {/if}
{/if}
