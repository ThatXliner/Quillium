/**
 * liveSession.svelte.ts — Live Room session lifecycle controller.
 *
 * Owns the go-live / join / leave flow that used to live inline in
 * GoLiveButton.svelte, per the original design decisions:
 *   D-56: "Go Live" toggle in top-right area (near AuthButton).
 *   D-57: Live Room mode only — session ends when owner leaves.
 *   D-58: Snapshot before pulling remote state.
 *   D-59: Manual toggle for owner's own documents.
 *   D-100: Joiners are ephemeral viewers; prior view state is captured
 *          before joining and restored on leave/failure.
 *
 * The component keeps thin $effects that forward store changes
 * (ownerLeftSignal, collabState) into handleOwnerLeft/trackCollabState.
 */

import { logAppEvent } from "$lib/appLog";
import { getSession, getUser } from "$lib/auth/auth.svelte";
import {
    disableCollab,
    enableCollab,
    registerDocumentForCollab,
    restoreJoinerPriorView,
} from "$lib/collab";
import { isCollabJoiner, joinerPriorView } from "$lib/collab/store";
import { savedFields } from "$lib/editor/extensions";
import { flushPersistQueue, persistNamedVersion } from "$lib/editor/listeners";
import posthog, { captureException } from "$lib/posthog";
import { currentDocumentId, currentDraftId, editorView, modalStack } from "$lib/stores";
import { toast } from "svelte-sonner";
import { get } from "svelte/store";
import { parseInvitationToken } from "./invitations/deepLink";
import { InvitationError, invitationRepository } from "./invitations/repository";

export class LiveSessionController {
    isLive = $state(false);
    connecting = $state(false);
    lastJoinError = $state<{ code: string; message: string } | null>(null);

    // Plain fields — only read/written inside trackCollabState, never rendered.
    #prevCollabState = "disconnected";
    // Last nonzero attempt seen while reconnecting: by the time collabState flips
    // to "connected" the store has already been reset to 0 in the same batch.
    #lastReconnectAttempt = 0;

    /** Owner ended the session (ownerLeftSignal fired while we were live). */
    handleOwnerLeft() {
        if (!this.isLive) return;
        const view = get(editorView);
        if (view) {
            disableCollab(view);
        } else {
            restoreJoinerPriorView();
        }
        this.isLive = false;
        toast.error("The owner ended the session");
        posthog.capture("collab_session_ended", { role: "joiner", reason: "owner_left" });
    }

