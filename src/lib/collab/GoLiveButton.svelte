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
import { editorView, currentDraftId, lastPersistedEventId } from "$lib/stores";
import { createNamedSnapshot } from "$lib/db";
import { isCollabJoiner, joinerPriorView } from "$lib/collab/store";
import { savedFields } from "$lib/editor/extensions";
import {
    enableCollab,
    disableCollab,
    restoreJoinerPriorView,
    relayConfigured,
    registerDocumentForCollab,
    ownerLeftSignal,
    collabState,
    reconnectAttempt,
} from "$lib/collab";
import { get } from "svelte/store";
import { toast } from "svelte-sonner";
import { Check, Cloud, Copy, Link, Loader2, LogIn, Radio, Share2, X } from "lucide-svelte";

const { onauthclick }: { onauthclick?: () => void } = $props();

type ShareTab = "preview" | "collaborate";

let isLive = $state(false);
let connecting = $state(false);
let modalOpen = $state(false);
let dialogEl = $state<HTMLDialogElement | undefined>(undefined);
let joinIdInput = $state("");
let prevCollabState = $state<string>("disconnected");
let activeTab = $state<ShareTab>("collaborate");
let tabTrackEl = $state<HTMLElement | undefined>(undefined);
let tabPillStyle = $state("");
let acceptedPreviewTerms = $state(false);

const authenticated = $derived(isAuthenticated());
const canShowShare = $derived(relayConfigured);
const currentId = $derived($currentDraftId ?? "");
const canStartLive = $derived(authenticated && relayConfigured && !!currentId && !connecting);
const liveStatusLabel = $derived(isLive ? "Live Room is open" : "Live Room is off");

$effect(() => {
    if (modalOpen && dialogEl && !dialogEl.open) {
        dialogEl.showModal();
    }
});

