/**
 * readonlySharePublisher.svelte.ts — Read-only web-preview share state.
 *
 * Owns the publish/refresh/disable lifecycle for the public link that used
 * to live inline in GoLiveButton.svelte. The share row is keyed by the
 * *document* id; content comes from whatever payload the caller builds (the
 * live editor view, i.e. the last active tab+draft).
 *
 * Fingerprint comparison (is the published snapshot stale?) stays with the
 * caller, which has reactive access to the stores; this class tracks the
 * fingerprint of the last failed auto-publish so auto-update pauses instead
 * of retrying the same failing draft in a loop.
 */

import {
    type ReadonlyShare,
    disableReadonlyShare,
    getReadonlyShare,
    publishReadonlyShare,
    readonlyShareState,
} from "$lib/collab/share";
import type { SerializedAnnotation } from "$lib/collab/sharePayload";
import posthog from "$lib/posthog";
import { toast } from "svelte-sonner";

export type PublishPayload = {
    documentId: string;
    ownerId: string;
    title: string;
    content: string;
    annotations: SerializedAnnotation[];
};

export class ReadonlySharePublisher {
    share = $state<ReadonlyShare | null>(null);
    loading = $state(false);
    busy = $state(false);
    /** True while an auto-publish is scheduled (debounce pending). */
    queued = $state(false);
    /** Fingerprint of the last payload whose automatic publish failed. */
    failedFingerprint = $state("");

    /** Drop all share state (signed out / no document). */
    clear() {
        this.share = null;
        readonlyShareState.set(null);
    }

    /** Load the share row for the given document. */
    async refresh(shareId: string) {
        this.loading = true;
        try {
            this.share = await getReadonlyShare(shareId);
            readonlyShareState.set(this.share);
        } catch (err) {
            console.error("[share] Failed to load readonly share:", err);
            toast.error("Couldn't load public link settings");
        } finally {
            this.loading = false;
        }
    }

    /**
     * Publish (or update) the public snapshot. `payloadFingerprint` is the
     * caller-computed fingerprint of the payload, recorded on automatic
     * failure so the auto-update scheduler pauses for this draft.
     */
    async publish(
        payload: PublishPayload,
        payloadFingerprint: string,
        options: { automatic?: boolean } = {},
    ) {
        this.busy = true;
        try {
            const hadShare = this.share?.enabled ?? false;
            const publishedShare = await publishReadonlyShare(payload);
            this.share = {
                ...publishedShare,
                publishedTitle: payload.title.trim() || "Untitled",
                publishedContent: payload.content,
                publishedAnnotations: payload.annotations,
            };
            readonlyShareState.set(this.share);
            this.failedFingerprint = "";
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
            if (options.automatic) {
                this.failedFingerprint = payloadFingerprint;
            }
            toast.error(
                options.automatic
                    ? "Couldn't auto-update your public page"
                    : "Couldn't publish your public page",
            );
        } finally {
            this.busy = false;
        }
    }

    /** Turn the public link off. */
    async disable(shareId: string) {
        this.busy = true;
        try {
            this.share = await disableReadonlyShare(shareId);
            readonlyShareState.set(this.share);
            posthog.capture("readonly_share_disabled");
            toast.success("Public link turned off");
        } catch (err) {
            console.error("[share] Failed to disable readonly share:", err);
            toast.error("Couldn't turn off the public link");
        } finally {
            this.busy = false;
        }
    }
}
