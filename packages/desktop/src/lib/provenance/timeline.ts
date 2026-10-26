/**
 * timeline.ts — Selects a safe starting point for authorship playback.
 *
 * Most drafts have a self-contained event stream that can be replayed from an
 * empty editor. Imported, duplicated, and seeded drafts may instead begin with
 * a snapshot and only record later edits. Replaying those events from empty
 * produces an empty preview because their positions refer to the seeded text.
 */
import type { ChangeSpec, EventPayload } from "$lib/db/events";
import type { EventRecord, SnapshotMeta } from "$lib/db/types";

function changesOf(payload: EventPayload): ChangeSpec[] {
    if (payload.type === "doc_change") return payload.changes;
    if (payload.type === "compound") return payload.docChanges;
    return [];
}

/**
 * Returns true when the event stream contains a document change that cannot be
 * applied to the text produced by preceding events.
 */
export function eventStreamNeedsBaseline(events: EventRecord[]): boolean {
    let docLength = 0;

    for (const event of events) {
        let payload: EventPayload;
        try {
            payload = JSON.parse(event.payload) as EventPayload;
        } catch {
            continue;
        }

        const fallbackDoc = payload.stateFallback?.doc;
        if (payload.type === "state_transaction" && fallbackDoc !== undefined) {
            docLength = fallbackDoc.length;
            continue;
        }

        const changes = changesOf(payload);
        let delta = 0;
        for (const change of changes) {
            if (
                !Number.isInteger(change.from) ||
                !Number.isInteger(change.to) ||
                change.from < 0 ||
                change.to < change.from ||
                change.to > docLength
            ) {
                return true;
            }
            delta += change.insert.length - (change.to - change.from);
        }
        docLength += delta;
    }

    return false;
}

/**
 * Picks the oldest snapshot when one is required, preserving the largest
 * possible replayable tail of the event history.
 */
export function selectPlaybackBaseline(
    events: EventRecord[],
    snapshots: SnapshotMeta[],
): SnapshotMeta | undefined {
    if (!eventStreamNeedsBaseline(events)) return undefined;
    return snapshots.reduce<SnapshotMeta | undefined>((oldest, snapshot) => {
        if (!oldest || snapshot.upToEventId < oldest.upToEventId) return snapshot;
        return oldest;
    }, undefined);
}