$effect(() => {
    if (!tabTrackEl) return;
    const buttons = tabTrackEl.querySelectorAll<HTMLButtonElement>(".share-tab-btn");
    const idx = activeTab === "preview" ? 0 : 1;
    const btn = buttons[idx];
    if (!btn) return;
    tabPillStyle = `--share-pill-width: ${btn.offsetWidth}px; --share-pill-x: ${btn.offsetLeft - 3}px;`;
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
    <div class="relative flex items-center gap-1">
        <button
            onclick={() => (modalOpen = true)}
            class="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-full shadow-md transition-colors
                {isLive
                    ? 'bg-emerald-500 text-white hover:bg-emerald-600'
                    : 'text-black/55 bg-white/55 backdrop-blur-md hover:text-black/75 hover:bg-white/70'}"
            aria-haspopup="dialog"
        >
            <Share2 size={14} />
            Share
        </button>
    </div>

    {#if modalOpen}
        <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
        <dialog bind:this={dialogEl} class="share-modal" onclick={handleBackdropClick}>
            <div class="share-modal-inner">
                <header class="share-modal-header">
                    <div>
                        <p class="share-kicker">Quillium Omni beta</p>
                        <h2>Share your document</h2>
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
                    Collaboration and sync are currently available through Quillium Omni beta access.
                    Public web previews and server-stored documents are on the waitlist.
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
                        aria-selected={activeTab === "preview"}
                        onclick={() => (activeTab = "preview")}
                        class="share-tab-btn"
                        class:active={activeTab === "preview"}
                    >
                        Share preview to web
                    </button>
                    <button
                        role="tab"
                        aria-selected={activeTab === "collaborate"}
                        onclick={() => (activeTab = "collaborate")}
                        class="share-tab-btn"
                        class:active={activeTab === "collaborate"}
                    >
                        Collaborate
                    </button>
                </div>

                <section class="share-panel">
                    {#if activeTab === "preview"}
                        <div class="panel-copy">
                            <div class="icon-badge muted">
                                <Link size={18} />
                            </div>
                            <div>
                                <h3>Publish a read-only preview</h3>
                                <p>
                                    Create a web preview link anyone with the URL can open. This is disabled
                                    while the sharing terms and public preview service are finalized.
                                </p>
                            </div>
                        </div>

                        <label class="terms-row">
                            <input type="checkbox" bind:checked={acceptedPreviewTerms} disabled />
                            <span>I accept the beta sharing terms and understand this would make a preview public.</span>
                        </label>

                        <button class="primary-action" disabled title="Public previews are waitlist-only for now">
                            <Check size={15} />
                            Accept terms and share
                        </button>
                    {:else}
                        {#if authenticated}
                            <div class="status-card">
                                <div class="status-copy">
                                    <span class="session-state" class:online={isLive}>
                                        <span class="status-dot"></span>
                                        {isLive ? "Active" : "Inactive"}
                                    </span>
                                    <div>
                                        <h3>{liveStatusLabel}</h3>
                                        <p>
                                            Live Room shares this editor session with other Quillium users.
                                            The session ends when the owner leaves.
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onclick={handleToggle}
                                    disabled={!canStartLive && !isLive}
                                    class="live-action"
                                    class:danger={isLive}
                                >
                                    {#if connecting}
                                        <span class="spin" aria-hidden="true">
                                            <Loader2 size={15} />
                                        </span>
                                        Connecting
                                    {:else if isLive}
                                        End session
                                    {:else}
                                        <Radio size={15} />
                                        Start live room
                                    {/if}
                                </button>
                            </div>

                            <div class="doc-id-block">
                                <div class="field-label">This document's room ID</div>
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
                                class="join-block"
                            >
                                <label for="join-id">Join doc</label>
                                <div class="copy-row">
                                    <input
                                        id="join-id"
                                        bind:value={joinIdInput}
                                        placeholder="Paste UUID..."
                                        autocomplete="off"
                                    />
                                    <button type="submit" disabled={connecting || !joinIdInput.trim()}>
                                        Join doc
                                    </button>
                                </div>
                            </form>

                            <div class="disabled-option" aria-disabled="true">
                                <div class="icon-badge muted">
                                    <Cloud size={17} />
                                </div>
                                <div>
                                    <h3>Store on server</h3>
                                    <p>Google Docs-style synced documents are waitlist-only for now.</p>
                                </div>
                            </div>
                        {:else}
                            <div class="panel-copy">
                                <div class="icon-badge">
                                    <LogIn size={18} />
                                </div>
                                <div>
                                    <h3>Sign in to collaborate</h3>
                                    <p>
                                        Live Rooms need an account so collaborators can see who is present
                                        and so the relay can authorize the session.
                                    </p>
                                </div>
                            </div>

                            <div class="auth-actions">
                                <button onclick={openAuth}>Sign up</button>
                                <button onclick={openAuth}>Sign in</button>
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

    .share-kicker {
        margin: 0 0 4px;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: rgba(16, 185, 129, 0.85);
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

    .share-tab-btn:hover {
        color: rgba(0, 0, 0, 0.6);
    }

    .share-panel {
        margin: 14px 18px 18px;
        padding: 18px;
        border: 1px solid rgba(0, 0, 0, 0.07);
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.72);
    }

    .panel-copy,
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

    .panel-copy p,
    .status-copy p,
    .disabled-option p {
        margin: 0;
        font-size: 12px;
        line-height: 1.45;
        color: rgba(0, 0, 0, 0.48);
    }

    .terms-row {
        display: flex;
        align-items: flex-start;
        gap: 9px;
        margin-top: 18px;
        padding: 12px;
        border-radius: 10px;
        background: rgba(0, 0, 0, 0.035);
        font-size: 12px;
        line-height: 1.35;
        color: rgba(0, 0, 0, 0.48);
    }

    .terms-row input {
        margin-top: 2px;
    }

    .primary-action,
    .live-action,
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

    .primary-action:disabled,
    .live-action:disabled,
    .copy-row button:disabled {
        opacity: 0.45;
        cursor: not-allowed;
    }

    .status-card {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 18px;
        padding-bottom: 16px;
        border-bottom: 1px solid rgba(0, 0, 0, 0.065);
    }

    .status-copy {
        align-items: center;
    }

    .session-state {
        display: inline-flex;
        flex: 0 0 auto;
        align-items: center;
        gap: 6px;
        min-width: 76px;
        height: 28px;
        padding: 0 10px;
        border-radius: 999px;
        background: rgba(0, 0, 0, 0.045);
        font-size: 11px;
        font-weight: 650;
        color: rgba(0, 0, 0, 0.42);
    }

    .session-state.online {
        color: rgba(4, 120, 87, 0.9);
        background: rgba(16, 185, 129, 0.12);
    }

    .status-dot {
        width: 7px;
        height: 7px;
        flex: 0 0 auto;
        border-radius: 999px;
        background: rgba(0, 0, 0, 0.22);
    }

    .session-state.online .status-dot {
        background: rgb(16, 185, 129);
    }

    .auth-actions button:hover {
        background: rgb(29, 78, 216);
    }

    .live-action {
        flex: 0 0 auto;
        min-width: 142px;
        color: rgba(0, 0, 0, 0.7);
        background: rgba(16, 185, 129, 0.12);
        border: 1px solid rgba(16, 185, 129, 0.2);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.7);
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

    .live-action.danger:hover {
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
        margin-top: 16px;
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
        transition: background 0.16s, color 0.16s;
    }

    .copy-row button:hover:not(:disabled) {
        background: rgba(0, 0, 0, 0.085);
        color: rgba(0, 0, 0, 0.74);
    }

    .disabled-option {
        margin-top: 16px;
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

    @media (max-width: 520px) {
        .share-modal-inner {
            width: calc(100vw - 20px);
        }

        .status-card,
        .copy-row,
        .auth-actions {
            grid-template-columns: 1fr;
            flex-direction: column;
            align-items: stretch;
        }

        .live-action,
        .copy-row button {
            width: 100%;
        }
    }
</style>