    /** React to collabState transitions (reconnect toasts + failure teardown). */
    trackCollabState(state: string, attempt: number) {
        if (state === "reconnecting" && attempt > 0) {
            this.#lastReconnectAttempt = attempt;
        }

        // Reconnected successfully
        if (this.#prevCollabState === "reconnecting" && state === "connected") {
            toast.success("Reconnected");
            posthog.capture("collab_reconnected", { attempts: this.#lastReconnectAttempt });
            this.#lastReconnectAttempt = 0;
        }

        // Reconnection failed (error state after reconnecting)
        if (this.#prevCollabState === "reconnecting" && state === "error") {
            toast.error("Connection lost. Please go live again to reconnect.");
            posthog.capture("collab_reconnect_failed", {
                attempts: attempt > 0 ? attempt : this.#lastReconnectAttempt,
            });
            this.#lastReconnectAttempt = 0;
            const view = get(editorView);
            if (view) {
                disableCollab(view);
            } else {
                restoreJoinerPriorView();
            }
            this.isLive = false;
        }

        // Started reconnecting (first attempt)
        if (this.#prevCollabState !== "reconnecting" && state === "reconnecting" && attempt === 1) {
            toast("Connection lost, reconnecting...");
            posthog.capture("collab_reconnect_started");
        }

        this.#prevCollabState = state;
    }

    async join(rawInvitation: string): Promise<boolean> {
        const token = parseInvitationToken(rawInvitation);
        this.lastJoinError = null;
        if (!token) {
            this.lastJoinError = {
                code: "invalid_invitation",
                message:
                    "Check that you copied the whole invitation link, or ask the owner for a new one.",
            };
            return false;
        }
        this.connecting = true;
        let enteredRoom = false;
        try {
            const invitation = await invitationRepository.resolve(token);
            const view = get(editorView);
            const user = getUser();
            if (!view || !user || !getSession())
                throw new InvitationError(
                    "unavailable",
                    "Open a draft and sign in before joining.",
                );
            try {
                await flushPersistQueue();
            } catch {
                throw new InvitationError(
                    "save_failed",
                    "Quillium couldn't save your current draft. Try again after it saves.",
                );
            }
            if (get(editorView) !== view)
                throw new InvitationError("unavailable", "Your draft changed. Try joining again.");
            if (this.isLive) {
                disableCollab(view);
                this.isLive = false;
            }
            modalStack.clear();
            const priorDraftId = get(currentDraftId);
            joinerPriorView.set({
                draftId: priorDraftId,
                viewType: "editor",
                editorStateJson: view.state.toJSON(savedFields),
            });
            currentDraftId.set(null);
            isCollabJoiner.set(true);
            enteredRoom = true;
            await enableCollab(view, invitation.documentId, user.id, false, {
                token,
                role: invitation.role,
            });
            this.isLive = true;
            toast.success("Joined Live Room");
            return true;
        } catch (error) {
            if (enteredRoom) {
                const view = get(editorView);
                if (view) disableCollab(view);
                else restoreJoinerPriorView();
            }
            this.lastJoinError =
                error instanceof InvitationError
                    ? { code: error.code, message: error.message }
                    : {
                          code: "unavailable",
                          message:
                              "Couldn't connect to the Live Room. Ask the owner to keep it open, then try again.",
                      };
            return false;
        } finally {
            this.connecting = false;
        }
    }

    handleAccessChanged(): void {
        if (!this.isLive) return;
        const view = get(editorView);
        if (view) disableCollab(view);
        else restoreJoinerPriorView();
        this.isLive = false;
        this.lastJoinError = {
            code: "access_changed",
            message:
                "The owner changed your access. Quillium restored your previous draft. Open your invitation again to rejoin.",
        };
        toast.error(this.lastJoinError.message);
    }

    /** Toggle: end the current session, or go live on the current draft. */
    async toggle() {
        if (this.isLive) {
            // Go offline
            const view = get(editorView);
            const wasJoiner = get(isCollabJoiner);
            if (view) {
                disableCollab(view);
            }
            this.isLive = false;
            // D-103: restoreJoinerPriorView is called by disableCollab automatically
            // for joiners. Owners stay on current document (no navigation).
            toast.success(wasJoiner ? "Left live room" : "Session ended");
            posthog.capture("collab_session_ended", {
                role: wasJoiner ? "joiner" : "owner",
                reason: "manual",
            });
        } else {
            // Go live -- snapshot first (D-58)
            this.connecting = true;
            try {
                const view = get(editorView);
                const draftId = get(currentDraftId);
                const documentId = get(currentDocumentId);
                const user = getUser();
                const session = getSession();

                if (!view || !documentId || !draftId || !user || !session) {
                    throw new Error("Missing required state");
                }

                // Per D-58: Snapshot before pulling remote state
                const stateJson = JSON.stringify(view.state.toJSON(savedFields));
                const snapshotId = await persistNamedVersion(
                    draftId,
                    stateJson,
                    "Before going live (auto)",
                    () =>
                        get(editorView) === view &&
                        get(currentDraftId) === draftId &&
                        get(currentDocumentId) === documentId,
                );
                if (snapshotId === null) return;

                // Register document with relay's sync_documents table (auto-creates if missing)
                await registerDocumentForCollab(documentId, user.id, "Untitled");
                await flushPersistQueue();
                if (
                    get(editorView) !== view ||
                    get(currentDraftId) !== draftId ||
                    get(currentDocumentId) !== documentId
                )
                    return;

                // Per D-50: clientID is user.id for per-user undo
                // Version comes from relay's initial state
                await enableCollab(view, documentId, user.id);

                this.isLive = true;
                toast.success("Live Room is open");
                posthog.capture("collab_went_live");
            } catch (err) {
                console.error("[collab] Failed to go live:", err);
                void logAppEvent("error", "collab", "failed to go live", {
                    error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
                });
                captureException(err);
                posthog.capture("collab_go_live_failed");
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
                this.connecting = false;
            }
        }
    }
}
