<!--
    GoLiveButton.svelte -- Top-right collab toggle.

    Per D-56: "Go Live" toggle in top-right area (near AuthButton).
    Per D-57: Live Room mode only -- session ends when owner leaves.
    Per D-58: Snapshot before pulling remote state.
    Per D-59: Manual toggle for owner's own documents.
    Per D-70: Updated for Yjs migration.
-->
<script lang="ts">
import { getSession, getUser, isAuthenticated } from "$lib/auth/auth.svelte";
import { supabaseConfigured } from "$lib/auth/supabase";
import {
    MAX_RECONNECT_ATTEMPTS,
    collabState,
    disableCollab,
    enableCollab,
    ownerLeftSignal,
    reconnectAttempt,
    registerDocumentForCollab,
    relayConfigured,
    restoreJoinerPriorView,
} from "$lib/collab";
import {
    type ReadonlyShare,
    buildReadonlyShareUrl,
    buildSharePreviewText,
    disableReadonlyShare,
    getReadonlyShare,
    publishReadonlyShare,
    readonlyShareState,
} from "$lib/collab/share";
import {
    READONLY_SHARE_AUTO_UPDATE_DEFAULT_DEBOUNCE_MS,
    READONLY_SHARE_AUTO_UPDATE_MAX_DEBOUNCE_MS,
    READONLY_SHARE_AUTO_UPDATE_MIN_DEBOUNCE_MS,
    normalizeReadonlyShareAutoUpdateDebounceMs,
    shouldScheduleReadonlyShareAutoUpdate,
} from "$lib/collab/readonlyShareAutoUpdate";
import {
    buildReadonlyShareFingerprint,
    getActiveReadonlyShareTab,
    serializeAnnotations,
    type ReadonlyShareTab,
} from "$lib/collab/sharePayload";
import { serializeLoadedShareState } from "$lib/collab/shareState";
import { isCollabJoiner, joinerPriorView } from "$lib/collab/store";
import { OMNI_WAITLIST_URL } from "$lib/constants";
import {
    createNamedSnapshot,
    getActiveDraft,
    listTabDrafts,
    listTabs,
    loadDocumentState,
} from "$lib/db";
import { savedFields } from "$lib/editor/extensions";
import { annotationField } from "$lib/editor/plugins/annotations";
import posthog from "$lib/posthog";
import { appSettings, persistSettings } from "$lib/settings.svelte";
import {
    annotations,
    currentTabId,
    currentDocumentId,
    currentDocumentTitle,
    currentDraftId,
    documentContent,
    editorView,
    lastPersistedEventId,
} from "$lib/stores";
import {
    ArrowLeftRight,
    Cloud,
    Copy,
    ExternalLink,
    Link,
    Loader2,
    LogIn,
    Radio,
    RefreshCcw,
    Share2,
    X,
} from "lucide-svelte";
import { toast } from "svelte-sonner";
import { get } from "svelte/store";

const { onauthclick }: { onauthclick?: () => void } = $props();

type ShareTab = "preview" | "collaborate";

let isLive = $state(false);
let connecting = $state(false);
let modalOpen = $state(false);
let dialogEl = $state<HTMLDialogElement | undefined>(undefined);
let joinIdInput = $state("");
let prevCollabState = $state<string>("disconnected");
let activeTab = $state<ShareTab>("preview");
let tabTrackEl = $state<HTMLElement | undefined>(undefined);
let tabPillStyle = $state("");
let shareLoading = $state(false);
let shareBusy = $state(false);
let readonlyShare = $state<ReadonlyShare | null>(null);
let autoSharePublishQueued = $state(false);
let autoSharePublishFailedFingerprint = $state("");
let currentShareFingerprint = $state("");

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
// Web-preview / read-only share key: one share per *document*. There is no
// tab-level publish/include flag in the tab metadata yet, so public preview
// publishes the active draft from every live draft tab. Keep future scope
// controls centered on buildPublishPayload() so share identity remains stable.
const shareId = $derived($currentDocumentId ?? "");
const shareUrl = $derived(readonlyShare ? buildReadonlyShareUrl(readonlyShare.shareToken) : "");
const publishedShareFingerprint = $derived(
    readonlyShare?.enabled
        ? buildReadonlyShareFingerprint(
              readonlyShare.publishedTitle,
              readonlyShare.publishedTabs,
              readonlyShare.publishedActiveTabId,
          )
        : "",
);
const shareUpToDate = $derived(
    !!readonlyShare?.enabled &&
        currentShareFingerprint !== "" &&
        currentShareFingerprint === publishedShareFingerprint,
);
const shareNeedsUpdate = $derived(
    !!readonlyShare?.enabled && currentShareFingerprint !== "" && !shareUpToDate,
);
const autoUpdateDebounceMs = $derived(
    normalizeReadonlyShareAutoUpdateDebounceMs(appSettings.readonlyShareAutoUpdateDebounceMs),
);
const autoUpdateDelaySeconds = $derived(Math.round(autoUpdateDebounceMs / 1000));
const autoUpdatePausedAfterFailure = $derived(
    autoSharePublishFailedFingerprint !== "" &&
        autoSharePublishFailedFingerprint === currentShareFingerprint,
);
const draftAnnotationCount = $derived(
    modalOpen && activeTab === "preview" && !readonlyShare?.enabled
        ? serializeAnnotations($documentContent, $annotations).length
        : 0,
);

