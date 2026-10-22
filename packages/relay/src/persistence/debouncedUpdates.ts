import { createLogger } from "../logger.js";
/**
 * debouncedUpdates.ts -- Coalesce high-frequency Yjs update writes.
 */
import { persistYjsUpdates } from "./yjsUpdates.js";

const DEFAULT_DEBOUNCE_MS = 500;
const debounceMs = Number.parseInt(
    process.env.PERSIST_DEBOUNCE_MS ?? String(DEFAULT_DEBOUNCE_MS),
    10,
);
const logger = createLogger("persistence");

interface DocumentUpdateQueue {
    updates: Uint8Array[];
    timer: NodeJS.Timeout | null;
    inFlight: Promise<void> | null;
}

const queues = new Map<string, DocumentUpdateQueue>();

export function queueYjsUpdate(documentId: string, update: Uint8Array): void {
    let batch = queues.get(documentId);

    if (!batch) {
        batch = { updates: [], timer: null, inFlight: null };
        queues.set(documentId, batch);
    }

    batch.updates.push(update);

    if (!batch.timer && !batch.inFlight) {
        batch.timer = setTimeout(
            () => {
                flushDocumentUpdates(documentId).catch((e) => {
                    logger.warn("Debounced flush failed:", e);
                });
            },
            Number.isFinite(debounceMs) && debounceMs >= 0 ? debounceMs : DEFAULT_DEBOUNCE_MS,
        );
    }
}

export async function flushDocumentUpdates(documentId: string): Promise<void> {
    const batch = queues.get(documentId);

    if (!batch) {
        return;
    }

    if (batch.timer) {
        clearTimeout(batch.timer);
        batch.timer = null;
    }

    if (batch.inFlight) {
        return batch.inFlight;
    }

    const drain = async (): Promise<void> => {
        try {
            while (batch.updates.length > 0) {
                const updates = batch.updates;
                batch.updates = [];
                try {
                    const result = await persistYjsUpdates(documentId, updates);
                    if (!result.success) {
                        throw new Error(
                            result.error ?? `Failed to persist updates for ${documentId}`,
                        );
                    }
                } catch (error) {
                    batch.updates = updates.concat(batch.updates);
                    throw error;
                }
            }
        } finally {
            batch.inFlight = null;
            if (batch.updates.length === 0) {
                queues.delete(documentId);
            }
        }
    };

    batch.inFlight = drain();
    return batch.inFlight;
}

export async function flushAllDocumentUpdates(): Promise<void> {
    while (queues.size > 0) {
        const results = await Promise.allSettled(
            Array.from(queues.keys()).map((documentId) => flushDocumentUpdates(documentId)),
        );
        const errors = results.flatMap((result) =>
            result.status === "rejected" ? [result.reason] : [],
        );
        if (errors.length > 0) throw new AggregateError(errors, "Failed to flush Yjs updates");
    }
}
