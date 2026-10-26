import type { DocChangeEvent } from "$lib/db/events";
import type { EventRecord, SnapshotMeta } from "$lib/db/types";
import { eventStreamNeedsBaseline, selectPlaybackBaseline } from "$lib/provenance/timeline";
import { describe, expect, it } from "vitest";

function event(id: number, from: number, to: number, insert: string): EventRecord {
    const payload: DocChangeEvent = {
        type: "doc_change",
        changes: [{ from, to, insert }],
        selection: {
            ranges: [{ anchor: from + insert.length, head: from + insert.length }],
            main: 0,
        },
    };
    return { id, eventType: payload.type, payload: JSON.stringify(payload), createdAt: id };
}

function snapshot(id: number, upToEventId: number): SnapshotMeta {
    return {
        id,
        draftId: "draft-1",
        upToEventId,
        createdAt: id,
        label: null,
    };
}

describe("authorship playback baseline selection", () => {
    it("replays a self-contained stream from empty", () => {
        const events = [event(1, 0, 0, "hello"), event(2, 5, 5, "!")];

        expect(eventStreamNeedsBaseline(events)).toBe(false);
        expect(selectPlaybackBaseline(events, [snapshot(10, 1)])).toBeUndefined();
    });

    it("uses the oldest snapshot when edits refer to seeded text", () => {
        const events = [event(20, 6_313, 6_313, "text")];
        const oldest = snapshot(10, 19);

        expect(eventStreamNeedsBaseline(events)).toBe(true);
        expect(selectPlaybackBaseline(events, [snapshot(12, 30), oldest, snapshot(11, 24)])).toBe(
            oldest,
        );
    });

    it("does not invent a baseline when no snapshot exists", () => {
        expect(selectPlaybackBaseline([event(1, 10, 10, "x")], [])).toBeUndefined();
    });
});