async function refreshReadonlyShare() {
    if (!authenticated || !shareId) {
        readonlyShare = null;
        readonlyShareState.set(null);
        return;
    }

    shareLoading = true;
    try {
        readonlyShare = await getReadonlyShare(shareId);
        readonlyShareState.set(readonlyShare);
    } catch (err) {
        console.error("[share] Failed to load readonly share:", err);
        toast.error("Couldn't load public link settings");
    } finally {
        shareLoading = false;
    }
}

$effect(() => {
    if (modalOpen && dialogEl && !dialogEl.open) {
        dialogEl.showModal();
    }
});

$effect(() => {
    if (!tabTrackEl) return;
    const buttons = tabTrackEl.querySelectorAll<HTMLButtonElement>(".share-tab-btn");
    const idx = activeTab === "collaborate" ? 0 : 1;
    const btn = buttons[idx];
    if (!btn) return;
    tabPillStyle = `--share-pill-width: ${btn.offsetWidth}px; --share-pill-x: ${btn.offsetLeft - 3}px;`;
});

$effect(() => {
    if (!authenticated || !shareId) {
        readonlyShare = null;
        readonlyShareState.set(null);
        currentShareFingerprint = "";
        return;
    }
    refreshReadonlyShare();
});

$effect(() => {
    const title = $currentDocumentTitle;
    const content = $documentContent;
    const annotationSnapshot = $annotations;
    const tabId = $currentTabId;
    const draftId = $currentDraftId;

    if (!authenticated || !shareId || !readonlyShare?.enabled) {
        currentShareFingerprint = "";
        return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
        void (async () => {
            try {
                const payload = await buildPublishPayload();
                if (cancelled) return;
                currentShareFingerprint = buildReadonlyShareFingerprint(
                    payload.title,
                    payload.tabs,
                    payload.activeTabId,
                );
            } catch (err) {
                console.error("[share] Failed to fingerprint readonly share payload:", err);
                if (!cancelled) currentShareFingerprint = "";
            }
        })();
    }, 150);

    void title;
    void content;
    void annotationSnapshot;
    void tabId;
    void draftId;

    return () => {
        cancelled = true;
        window.clearTimeout(timer);
    };
});

$effect(() => {
    const debounceMs = autoUpdateDebounceMs;
    const fingerprint = currentShareFingerprint;
    const shouldAutoPublish = shouldScheduleReadonlyShareAutoUpdate({
        enabled: appSettings.readonlyShareAutoUpdate,
        authenticated,
        shareId,
        shareEnabled: readonlyShare?.enabled ?? false,
        shareNeedsUpdate,
        shareBusy,
        shareLoading,
        currentFingerprint: fingerprint,
        lastFailedFingerprint: autoSharePublishFailedFingerprint,
    });

    if (!shouldAutoPublish) {
        autoSharePublishQueued = false;
        return;
    }

    autoSharePublishQueued = true;
    const timer = window.setTimeout(() => {
        autoSharePublishQueued = false;
        void publishCurrentSnapshot({ automatic: true });
    }, debounceMs);

    return () => {
        window.clearTimeout(timer);
        autoSharePublishQueued = false;
    };
});

