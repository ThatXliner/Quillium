import type { ChangeOrigin, EventPayload, NormalTransactionReplayEntry } from "$lib/db/events";
import type { EventRecord } from "$lib/db/types";
import { buildTextOrigin } from "$lib/provenance/textOrigin";
import { ChangeSet } from "@codemirror/state";
import { describe, expect, it } from "vitest";

function event(payload: EventPayload): EventRecord {
    return { id: 1, eventType: payload.type, createdAt: 1, payload: JSON.stringify(payload) };
}
function edit(from: number, to: number, insert: string, origin: ChangeOrigin): EventRecord {
    return event({
        type: "doc_change",
        changes: [{ from, to, insert }],
        selection: { ranges: [{ anchor: 0, head: 0 }], main: 0 },
        provenance: { origin },
    });
}
function trace(
    entry:
        | NormalTransactionReplayEntry
        | { kind: "undo" | "redo"; fallback: NormalTransactionReplayEntry },
): EventRecord {
    return event({
        type: "state_transaction",
        transactionReplay: { version: 1, transactions: [entry] },
    });
}
function transaction(
    length: number,
    from: number,
    to: number,
    insert: string,
    ai = false,
): NormalTransactionReplayEntry {
    return {
        kind: "transaction",
        changeSet: ChangeSet.of({ from, to, insert }, length).toJSON(),
        effects: [],
        annotations: {
            addToHistory: true,
            startsNewHistoryGroup: true,
            userEvent: ai ? undefined : "input.type",
            revisionInternalEdit: ai,
            revisionProvenance: ai ? "ai" : undefined,
        },
    };
}

describe("surviving text origin", () => {
    it("maps surviving AI wording and writer replacements independently", () => {
        const result = buildTextOrigin([
            edit(0, 0, "hello world", "ai-revision"),
            edit(6, 11, "you", "type"),
            edit(0, 0, "Dear ", "type"),
        ]);
        expect(result).toEqual({
            text: "Dear hello you",
            spans: [
                { from: 0, to: 5, origin: "human" },
                { from: 5, to: 11, origin: "ai" },
                { from: 11, to: 14, origin: "edited-ai" },
            ],
        });
    });
    it("does not attribute pending or rejected annotations to prose", () => {
        const annotation = event({ type: "annotation_remove", annotationId: 0 });
        expect(buildTextOrigin([edit(0, 0, "mine", "type"), annotation]).spans).toEqual([
            { from: 0, to: 4, origin: "human" },
        ]);
    });
    it("keeps pastes and baseline text unknown and pure deletion preserves surviving origin", () => {
        expect(buildTextOrigin([edit(4, 4, " pasted", "paste")], "seed").spans).toEqual([
            { from: 0, to: 11, origin: "unknown" },
        ]);
        expect(
            buildTextOrigin([edit(0, 0, "abc", "ai-revision"), edit(1, 2, "", "delete")]),
        ).toEqual({ text: "ac", spans: [{ from: 0, to: 2, origin: "ai" }] });
    });
    it("restores exact wording lineage through recorded undo and redo", () => {
        const accept = trace(transaction(4, 0, 4, "AI", true));
        const undo = trace({ kind: "undo", fallback: transaction(2, 0, 2, "mine") });
        const redo = trace({ kind: "redo", fallback: transaction(4, 0, 4, "AI") });
        expect(buildTextOrigin([accept, undo], "mine").spans).toEqual([
            { from: 0, to: 4, origin: "unknown" },
        ]);
        expect(buildTextOrigin([accept, undo, redo], "mine").spans).toEqual([
            { from: 0, to: 2, origin: "ai" },
        ]);
    });
    it("does not guess lineage for an undo outside captured history", () => {
        expect(
            buildTextOrigin([trace({ kind: "undo", fallback: transaction(2, 0, 2, "old") })], "AI")
                .spans,
        ).toEqual([{ from: 0, to: 3, origin: "unknown" }]);
    });
    it("uses individual trace origins rather than the aggregate event origin", () => {
        const first = transaction(0, 0, 0, "AI", true);
        const second = transaction(2, 2, 2, " mine");
        expect(
            buildTextOrigin([
                event({
                    type: "state_transaction",
                    transactionReplay: { version: 1, transactions: [first, second] },
                }),
            ]).spans,
        ).toEqual([
            { from: 0, to: 2, origin: "ai" },
            { from: 2, to: 7, origin: "human" },
        ]);
    });
    it("rejects malformed or mismatched history instead of assigning misleading labels", () => {
        expect(() => buildTextOrigin([edit(20, 21, "x", "type")])).toThrow();
        expect(() => buildTextOrigin([{ ...edit(0, 0, "x", "type"), payload: "bad" }])).toThrow();
    });
});
