<!--
    GoLiveButton.svelte -- Top-right collab toggle.

    Per D-56: "Go Live" toggle in top-right area (near AuthButton).
    Per D-57: Live Room mode only -- session ends when owner leaves.
    Per D-58: Snapshot before pulling remote state.
    Per D-59: Manual toggle for owner's own documents.
    Per D-70: Updated for Yjs migration.
-->
<script lang="ts">
import { isAuthenticated, getUser, getSession } from "$lib/auth/auth.svelte";
import { supabaseConfigured } from "$lib/auth/supabase";
import {
    annotations,
    currentDocumentTitle,
    currentDraftId,
    documentContent,
    editorView,
    lastPersistedEventId,
} from "$lib/stores";
import { createNamedSnapshot } from "$lib/db";
import { isCollabJoiner, joinerPriorView } from "$lib/collab/store";
import { savedFields } from "$lib/editor/extensions";
import { annotationField } from "$lib/editor/plugins/annotations";
import { OMNI_WAITLIST_URL } from "$lib/constants";
import {
    buildSharePreviewText,
    buildReadonlyShareUrl,
    disableReadonlyShare,
    getReadonlyShare,
    publishReadonlyShare,
    readonlyShareState,
    type ReadonlyShare,
} from "$lib/collab/share";
import { buildShareFingerprint, serializeAnnotations } from "$lib/collab/sharePayload";
import {
    enableCollab,
    disableCollab,
    restoreJoinerPriorView,
    relayConfigured,
    registerDocumentForCollab,
    ownerLeftSignal,
    collabState,
    reconnectAttempt,
    MAX_RECONNECT_ATTEMPTS,
} from "$lib/collab";
import { get } from "svelte/store";
import { toast } from "svelte-sonner";
import {
    ArrowLeftRight,
    ChevronDown,
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
import posthog from "$lib/posthog";

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

const authenticated = $derived(isAuthenticated());
const canShowShare = $derived(relayConfigured || supabaseConfigured);
const currentId = $derived($currentDraftId ?? "");
const shareUrl = $derived(readonlyShare ? buildReadonlyShareUrl(readonlyShare.shareToken) : "");
const currentSharePayload = $derived({
    title: $currentDocumentTitle,
    content: $documentContent,
    annotations: serializeAnnotations($documentContent, $annotations),
});
const currentSerializedAnnotations = $derived(currentSharePayload.annotations);
const currentShareFingerprint = $derived(
    buildShareFingerprint(
        currentSharePayload.title,
        currentSharePayload.content,
        currentSharePayload.annotations,
    ),
);
const publishedShareFingerprint = $derived(
    readonlyShare
        ? buildShareFingerprint(
              readonlyShare.publishedTitle,
              readonlyShare.publishedContent,
              readonlyShare.publishedAnnotations,
          )
        : "",
);
const shareUpToDate = $derived(
    !!readonlyShare?.enabled && currentShareFingerprint === publishedShareFingerprint,
);
const shareNeedsUpdate = $derived(!!readonlyShare?.enabled && !shareUpToDate);

async function refreshReadonlyShare() {
    if (!authenticated || !currentId) {
        readonlyShare = null;
        readonlyShareState.set(null);
        return;
    }

    shareLoading = true;
    try {
        readonlyShare = await getReadonlyShare(currentId);
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
    if (!authenticated || !currentId) {
        readonlyShare = null;
        readonlyShareState.set(null);
        return;
    }
    refreshReadonlyShare();
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

function buildPublishPayload() {
    const view = get(editorView);
    const content = view?.state.doc.toString() ?? $documentContent;
    const liveAnnotations = view?.state.field(annotationField, false) ?? $annotations;

    return {
        documentId: currentId,
        ownerId: getUser()?.id ?? "",
        title: $currentDocumentTitle,
        content,
        annotations: serializeAnnotations(content, liveAnnotations),
    };
}

async function copyReadonlyLink() {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    posthog.capture("readonly_share_link_copied");
    toast.success("Public link copied");
}

async function publishCurrentSnapshot() {
    const user = getUser();
    if (!user || !currentId) {
        toast.error("Open a document and sign in to publish it");
        return;
    }

    const payload = buildPublishPayload();
    payload.ownerId = user.id;

    shareBusy = true;
    try {
        const hadShare = readonlyShare?.enabled ?? false;
        const publishedShare = await publishReadonlyShare(payload);
        readonlyShare = {
            ...publishedShare,
            publishedTitle: payload.title.trim() || "Untitled",
            publishedContent: payload.content,
            publishedAnnotations: payload.annotations,
        };
        readonlyShareState.set(readonlyShare);
        posthog.capture(hadShare ? "readonly_share_updated" : "readonly_share_published");
        toast.success(hadShare ? "Public page updated" : "Public page published");
    } catch (err) {
        console.error("[share] Failed to publish readonly share:", err);
        toast.error("Couldn't publish your public page");
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
        readonlyShare = await disableReadonlyShare(currentId);
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
        if (view) {
            disableCollab(view);
        }
        isLive = false;
        // D-103: restoreJoinerPriorView is called by disableCollab automatically
        // for joiners. Owners stay on current document (no navigation).
        toast.success("Session ended");
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
    <div class="share-trigger-wrap relative flex flex-col items-end gap-2">
        <button
            onclick={() => (modalOpen = true)}
            class="share-trigger-button inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-full shadow-md transition-colors
                {isLive
                    ? 'bg-emerald-500 text-white hover:bg-emerald-600'
                    : 'text-black/55 bg-white/55 backdrop-blur-md hover:text-black/75 hover:bg-white/70'}"
            aria-haspopup="dialog"
            aria-label={shareNeedsUpdate ? "Share, public link has unpublished changes" : "Share"}
        >
            <Share2 size={14} />
            Share

            {#if shareNeedsUpdate}
                <span class="share-update-dot" aria-hidden="true"></span>
            {/if}
        </button>

        {#if shareNeedsUpdate}
            <button
                type="button"
                class="share-update-pill"
                onclick={updateWebPreviewQuickAction}
                disabled={shareBusy || shareLoading || !currentId}
            >
                {#if shareBusy}
                    <span class="spin" aria-hidden="true">
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
        <dialog bind:this={dialogEl} class="share-modal" onclick={handleBackdropClick}>
            <div class="share-modal-inner">
                <header class="share-modal-header">
                    <div>
                        <div class="title-row">
                            <h2>Share your document</h2>
                            <span class="beta-pill">Beta</span>
                        </div>
                    </div>
                    <button
                        onclick={closeModal}
                        aria-label="Close"
                        class="close-btn"
                    >
                        <span>esc</span>
                        <X size={15} />
                    </button>
                </header>

                <p class="share-note">
                    Because writing is better together, always.
                </p>

                <div
                    class="share-tabs"
                    bind:this={tabTrackEl}
                    style={tabPillStyle}
                    role="tablist"
                    aria-label="Share modes"
                >
                    <div class="share-tab-pill"></div>
                    <button
                        role="tab"
                        aria-selected={activeTab === "collaborate"}
                        onclick={() => (activeTab = "collaborate")}
                        class="share-tab-btn"
                        class:active={activeTab === "collaborate"}
                    >
                        Omni
                    </button>
                    <button
                        role="tab"
                        aria-selected={activeTab === "preview"}
                        onclick={() => (activeTab = "preview")}
                        class="share-tab-btn"
                        class:active={activeTab === "preview"}
                    >
                        Web preview
                    </button>
                </div>

                <section class="share-panel">
                    {#if activeTab === "preview"}
                        {#if authenticated}
                            <div class="share-mode-card">
                                <div class="panel-copy">
                                    <div class="icon-badge">
                                        <Link size={18} />
                                    </div>
                                    <div>
                                        <h3>Anyone with the link can read your document</h3>
                                        <p>
                                            Publish a read-only web page with Quillium branding. It only updates when
                                            you explicitly publish again.
                                        </p>
                                    </div>
                                </div>

                                <div class="share-toggle-row">
                                    <div>
                                        <div class="toggle-label">Public link</div>
                                        <div class="toggle-help">
                                            {#if readonlyShare?.enabled}
                                                On. Readers can open the last published snapshot.
                                            {:else}
                                                Off. Your document stays private until you publish it.
                                            {/if}
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        class="share-switch"
                                        role="switch"
                                        aria-checked={readonlyShare?.enabled ?? false}
                                        aria-label="Toggle public read-only link"
                                        onclick={toggleReadonlyShare}
                                        disabled={shareBusy || shareLoading || !currentId}
                                    >
                                        <span></span>
                                    </button>
                                </div>

                                <div class="share-detail-card">
                                        <div class="detail-row">
                                            <span>Public URL</span>
                                            <strong>{readonlyShare?.enabled ? shareUrl : "Publish to generate a link"}</strong>
                                        </div>
                                        <div class="detail-row">
                                            <span>Last published</span>
                                            <strong>{formatShareTimestamp(readonlyShare?.publishedAt ?? null)}</strong>
                                        </div>
                                        <div class="detail-row">
                                            <span>Snapshot status</span>
                                            <strong
                                                class:muted-detail={shareUpToDate}
                                                >{readonlyShare?.enabled
                                                    ? shareUpToDate
                                                        ? "Already up to date"
                                                        : "Local draft has unpublished changes"
                                                    : `Ready to publish${buildSharePreviewText($documentContent).length > 0 ? ` • ${currentSerializedAnnotations.length} annotation${currentSerializedAnnotations.length === 1 ? "" : "s"}` : ""}`}</strong
                                            >
                                        </div>
                                    </div>

                                <div class="share-actions">
                                    <button
                                        class="primary-action share-primary"
                                        onclick={publishCurrentSnapshot}
                                        class:primary-action-muted={shareUpToDate}
                                        disabled={shareBusy || shareLoading || !currentId || shareUpToDate}
                                    >
                                        {#if shareBusy}
                                            <span class="spin" aria-hidden="true">
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
                                        class="secondary-action"
                                        onclick={copyReadonlyLink}
                                        disabled={!readonlyShare?.enabled || !shareUrl}
                                    >
                                        <Copy size={15} />
                                        Copy link
                                    </button>
                                </div>

                                {#if shareLoading}
                                    <p class="share-status-line">Loading your public link settings…</p>
                                {:else if readonlyShare?.enabled}
                                    <p class="share-status-line">
                                        {#if shareUpToDate}
                                            The public page already matches this draft.
                                        {:else}
                                            Readers keep seeing the current snapshot until you click
                                            <strong>Update shared version</strong>.
                                        {/if}
                                    </p>
                                {/if}
                            </div>
                        {:else}
                            <div class="panel-copy">
                                <div class="icon-badge">
                                    <LogIn size={18} />
                                </div>
                                <div>
                                    <h3>Sign in to publish a public link</h3>
                                    <p>
                                        Read-only sharing uses your Quillium account so you can turn links on and off.
                                    </p>
                                </div>
                            </div>

                            <div class="auth-actions auth-actions-single">
                                <button onclick={openAuth}>Sign in</button>
                            </div>
                        {/if}
                    {:else}
                        {#if authenticated}
                            <div class="omni-intro">
                                <div class="panel-copy">
                                    <div class="icon-badge">
                                        <Cloud size={18} />
                                    </div>
                                    <div>
                                        <h3>Live collaboration</h3>
                                        <p>
                                            Bring another writer into this draft right now. Omni will expand this into
                                            persistent sync later, but this room flow still works today.
                                        </p>
                                    </div>
                                </div>
                            </div>

                            <div class="status-card">
                                <!-- <div class="status-copy">
                                    <div>
                                        <h3>{isLive ? "Live Room is open" : "Live Room is off"}</h3>
                                        <p>
                                            Invite another writer into this draft.
                                        </p>
                                    </div>
                                </div> -->
                                <button
                                    onclick={handleToggle}
                                    disabled={!isLive && !(authenticated && relayConfigured && !!currentId && !connecting)}
                                    class="live-action"
                                    class:danger={isLive}
                                >
                                    {#if connecting}
                                        <span class="spin" aria-hidden="true">
                                            <Loader2 size={15} />
                                        </span>
                                        Connecting
                                    {:else if $collabState === "reconnecting"}
                                        <span class="spin" aria-hidden="true">
                                            <Loader2 size={15} />
                                        </span>
                                        Retrying {Math.min($reconnectAttempt, MAX_RECONNECT_ATTEMPTS)}/{MAX_RECONNECT_ATTEMPTS}
                                    {:else if isLive}
                                        End session
                                    {:else}
                                        <Radio size={15} />
                                        Start live room
                                    {/if}
                                </button>
                            </div>

                            <details class="live-tools-disclosure">
                                <summary>
                                    <span class="live-tools-summary-main">
                                        <span>Room details</span>
                                        <span class="live-tools-summary-copy">
                                            Copy this room ID or join another room
                                        </span>
                                    </span>
                                    <span class="live-tools-summary-icon" aria-hidden="true">
                                        <ChevronDown size={16} />
                                    </span>
                                </summary>

                                <div class="live-tools-disclosure-body">
                                <div class="live-tools">
                                    <div class="doc-id-block room-field">
                                        <div class="field-label">Room ID</div>
                                        <div class="copy-row">
                                            <input readonly value={currentId} aria-label="Current document room ID" />
                                            <button onclick={copyId} disabled={!currentId} aria-label="Copy document room ID">
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
                                        class="join-block room-field"
                                    >
                                        <label for="join-id">Join with room ID</label>
                                        <div class="copy-row">
                                            <input
                                                id="join-id"
                                                bind:value={joinIdInput}
                                                placeholder="Paste UUID..."
                                                autocomplete="off"
                                            />
                                            <button type="submit" disabled={connecting || !joinIdInput.trim()}>
                                                Join
                                            </button>
                                        </div>
                                    </form>
                                </div>
                                </div>
                            </details>

                            <div class="omni-link-row">
                                <a
                                    href={OMNI_WAITLIST_URL}
                                    target="_blank"
                                    rel="noreferrer"
                                    class="omni-inline-link"
                                >
                                    Learn about Omni
                                    <ExternalLink size={14} />
                                </a>
                            </div>

                            <div class="future-section">
                                <div class="future-label">In the making</div>
                                <div class="disabled-option" aria-disabled="true">
                                    <div class="icon-badge muted">
                                        <ArrowLeftRight size={17} />
                                    </div>
                                    <div>
                                        <h3>Async Collaboration</h3>
                                        <p>
                                            Stored on our servers to stay available even after you close Quillium.
                                        </p>
                                    </div>
                                </div>
                                <div class="disabled-option" aria-disabled="true">
                                    <div class="icon-badge muted">
                                        <Cloud size={17} />
                                    </div>
                                    <div>
                                        <h3>Cloud Sync</h3>
                                        <p>Make this document available on all of your devices.</p>
                                    </div>
                                </div>
                            </div>
                        {:else}
                            <div class="omni-hero">
                                <div class="panel-copy">
                                    <div class="icon-badge">
                                        <Cloud size={18} />
                                    </div>
                                    <div>
                                        <h3>Collaboration is part of Quillium Omni</h3>
                                        <p>
                                            Live Room, shared invites, cloud sync, and the rest of Quillium's collaboration
                                            features are available exclusively to Omni users.
                                        </p>
                                    </div>
                                </div>

                                <div class="share-detail-card">
                                    <div class="detail-row">
                                        <span>Account</span>
                                        <strong>Not signed in</strong>
                                    </div>
                                    <div class="detail-row">
                                        <span>Status</span>
                                        <strong>Omni is currently waitlist only</strong>
                                    </div>
                                    <div class="detail-row">
                                        <span>Access</span>
                                        <strong>You can't sign up for Omni directly yet. Join the waitlist to get access.</strong>
                                    </div>
                                </div>

                                <div class="share-actions">
                                    <a
                                        href={OMNI_WAITLIST_URL}
                                        target="_blank"
                                        rel="noreferrer"
                                        class="primary-action share-primary link-action"
                                    >
                                        <ExternalLink size={15} />
                                        Join the Omni waitlist
                                    </a>

                                    <button class="secondary-action" onclick={openAuth}>
                                        <LogIn size={15} />
                                        Sign in
                                    </button>
                                </div>
                            </div>

                            <div class="future-section">
                                <div class="panel-copy">
                                    <div class="icon-badge muted">
                                        <ArrowLeftRight size={17} />
                                    </div>
                                    <div>
                                        <h3>Already have access?</h3>
                                        <p>
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

<style>
    .share-modal {
        border: none;
        padding: 0;
        background: transparent;
        width: 100vw;
        height: 100vh;
        max-width: 100vw;
        max-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .share-modal::backdrop {
        background: rgba(0, 0, 0, 0.22);
        backdrop-filter: blur(5px);
    }

    .share-modal-inner {
        width: min(560px, calc(100vw - 32px));
        background: rgba(255, 255, 255, 0.96);
        border: 1px solid rgba(0, 0, 0, 0.06);
        border-radius: 16px;
        box-shadow: 0 24px 70px rgba(0, 0, 0, 0.2);
        overflow: hidden;
    }

    .share-modal-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
        padding: 22px 24px 10px;
    }

    .title-row {
        display: flex;
        align-items: center;
        gap: 10px;
    }

    .beta-pill {
        display: inline-flex;
        align-items: center;
        height: 20px;
        padding: 0 8px;
        border-radius: 999px;
        background: rgba(251, 191, 36, 0.15);
        color: rgb(217, 119, 6);
        font-size: 10px;
        font-weight: 750;
        letter-spacing: 0.06em;
        text-transform: uppercase;
    }

    h2 {
        margin: 0;
        font-size: 24px;
        line-height: 1.1;
        font-weight: 650;
        color: rgba(0, 0, 0, 0.78);
    }

    .close-btn {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 4px 6px 4px 8px;
        border-radius: 8px;
        color: rgba(0, 0, 0, 0.28);
        transition: color 0.16s, background 0.16s;
    }

    .close-btn:hover {
        color: rgba(0, 0, 0, 0.55);
        background: rgba(0, 0, 0, 0.05);
    }

    .close-btn span {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 9px;
        color: rgba(0, 0, 0, 0.22);
    }

    .share-note {
        margin: 0;
        padding: 0 24px 16px;
        font-size: 12px;
        line-height: 1.45;
        color: rgba(0, 0, 0, 0.46);
    }

    .share-tabs {
        position: relative;
        display: flex;
        gap: 2px;
        margin: 0 24px;
        padding: 3px;
        border-radius: 999px;
        background: rgba(0, 0, 0, 0.055);
        box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.06);
    }

    .share-tab-pill {
        position: absolute;
        top: 3px;
        left: 3px;
        height: calc(100% - 6px);
        width: var(--share-pill-width, 50%);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.82);
        box-shadow:
            0 1px 4px rgba(0, 0, 0, 0.12),
            inset 0 1px 0 rgba(255, 255, 255, 0.95);
        transform: translateX(var(--share-pill-x, 0px));
        transition:
            transform 0.25s cubic-bezier(0.34, 1.2, 0.64, 1),
            width 0.25s cubic-bezier(0.34, 1.2, 0.64, 1);
    }

    .share-tab-btn {
        position: relative;
        z-index: 1;
        flex: 1;
        min-width: 0;
        padding: 7px 10px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 600;
        color: rgba(0, 0, 0, 0.42);
        transition: color 0.18s;
    }

    .share-tab-btn.active {
        color: rgba(0, 0, 0, 0.72);
    }

    .share-trigger-wrap {
        position: relative;
    }

    .share-trigger-button {
        position: relative;
    }

    .share-update-dot {
        position: absolute;
        top: -3px;
        right: -3px;
        width: 10px;
        height: 10px;
        border-radius: 999px;
        background: rgb(37, 99, 235);
        box-shadow:
            0 0 0 3px rgba(255, 255, 255, 0.92),
            0 4px 10px rgba(59, 130, 246, 0.2);
    }

    .share-update-pill {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        min-height: 32px;
        padding: 0 12px;
        border-radius: 999px;
        background: rgba(59, 130, 246, 0.12);
        border: 1px solid rgba(59, 130, 246, 0.16);
        color: rgba(29, 78, 216, 0.9);
        font-size: 12px;
        font-weight: 650;
        box-shadow:
            0 10px 28px rgba(59, 130, 246, 0.12),
            inset 0 1px 0 rgba(255, 255, 255, 0.7);
        transition:
            background 0.16s,
            color 0.16s,
            transform 0.18s ease,
            opacity 0.18s ease,
            visibility 0.18s ease;
        opacity: 0;
        visibility: hidden;
        transform: translateY(-8px) scale(0.96);
        pointer-events: none;
    }

    .share-update-pill:hover:not(:disabled) {
        background: rgba(59, 130, 246, 0.18);
        color: rgba(30, 64, 175, 0.96);
        transform: translateY(-1px);
    }

    .share-trigger-wrap:hover .share-update-pill,
    .share-trigger-wrap:focus-within .share-update-pill {
        opacity: 1;
        visibility: visible;
        transform: translateY(0) scale(1);
        pointer-events: auto;
    }

    .share-tab-btn:hover {
        color: rgba(0, 0, 0, 0.6);
    }

    .share-panel {
        margin: 14px 18px 18px;
        padding: 18px;
        border: 1px solid rgba(0, 0, 0, 0.07);
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.78);
    }

    .share-mode-card,
    .omni-hero,
    .omni-intro {
        display: grid;
        gap: 16px;
    }

    .panel-copy {
        display: flex;
        gap: 12px;
        align-items: flex-start;
    }

    .status-copy,
    .disabled-option {
        display: flex;
        gap: 12px;
        align-items: flex-start;
    }

    .icon-badge {
        width: 36px;
        height: 36px;
        flex: 0 0 auto;
        display: grid;
        place-items: center;
        border-radius: 10px;
        color: rgb(37, 99, 235);
        background: rgba(59, 130, 246, 0.1);
    }

    .icon-badge.muted {
        color: rgba(0, 0, 0, 0.36);
        background: rgba(0, 0, 0, 0.055);
    }

    h3 {
        margin: 0 0 4px;
        font-size: 14px;
        line-height: 1.25;
        font-weight: 650;
        color: rgba(0, 0, 0, 0.72);
    }

    .panel-copy p {
        margin: 0;
        font-size: 12px;
        line-height: 1.45;
        color: rgba(0, 0, 0, 0.48);
    }

    .status-copy p,
    .disabled-option p {
        margin: 0;
        font-size: 12px;
        line-height: 1.45;
        color: rgba(0, 0, 0, 0.48);
    }

    .primary-action,
    .auth-actions button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
        min-height: 38px;
        padding: 0 16px;
        border-radius: 10px;
        font-size: 13px;
        font-weight: 650;
        color: white;
        background: rgb(37, 99, 235);
        transition: background 0.16s, opacity 0.16s;
    }

    .primary-action {
        width: 100%;
        margin-top: 12px;
    }

    .share-primary {
        width: auto;
        margin-top: 0;
        flex: 1 1 220px;
    }

    .primary-action:disabled,
    .secondary-action:disabled,
    .share-switch:disabled {
        opacity: 0.45;
        cursor: not-allowed;
    }

    .link-action {
        text-decoration: none;
    }

    .status-card {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 18px;
        padding: 10px 0 0;
    }

    .status-copy {
        align-items: center;
    }

    .auth-actions button:hover {
        background: rgb(29, 78, 216);
    }

    .live-action {
        flex: 0 0 auto;
        min-width: 142px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
        min-height: 38px;
        padding: 0 16px;
        border-radius: 10px;
        font-size: 13px;
        font-weight: 650;
        color: rgba(0, 0, 0, 0.7);
        background: rgba(16, 185, 129, 0.12);
        border: 1px solid rgba(16, 185, 129, 0.2);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.7);
        transition: background 0.16s, color 0.16s, opacity 0.16s;
    }

    .live-action:hover:not(:disabled) {
        color: rgba(4, 120, 87, 0.96);
        background: rgba(16, 185, 129, 0.18);
    }

    .live-action.danger {
        color: rgba(0, 0, 0, 0.64);
        background: rgba(0, 0, 0, 0.055);
        border-color: rgba(0, 0, 0, 0.08);
    }

    .live-action.danger:hover:not(:disabled) {
        color: rgba(0, 0, 0, 0.78);
        background: rgba(0, 0, 0, 0.085);
    }

    .spin {
        animation: spin 0.9s linear infinite;
    }

    @keyframes spin {
        to {
            transform: rotate(360deg);
        }
    }

    .doc-id-block,
    .join-block {
        margin-top: 0;
    }

    .live-tools {
        display: grid;
        gap: 12px;
        margin-top: 12px;
    }

    .room-field {
        padding: 0;
    }

    .live-tools-disclosure {
        margin-top: 14px;
        border-top: 1px solid rgba(0, 0, 0, 0.065);
        padding-top: 14px;
    }

    .live-tools-disclosure summary {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        cursor: pointer;
        list-style: none;
        color: rgba(0, 0, 0, 0.7);
    }

    .live-tools-disclosure summary::-webkit-details-marker {
        display: none;
    }

    .live-tools-disclosure summary span:first-child {
        display: block;
    }

    .live-tools-summary-main {
        display: grid;
        gap: 2px;
    }

    .live-tools-summary-main span:first-child {
        font-size: 13px;
        font-weight: 700;
    }

    .live-tools-summary-copy {
        font-size: 12px;
        line-height: 1.4;
        color: rgba(0, 0, 0, 0.44);
    }

    .live-tools-summary-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        border-radius: 999px;
        color: rgba(0, 0, 0, 0.46);
        background: rgba(0, 0, 0, 0.045);
        transition:
            transform 0.18s ease,
            background 0.18s ease,
            color 0.18s ease;
    }

    .live-tools-disclosure[open] .live-tools-summary-icon {
        transform: rotate(180deg);
        color: rgba(0, 0, 0, 0.64);
        background: rgba(0, 0, 0, 0.065);
    }

    .live-tools-disclosure-body {
        display: grid;
        grid-template-rows: 0fr;
        transition: grid-template-rows 0.22s ease;
    }

    .live-tools-disclosure[open] .live-tools-disclosure-body {
        grid-template-rows: 1fr;
    }

    .live-tools-disclosure-body > .live-tools {
        overflow: hidden;
    }

    .field-label,
    .join-block label {
        display: block;
        margin-bottom: 6px;
        font-size: 11px;
        font-weight: 650;
        color: rgba(0, 0, 0, 0.48);
    }

    .copy-row {
        display: flex;
        gap: 8px;
    }

    .copy-row input {
        min-width: 0;
        flex: 1;
        height: 36px;
        padding: 0 10px;
        border: 1px solid rgba(0, 0, 0, 0.08);
        border-radius: 10px;
        background: rgba(0, 0, 0, 0.035);
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 11px;
        color: rgba(0, 0, 0, 0.64);
        outline: none;
    }

    .room-field input[readonly] {
        background: rgba(37, 99, 235, 0.04);
    }

    .copy-row input:focus {
        border-color: rgba(37, 99, 235, 0.38);
        box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
    }

    .copy-row button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        min-width: 76px;
        height: 36px;
        padding: 0 12px;
        border-radius: 10px;
        background: rgba(0, 0, 0, 0.055);
        font-size: 12px;
        font-weight: 650;
        color: rgba(0, 0, 0, 0.58);
        transition: background 0.16s, color 0.16s, opacity 0.16s;
    }

    .copy-row button:hover:not(:disabled) {
        background: rgba(0, 0, 0, 0.085);
        color: rgba(0, 0, 0, 0.74);
    }

    .share-toggle-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 14px 16px;
        border-radius: 16px;
        background: rgba(0, 0, 0, 0.035);
    }

    .toggle-label {
        font-size: 13px;
        font-weight: 700;
        color: rgba(0, 0, 0, 0.76);
    }

    .toggle-help,
    .share-status-line {
        margin: 4px 0 0;
        font-size: 12px;
        line-height: 1.45;
        color: rgba(0, 0, 0, 0.5);
    }

    .share-switch {
        position: relative;
        width: 52px;
        height: 31px;
        padding: 3px;
        border-radius: 999px;
        background: rgba(0, 0, 0, 0.12);
        transition: background 0.18s ease;
    }

    .share-switch[aria-checked="true"] {
        background: linear-gradient(135deg, rgba(16, 185, 129, 0.95), rgba(5, 150, 105, 0.95));
    }

    .share-switch span {
        display: block;
        width: 25px;
        height: 25px;
        border-radius: 999px;
        background: white;
        box-shadow: 0 3px 10px rgba(0, 0, 0, 0.18);
        transform: translateX(0);
        transition: transform 0.18s ease;
    }

    .share-switch[aria-checked="true"] span {
        transform: translateX(21px);
    }

    .share-detail-card {
        display: grid;
        gap: 10px;
        padding: 14px 16px;
        border-radius: 16px;
        background: rgba(0, 0, 0, 0.035);
        border: 1px solid rgba(0, 0, 0, 0.055);
    }

    .detail-row {
        display: grid;
        gap: 4px;
    }

    .detail-row span {
        font-size: 10px;
        font-weight: 750;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: rgba(0, 0, 0, 0.38);
    }

    .detail-row strong {
        font-size: 13px;
        line-height: 1.45;
        color: rgba(0, 0, 0, 0.74);
        word-break: break-word;
    }

    .detail-row strong.muted-detail {
        color: rgba(0, 0, 0, 0.52);
    }

    .share-actions {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        margin-top: 4px;
    }

    .secondary-action {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
        min-height: 38px;
        padding: 0 16px;
        border-radius: 10px;
        font-size: 13px;
        font-weight: 650;
        color: rgba(0, 0, 0, 0.68);
        background: rgba(0, 0, 0, 0.055);
        transition: background 0.16s, color 0.16s;
    }

    .secondary-action:hover:not(:disabled) {
        background: rgba(0, 0, 0, 0.085);
        color: rgba(0, 0, 0, 0.78);
    }

    .primary-action-muted {
        background: rgba(0, 0, 0, 0.22);
        color: rgba(255, 255, 255, 0.92);
    }

    .future-section {
        margin-top: 18px;
        padding-top: 16px;
        border-top: 1px solid rgba(0, 0, 0, 0.065);
    }

    .omni-link-row {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        margin-top: 14px;
    }

    .omni-inline-link {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        color: rgba(0, 0, 0, 0.52);
        font-size: 12px;
        font-weight: 650;
        text-decoration: none;
        white-space: nowrap;
        transition: color 0.16s;
    }

    .omni-inline-link:hover {
        color: rgba(0, 0, 0, 0.72);
    }

    .future-label {
        margin-bottom: 8px;
        font-size: 10px;
        font-weight: 750;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: rgba(0, 0, 0, 0.34);
    }

    .disabled-option {
        padding: 12px;
        border-radius: 12px;
        background: rgba(0, 0, 0, 0.035);
        opacity: 0.72;
    }

    .auth-actions {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
        margin-top: 18px;
    }

    .auth-actions button:last-child {
        color: rgba(0, 0, 0, 0.68);
        background: rgba(0, 0, 0, 0.065);
    }

    .auth-actions button:last-child:hover {
        background: rgba(0, 0, 0, 0.095);
    }

    .auth-actions button:disabled {
        color: rgba(0, 0, 0, 0.32);
        background: rgba(0, 0, 0, 0.04);
        cursor: not-allowed;
        opacity: 0.8;
    }

    @media (max-width: 520px) {
        .share-update-pill {
            opacity: 1;
            visibility: visible;
            transform: translateY(0) scale(1);
            pointer-events: auto;
        }

        .share-modal-inner {
            width: calc(100vw - 20px);
        }

        .status-card,
        .copy-row,
        .auth-actions,
        .share-actions {
            grid-template-columns: 1fr;
            flex-direction: column;
            align-items: stretch;
        }

        .omni-link-row {
            justify-content: flex-start;
        }

        .live-action,
        .copy-row button,
        .share-primary,
        .secondary-action {
            width: 100%;
        }

        .live-tools-disclosure summary {
            align-items: flex-start;
            flex-direction: column;
        }
    }
</style>