// React when owner ends the session (ownerLeftSignal is incremented by yjsProvider)
$effect(() => {
    if ($ownerLeftSignal > 0 && isLive) {
        const view = get(editorView);
        if (view) {
            disableCollab(view);
        } else {
            restoreJoinerPriorView();
        }
        isLive = false;
        toast.error("The owner ended the session");
    }
});

// React to reconnection state changes
$effect(() => {
    const state = $collabState;
    const attempt = $reconnectAttempt;

    // Reconnected successfully
    if (prevCollabState === "reconnecting" && state === "connected") {
        toast.success("Reconnected");
    }

    // Reconnection failed (error state after reconnecting)
    if (prevCollabState === "reconnecting" && state === "error") {
        toast.error("Connection lost. Please go live again to reconnect.");
        const view = get(editorView);
        if (view) {
            disableCollab(view);
        } else {
            restoreJoinerPriorView();
        }
        isLive = false;
    }

    // Started reconnecting (first attempt)
    if (prevCollabState !== "reconnecting" && state === "reconnecting" && attempt === 1) {
        toast("Connection lost, reconnecting...");
    }

    prevCollabState = state;
});

function copyId() {
    navigator.clipboard.writeText(currentId);
    toast.success("Document ID copied");
}

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

function formatShareTimestamp(value: string | null): string {
    if (!value) return "Not published yet";
    return new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
    }).format(new Date(value));
}

type PublishPayload = {
    documentId: string;
    ownerId: string;
    title: string;
    activeTabId: string | null;
    tabs: ReadonlyShareTab[];
};

async function buildPublishPayload(): Promise<PublishPayload> {
    const view = get(editorView);
    const liveDraftId = get(currentDraftId);
    const activeTabId = get(currentTabId);
    const tabs = await listTabs(shareId);
    const publishTabs: ReadonlyShareTab[] = [];

    // No tab metadata currently carries a public/private include flag. Publish
    // every live prose tab's active draft, and add the filter here when scope
    // controls exist.
    for (const tab of tabs) {
        if (tab.tabType !== "draft") continue;

        const drafts = await listTabDrafts(tab.id);
        const persistedDraftId = await getActiveDraft(tab.id);
        const draft =
            drafts.find((candidate) => candidate.id === persistedDraftId) ??
            drafts.find((candidate) => candidate.isActive) ??
            drafts[0];
        if (!draft) continue;

        if (view && draft.id === liveDraftId) {
            const content = view.state.doc.toString();
            const liveAnnotations = view.state.field(annotationField, false);
            publishTabs.push({
                id: tab.id,
                label: tab.label,
                draftId: draft.id,
                content,
                annotations: serializeAnnotations(content, liveAnnotations),
            });
            continue;
        }

        const loaded = await loadDocumentState(shareId, draft.id);
        const serialized = serializeLoadedShareState(loaded);
        publishTabs.push({
            id: tab.id,
            label: tab.label,
            draftId: draft.id,
            content: serialized.content,
            annotations: serialized.annotations,
        });
    }

    if (publishTabs.length === 0) {
        const content = view?.state.doc.toString() ?? $documentContent;
        const liveAnnotations = view?.state.field(annotationField, false) ?? $annotations;
        publishTabs.push({
            id: activeTabId ?? "current",
            label: "Document",
            draftId: liveDraftId,
            content,
            annotations: serializeAnnotations(content, liveAnnotations),
        });
    }

    const activePublishedTab =
        getActiveReadonlyShareTab(publishTabs, activeTabId) ?? publishTabs[0];

    return {
        documentId: shareId,
        ownerId: getUser()?.id ?? "",
        title: $currentDocumentTitle,
        activeTabId: activePublishedTab?.id ?? null,
        tabs: publishTabs,
    };
}

function setReadonlyShareAutoUpdate(enabled: boolean) {
    appSettings.readonlyShareAutoUpdate = enabled;
    appSettings.readonlyShareAutoUpdateDebounceMs = autoUpdateDebounceMs;
    autoSharePublishFailedFingerprint = "";
    persistSettings();
    posthog.capture("readonly_share_auto_update_toggled", { enabled });
}

