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
import { createNamedSnapshot } from "$lib/db";
import { savedFields } from "$lib/editor/extensions";
import posthog, { captureException } from "$lib/posthog";
import { currentDraftId, editorView, lastPersistedEventId } from "$lib/stores";
import { toast } from "svelte-sonner";
import { get } from "svelte/store";

export class LiveSessionController {
    isLive = $state(false);
    connecting = $state(false);

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

    /** Join another writer's room by draft UUID (as an ephemeral joiner). */
    async join(rawId: string) {
        const id = rawId.trim();
        if (!id) return false;
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
            toast.error("Invalid document ID format");
            return false;
        }

        this.connecting = true;
        try {
            const view = get(editorView);
            const user = getUser();
            const session = getSession();
            if (!view || !user || !session) {
                throw new Error("Missing required state");
            }

            // Disconnect current session if live
            if (this.isLive) {
                disableCollab(view);
                this.isLive = false;
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

            this.isLive = true;
            toast.success("Joined shared document");
            posthog.capture("collab_room_joined");
            return true;
        } catch (err) {
            console.error("[collab] Failed to join:", err);
            void logAppEvent("error", "collab", "failed to join room", {
                error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
            });
            captureException(err);
            posthog.capture("collab_join_failed");
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
            return false;
        } finally {
            this.connecting = false;
        }
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

                this.isLive = true;
                toast.success("You're live!");
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
