import { Text, ChangeSet } from "@codemirror/state";
import type { SerializedUpdate } from "./protocol.js";

type StoredUpdate = {
    changes: ChangeSet;
    clientID: string;
};

type PendingPull = {
    sinceVersion: number;
    resolve: () => void;
};

/**
 * In-memory representation of a collaborative document.
 * Holds the authoritative Text, version counter, and update history.
 */
export class Document {
    text: Text;
    version: number;
    private updates: StoredUpdate[] = [];
    private pending: PendingPull[] = [];

    constructor(content: string = "", version: number = 0) {
        this.text = Text.of(content.split("\n"));
        this.version = version;
    }

    /**
     * Apply a client update. Returns true if accepted, false if the
     * base version doesn't match (client needs to pull first).
     */
    applyUpdate(changes: ChangeSet, clientID: string, baseVersion: number): boolean {
        if (baseVersion !== this.version) return false;
        this.text = changes.apply(this.text);
        this.updates.push({ changes, clientID });
        this.version++;
        // Resolve any pending pulls that are now satisfiable
        const stillPending: PendingPull[] = [];
        for (const p of this.pending) {
            if (p.sinceVersion < this.version) {
                p.resolve();
            } else {
                stillPending.push(p);
            }
        }
        this.pending = stillPending;
        return true;
    }

    /** Get all updates since a given version as serializable objects. */
    getUpdatesSince(sinceVersion: number): SerializedUpdate[] {
        return this.updates.slice(sinceVersion - (this.version - this.updates.length)).map((u) => ({
            changes: u.changes.toJSON(),
            clientID: u.clientID,
        }));
    }

    /**
     * Register a callback that fires when new updates arrive after sinceVersion.
     * Used for long-polling style pullUpdates — if no updates are available yet,
     * we wait until one arrives.
     */
    addPendingPull(sinceVersion: number, resolve: () => void): void {
        if (sinceVersion < this.version) {
            resolve();
        } else {
            this.pending.push({ sinceVersion, resolve });
        }
    }
}