function handleAutoUpdateDebounceInput(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    appSettings.readonlyShareAutoUpdateDebounceMs = normalizeReadonlyShareAutoUpdateDebounceMs(
        Number(input.value) * 1000,
    );
    persistSettings();
}

function resetAutoUpdateDebounce() {
    appSettings.readonlyShareAutoUpdateDebounceMs = READONLY_SHARE_AUTO_UPDATE_DEFAULT_DEBOUNCE_MS;
    persistSettings();
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

    let payloadFingerprint = "";
    shareBusy = true;
    try {
        const payload = await buildPublishPayload();
        payload.ownerId = user.id;
        const activePublishedTab = getActiveReadonlyShareTab(payload.tabs, payload.activeTabId);
        payloadFingerprint = buildReadonlyShareFingerprint(
            payload.title,
            payload.tabs,
            payload.activeTabId,
        );

        const hadShare = readonlyShare?.enabled ?? false;
        const publishedShare = await publishReadonlyShare(payload);
        readonlyShare = {
            ...publishedShare,
            publishedTitle: payload.title.trim() || "Untitled",
            publishedContent: activePublishedTab?.content ?? "",
            publishedAnnotations: activePublishedTab?.annotations ?? [],
            publishedTabs: payload.tabs,
            publishedActiveTabId: activePublishedTab?.id ?? null,
        };
        readonlyShareState.set(readonlyShare);
        currentShareFingerprint = payloadFingerprint;
        autoSharePublishFailedFingerprint = "";
        posthog.capture(
            options.automatic
                ? "readonly_share_auto_updated"
                : hadShare
                  ? "readonly_share_updated"
                  : "readonly_share_published",
        );
        if (!options.automatic) {
            toast.success(hadShare ? "Public page updated" : "Public page published");
        }
    } catch (err) {
        console.error("[share] Failed to publish readonly share:", err);
        if (options.automatic && payloadFingerprint.length > 0) {
            autoSharePublishFailedFingerprint = payloadFingerprint;
        }
        toast.error(
            options.automatic
                ? "Couldn't auto-update your public page"
                : "Couldn't publish your public page",
        );
    } finally {
        shareBusy = false;
    }
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

    shareBusy = true;
    try {
        readonlyShare = await disableReadonlyShare(shareId);
        readonlyShareState.set(readonlyShare);
        posthog.capture("readonly_share_disabled");
        toast.success("Public link turned off");
    } catch (err) {
        console.error("[share] Failed to disable readonly share:", err);
        toast.error("Couldn't turn off the public link");
    } finally {
        shareBusy = false;
    }
}

async function joinById() {
    const id = joinIdInput.trim();
    if (!id) return;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        toast.error("Invalid document ID format");
        return;
    }

    connecting = true;
    try {
        const view = get(editorView);
        const user = getUser();
        const session = getSession();
        if (!view || !user || !session) {
            throw new Error("Missing required state");
        }

        // Disconnect current session if live
        if (isLive) {
            disableCollab(view);
            isLive = false;
        }

        // D-100: Capture prior view state BEFORE joining
        const priorDraftId = get(currentDraftId);
        joinerPriorView.set({
            draftId: priorDraftId,
            viewType: "editor", // We're in the editor if this button is visible
            editorStateJson: view.state.toJSON(savedFields),
        });

        // D-100: Clear local draft ID -- joiner is NOT editing a local doc.
        // The collab view is ephemeral and backed entirely by the room's Y.Doc.
        // Setting to null ensures persistence listeners skip this session.
        // Note: We still pass `id` to enableCollab for room identification.
        currentDraftId.set(null);

        // Mark this client as an ephemeral joiner BEFORE connecting so the
        // persistence listener skips Yjs-driven document updates. Joiners in
        // Live Room mode don't own the document -- the owner's local store is
        // authoritative, so we don't write the shared ID to our event log.
        isCollabJoiner.set(true);

        // Connect as joiner -- relay's content becomes source of truth
        await enableCollab(view, id, user.id, false);

        joinIdInput = "";
        isLive = true;
        toast.success("Joined shared document");
    } catch (err) {
        console.error("[collab] Failed to join:", err);
        const view = get(editorView);
        if (view) {
            disableCollab(view);
        }
        // Reset joiner state on failure
        const prior = get(joinerPriorView);
        joinerPriorView.set(null);
        isCollabJoiner.set(false);
        // Restore draft ID on failure
        if (prior?.draftId) {
            currentDraftId.set(prior.draftId);
        }
        const message =
            err instanceof Error && err.message.includes("relay")
                ? "Couldn't connect to relay server"
                : "Failed to join document";
        toast.error(message);
    } finally {
        connecting = false;
    }
}

async function handleToggle() {
    if (isLive) {
        // Go offline
        const view = get(editorView);
        const wasJoiner = get(isCollabJoiner);
        if (view) {
            disableCollab(view);
        }
        isLive = false;
        // D-103: restoreJoinerPriorView is called by disableCollab automatically
        // for joiners. Owners stay on current document (no navigation).
        toast.success(wasJoiner ? "Left live room" : "Session ended");
    } else {
        // Go live -- snapshot first (D-58)
        connecting = true;
        try {
            const view = get(editorView);
            const draftId = get(currentDraftId);
            const eventId = get(lastPersistedEventId);
            const user = getUser();
            const session = getSession();

            if (!view || !draftId || !user || !session) {
                throw new Error("Missing required state");
            }

            // Per D-58: Snapshot before pulling remote state
            const stateJson = JSON.stringify(view.state.toJSON(savedFields));
            await createNamedSnapshot(draftId, stateJson, eventId, "Before going live (auto)");

            // Register document with relay's sync_documents table (auto-creates if missing)
            await registerDocumentForCollab(draftId, user.id, "Untitled");

            // Per D-50: clientID is user.id for per-user undo
            // Version comes from relay's initial state
            await enableCollab(view, draftId, user.id);

            isLive = true;
            toast.success("You're live!");
        } catch (err) {
            console.error("[collab] Failed to go live:", err);
            const view = get(editorView);
            if (view) {
                disableCollab(view);
            }
            const message =
                err instanceof Error && err.message.includes("relay")
                    ? "Couldn't connect to relay server"
                    : "Failed to go live";
            toast.error(message);
        } finally {
            connecting = false;
        }
    }
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
                        {isLive
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
                disabled={shareBusy || shareLoading || !shareId}
            >
                {#if shareBusy}
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
                        {#if authenticated}
                            <div class="grid gap-4">
                                <div class="flex items-start gap-3">
                                    <div class="grid size-9 shrink-0 place-items-center rounded-[10px] bg-blue-500/10 text-blue-600">
                                        <Link size={18} />
                                    </div>
                                    <div>
                                        <h3 class="mb-1 text-sm/[1.25] font-[650] text-black/70">Anyone with the link can read your published tabs</h3>
                                        <p class="m-0 text-xs/[1.45] text-black/50">
                                            Publishes the active draft from each live text tab. Keep updates manual or
                                            let them publish after your edits settle.
                                        </p>
                                    </div>
                                </div>

                                <div class="flex items-center justify-between gap-4 rounded-2xl bg-black/[0.035] px-4 py-[14px]">
                                    <div>
                                        <div class="text-[13px] font-bold text-black/75">Public link</div>
                                        <div class="mt-1 text-xs/[1.45] text-black/50">
                                            {#if readonlyShare?.enabled}
                                                On. Readers can open the last published tab set.
                                            {:else}
                                                Off. Your tabs stay private until you publish them.
                                            {/if}
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        class={`relative h-[31px] w-[52px] rounded-full p-[3px] transition-colors duration-200 ease-out disabled:cursor-not-allowed disabled:opacity-45 ${readonlyShare?.enabled ? "bg-[linear-gradient(135deg,rgba(16,185,129,0.95),rgba(5,150,105,0.95))]" : "bg-black/10"}`}
                                        role="switch"
                                        aria-checked={readonlyShare?.enabled ?? false}
                                        aria-label="Toggle public read-only link"
                                        onclick={toggleReadonlyShare}
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
                                                            : autoSharePublishQueued
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
                                            onclick={() =>
                                                setReadonlyShareAutoUpdate(
                                                    !appSettings.readonlyShareAutoUpdate,
                                                )}
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
                                                        onclick={resetAutoUpdateDebounce}
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
                                                oninput={handleAutoUpdateDebounceInput}
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
                                                : "Local tabs have unpublished changes"
                                            : `Ready to publish${buildSharePreviewText($documentContent).length > 0 ? ` • ${draftAnnotationCount} annotation${draftAnnotationCount === 1 ? "" : "s"}` : ""}`}</strong>
                                    </div>
                                </div>

                                <div class="mt-1 flex flex-wrap gap-2.5 max-[520px]:flex-col max-[520px]:items-stretch">
                                    <button
                                        class={`inline-flex min-h-[38px] flex-1 basis-[220px] items-center justify-center gap-[7px] rounded-[10px] px-4 text-[13px] font-[650] text-white transition-[background,opacity] duration-150 max-[520px]:w-full ${shareUpToDate ? "bg-black/20 text-white/90" : "bg-blue-600 hover:bg-blue-700"} disabled:cursor-not-allowed disabled:opacity-45`}
                                        onclick={() => publishCurrentSnapshot()}
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
                                        onclick={copyReadonlyLink}
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
                                            The public page already matches these tabs.
                                        {:else if autoUpdatePausedAfterFailure}
                                            Auto update hit an error. Use
                                            <strong>Update shared version</strong> to retry these tabs.
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
                                    onclick={openAuth}
                                    class="inline-flex min-h-[38px] items-center justify-center gap-[7px] rounded-[10px] bg-blue-600 px-4 text-[13px] font-[650] text-white transition-[background,opacity] duration-150 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-80 disabled:bg-black/[0.04] disabled:text-black/30"
                                >
                                    Sign in
                                </button>
                            </div>
                        {/if}
                    {:else}
                        {#if authenticated}
                            <div class="grid gap-4">
                                <div class="flex items-start gap-3">
                                    <div class="grid size-9 shrink-0 place-items-center rounded-[10px] bg-blue-500/10 text-blue-600">
                                        <Cloud size={18} />
                                    </div>
                                    <div>
                                        <h3 class="mb-1 text-sm/[1.25] font-[650] text-black/70">Live collaboration</h3>
                                        <p class="m-0 text-xs/[1.45] text-black/50">
                                            Bring another writer into this draft right now. Omni will expand this into
                                            persistent sync later, but this room flow still works today.
                                        </p>
                                    </div>
                                </div>
                            </div>

                            <div class="flex items-center justify-between gap-[18px] pt-2.5 max-[520px]:flex-col max-[520px]:items-stretch">
                                <div class="flex items-center gap-3">
                                    <div class={`grid size-9 shrink-0 place-items-center rounded-[10px] ${isLive ? "bg-emerald-500/10 text-emerald-600" : "bg-black/[0.055] text-black/35"}`}>
                                        <Radio size={17} />
                                    </div>
                                    <div>
                                        <h3 class="mb-1 text-sm/[1.25] font-[650] text-black/70">{isLive ? ($isCollabJoiner ? "You're in a Live Room" : "Live Room is open") : "Live Room is off"}</h3>
                                        <p class="m-0 text-xs/[1.45] text-black/50">Invite another writer into this draft.</p>
                                    </div>
                                </div>
                                <button
                                    onclick={handleToggle}
                                    disabled={!isLive && !(authenticated && relayConfigured && !!currentId && !connecting)}
                                    class={`inline-flex min-h-[38px] min-w-[142px] items-center justify-center gap-[7px] rounded-[10px] border px-4 text-[13px] font-[650] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] transition-[background,color,opacity] duration-150 disabled:cursor-not-allowed disabled:opacity-45 max-[520px]:w-full ${isLive ? "border-black/[0.08] bg-black/[0.055] text-black/65 hover:bg-black/[0.085] hover:text-black/80" : "border-emerald-500/20 bg-emerald-500/10 text-black/70 hover:bg-emerald-500/20 hover:text-emerald-800"}`}
                                >
                                    {#if connecting}
                                        <span class="animate-spin" aria-hidden="true">
                                            <Loader2 size={15} />
                                        </span>
                                        Connecting
                                    {:else if $collabState === "reconnecting"}
                                        <span class="animate-spin" aria-hidden="true">
                                            <Loader2 size={15} />
                                        </span>
                                        Retrying {Math.min($reconnectAttempt, MAX_RECONNECT_ATTEMPTS)}/{MAX_RECONNECT_ATTEMPTS}
                                    {:else if isLive}
                                        {$isCollabJoiner ? "Leave" : "End session"}
                                    {:else}
                                        <Radio size={15} />
                                        Start live room
                                    {/if}
                                </button>
                            </div>

                            <div class="mt-[14px] border-t border-black/[0.065] pt-[14px]">
                                <div class="grid gap-0.5">
                                    <span class="text-[13px] font-bold text-black/70">Room details</span>
                                    <span class="text-xs/[1.4] text-black/[0.44]">Copy this room ID or join another room</span>
                                </div>

                                <div class="mt-3 grid gap-3">
                                    <div>
                                        <div class="mb-1.5 block text-[11px] font-[650] text-black/50">Room ID</div>
                                        <div class="flex gap-2 max-[520px]:flex-col">
                                            <input
                                                readonly
                                                value={currentId}
                                                aria-label="Current document room ID"
                                                class="h-9 min-w-0 flex-1 rounded-[10px] border border-black/[0.08] bg-blue-600/[0.04] px-2.5 font-mono text-[11px] text-black/65 outline-none transition-[border-color,box-shadow] focus:border-blue-600/40 focus:shadow-[0_0_0_3px_rgba(37,99,235,0.12)]"
                                            />
                                            <button
                                                onclick={copyId}
                                                disabled={!currentId}
                                                aria-label="Copy document room ID"
                                                class="inline-flex h-9 min-w-[76px] items-center justify-center gap-1.5 rounded-[10px] bg-black/[0.055] px-3 text-xs font-[650] text-black/60 transition-[background,color,opacity] duration-150 hover:bg-black/[0.085] hover:text-black/75 disabled:cursor-not-allowed disabled:opacity-45 max-[520px]:w-full"
                                            >
                                                <Copy size={14} />
                                                Copy
                                            </button>
                                        </div>
                                    </div>

                                    <form
                                        onsubmit={(e) => {
                                            e.preventDefault();
                                            joinById();
                                        }}
                                    >
                                        <label for="join-id" class="mb-1.5 block text-[11px] font-[650] text-black/50">Join with room ID</label>
                                        <div class="flex gap-2 max-[520px]:flex-col">
                                            <input
                                                id="join-id"
                                                bind:value={joinIdInput}
                                                placeholder="Paste UUID..."
                                                autocomplete="off"
                                                class="h-9 min-w-0 flex-1 rounded-[10px] border border-black/[0.08] bg-black/[0.035] px-2.5 font-mono text-[11px] text-black/65 outline-none transition-[border-color,box-shadow] focus:border-blue-600/40 focus:shadow-[0_0_0_3px_rgba(37,99,235,0.12)]"
                                            />
                                            <button
                                                type="submit"
                                                disabled={connecting || !joinIdInput.trim()}
                                                class="inline-flex h-9 min-w-[76px] items-center justify-center gap-1.5 rounded-[10px] bg-black/[0.055] px-3 text-xs font-[650] text-black/60 transition-[background,color,opacity] duration-150 hover:bg-black/[0.085] hover:text-black/75 disabled:cursor-not-allowed disabled:opacity-45 max-[520px]:w-full"
                                            >
                                                Join
                                            </button>
                                        </div>
                                    </form>
                                </div>
                            </div>

                            <div class="mt-[14px] flex items-center justify-end max-[520px]:justify-start">
                                <a
                                    href={OMNI_WAITLIST_URL}
                                    target="_blank"
                                    rel="noreferrer"
                                    class="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-[650] text-black/50 transition-colors duration-150 hover:text-black/70"
                                >
                                    Learn about Omni
                                    <ExternalLink size={14} />
                                </a>
                            </div>

                            <div class="mt-[18px] border-t border-black/[0.065] pt-4">
                                <div class="mb-2 text-[10px] font-[750] uppercase tracking-[0.06em] text-black/35">In the making</div>
                                <div class="flex items-start gap-3 rounded-xl bg-black/[0.035] p-3 opacity-70">
                                    <div class="grid size-9 shrink-0 place-items-center rounded-[10px] bg-black/[0.055] text-black/35">
                                        <ArrowLeftRight size={17} />
                                    </div>
                                    <div>
                                        <h3 class="mb-1 text-sm/[1.25] font-[650] text-black/70">Async Collaboration</h3>
                                        <p class="m-0 text-xs/[1.45] text-black/50">
                                            Stored on our servers to stay available even after you close Quillium.
                                        </p>
                                    </div>
                                </div>
                                <div class="mt-2 flex items-start gap-3 rounded-xl bg-black/[0.035] p-3 opacity-70">
                                    <div class="grid size-9 shrink-0 place-items-center rounded-[10px] bg-black/[0.055] text-black/35">
                                        <Cloud size={17} />
                                    </div>
                                    <div>
                                        <h3 class="mb-1 text-sm/[1.25] font-[650] text-black/70">Cloud Sync</h3>
                                        <p class="m-0 text-xs/[1.45] text-black/50">Make this document available on all of your devices.</p>
                                    </div>
                                </div>
                            </div>
                        {:else}
                            <div class="grid gap-4">
                                <div class="flex items-start gap-3">
                                    <div class="grid size-9 shrink-0 place-items-center rounded-[10px] bg-blue-500/10 text-blue-600">
                                        <Cloud size={18} />
                                    </div>
                                    <div>
                                        <h3 class="mb-1 text-sm/[1.25] font-[650] text-black/70">Collaboration is part of Quillium Omni</h3>
                                        <p class="m-0 text-xs/[1.45] text-black/50">
                                            Live Room, shared invites, cloud sync, and the rest of Quillium's collaboration
                                            features are available exclusively to Omni users.
                                        </p>
                                    </div>
                                </div>

                                <div class="grid gap-2.5 rounded-2xl border border-black/[0.055] bg-black/[0.035] px-4 py-[14px]">
                                    <div class="grid gap-1">
                                        <span class="text-[10px] font-[750] uppercase tracking-[0.06em] text-black/40">Account</span>
                                        <strong class="break-words text-[13px]/[1.45] text-black/75">Not signed in</strong>
                                    </div>
                                    <div class="grid gap-1">
                                        <span class="text-[10px] font-[750] uppercase tracking-[0.06em] text-black/40">Status</span>
                                        <strong class="break-words text-[13px]/[1.45] text-black/75">Omni is currently waitlist only</strong>
                                    </div>
                                    <div class="grid gap-1">
                                        <span class="text-[10px] font-[750] uppercase tracking-[0.06em] text-black/40">Access</span>
                                        <strong class="break-words text-[13px]/[1.45] text-black/75">You can't sign up for Omni directly yet. Join the waitlist to get access.</strong>
                                    </div>
                                </div>

                                <div class="mt-1 flex flex-wrap gap-2.5 max-[520px]:flex-col max-[520px]:items-stretch">
                                    <a
                                        href={OMNI_WAITLIST_URL}
                                        target="_blank"
                                        rel="noreferrer"
                                        class="inline-flex min-h-[38px] flex-1 basis-[220px] items-center justify-center gap-[7px] rounded-[10px] bg-blue-600 px-4 text-[13px] font-[650] text-white transition-[background,opacity] duration-150 hover:bg-blue-700"
                                    >
                                        <ExternalLink size={15} />
                                        Join the Omni waitlist
                                    </a>

                                    <button
                                        class="inline-flex min-h-[38px] items-center justify-center gap-[7px] rounded-[10px] bg-black/[0.055] px-4 text-[13px] font-[650] text-black/70 transition-[background,color] duration-150 hover:bg-black/[0.085] hover:text-black/80 max-[520px]:w-full"
                                        onclick={openAuth}
                                    >
                                        <LogIn size={15} />
                                        Sign in
                                    </button>
                                </div>
                            </div>

                            <div class="mt-[18px] border-t border-black/[0.065] pt-4">
                                <div class="flex items-start gap-3">
                                    <div class="grid size-9 shrink-0 place-items-center rounded-[10px] bg-black/[0.055] text-black/35">
                                        <ArrowLeftRight size={17} />
                                    </div>
                                    <div>
                                        <h3 class="mb-1 text-sm/[1.25] font-[650] text-black/70">Already have access?</h3>
                                        <p class="m-0 text-xs/[1.45] text-black/50">
                                            Sign in with the account tied to your Omni invite once access has been enabled for you.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        {/if}
                    {/if}
                </section>
            </div>
        </dialog>
    {/if}
{/if}
