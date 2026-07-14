/**
 * report.test.ts — Unit tests for the provenance report builder.
 *
 * Exercises buildProvenanceReport (the PURE entry point) against
 * synthetic EventRecords: char bucketing by origin, idle clamping +
 * session splitting around IDLE_THRESHOLD_MS, the paste log with the
 * PASTE_FLAG_CHARS flag, and legacy (no-provenance) handling that
 * surfaces in the integrity section.
 */

import type { ChangeOrigin, DocChangeEvent } from "$lib/db/events";
import type { EventRecord } from "$lib/db/types";
import { IDLE_THRESHOLD_MS, PASTE_FLAG_CHARS, buildProvenanceReport } from "$lib/provenance/report";
import { describe, expect, it } from "vitest";

// ── Helpers ───────────────────────────────────────────────────────────────────

const baseArgs = {
    draftId: "draft-1",
    documentTitle: "Test Doc",
    generatedAt: "2026-06-25T00:00:00.000Z",
    finalDocLength: 0,
};

/** Builds a doc_change EventRecord carrying provenance of the given origin. */
function makeEvent(
    id: number,
    createdAt: number,
    origin: ChangeOrigin,
    insert: string,
): EventRecord {
    const payload: DocChangeEvent = {
        type: "doc_change",
        changes: [{ from: 0, to: 0, insert }],
        selection: { ranges: [{ anchor: insert.length, head: insert.length }], main: 0 },
        provenance: {
            origin,
            userEvent: origin === "type" ? "input.type" : origin,
            insertedChars: insert.length,
            removedChars: 0,
        },
    };
    return { id, eventType: "doc_change", payload: JSON.stringify(payload), createdAt };
}

/** Builds a LEGACY doc_change EventRecord with no `provenance` field. */
function makeLegacyEvent(id: number, createdAt: number, insert: string): EventRecord {
    const payload: DocChangeEvent = {
        type: "doc_change",
        changes: [{ from: 0, to: 0, insert }],
        selection: { ranges: [{ anchor: insert.length, head: insert.length }], main: 0 },
    };
    return { id, eventType: "doc_change", payload: JSON.stringify(payload), createdAt };
}

function build(events: EventRecord[], overrides: Partial<typeof baseArgs> = {}) {
    return buildProvenanceReport({ ...baseArgs, ...overrides, events });
}

// ── Char buckets ──────────────────────────────────────────────────────────────

describe("buildProvenanceReport — char buckets", () => {
    it("splits human, AI, and mixed revision chars without conflating them", () => {
        const t0 = 1_000;
        const events = [
            makeEvent(1, t0, "type", "hello"), // 5 typed
            makeEvent(2, t0 + 100, "type", "world"), // 5 typed
            makeEvent(3, t0 + 200, "paste", "pasted-text"), // 11 pasted
            makeEvent(4, t0 + 300, "ai-revision", "from-ai"), // 7 ai-revision
            makeEvent(5, t0 + 400, "human-revision", "mine"),
            makeEvent(6, t0 + 500, "mixed-revision", "edited-ai"),
        ];

        const report = build(events);

        expect(report.totals.typedChars).toBe(10);
        expect(report.totals.pastedChars).toBe(11);
        expect(report.totals.aiRevisionChars).toBe(7);
        expect(report.totals.humanRevisionChars).toBe(4);
        expect(report.totals.mixedRevisionChars).toBe(9);
        expect(report.totals.unknownChars).toBe(0);
        expect(report.aiAssist.aiRevisionEvents).toBe(2);
    });

    it("does not count deletes toward authored char totals", () => {
        const report = build([
            makeEvent(1, 1_000, "type", "abc"),
            makeEvent(2, 1_100, "delete", ""),
        ]);

        expect(report.totals.typedChars).toBe(3);
        expect(report.totals.pastedChars).toBe(0);
    });
});

// ── Idle clamping ─────────────────────────────────────────────────────────────

describe("buildProvenanceReport — idle clamping", () => {
    it("adds a sub-threshold gap (5s) to activeWritingMs", () => {
        const t0 = 10_000;
        const report = build([
            makeEvent(1, t0, "type", "a"),
            makeEvent(2, t0 + 5_000, "type", "b"),
        ]);

        expect(report.activeWritingMs).toBe(5_000);
    });

    it("clamps a gap larger than the threshold (10min) to 0", () => {
        const t0 = 10_000;
        const report = build([
            makeEvent(1, t0, "type", "a"),
            makeEvent(2, t0 + 600_000, "type", "b"),
        ]);

        expect(report.activeWritingMs).toBe(0);
    });

    it("counts a gap of exactly IDLE_THRESHOLD_MS (boundary is inclusive)", () => {
        const t0 = 10_000;
        const report = build([
            makeEvent(1, t0, "type", "a"),
            makeEvent(2, t0 + IDLE_THRESHOLD_MS, "type", "b"),
        ]);

        expect(report.activeWritingMs).toBe(IDLE_THRESHOLD_MS);
    });

    it("clamps a gap one ms over the threshold to 0", () => {
        const t0 = 10_000;
        const report = build([
            makeEvent(1, t0, "type", "a"),
            makeEvent(2, t0 + IDLE_THRESHOLD_MS + 1, "type", "b"),
        ]);

        expect(report.activeWritingMs).toBe(0);
    });
});

// ── Session splitting ─────────────────────────────────────────────────────────

describe("buildProvenanceReport — session splitting", () => {
    it("keeps events within the threshold in a single session", () => {
        const t0 = 50_000;
        const report = build([
            makeEvent(1, t0, "type", "a"),
            makeEvent(2, t0 + 1_000, "type", "b"),
            makeEvent(3, t0 + 2_000, "type", "c"),
        ]);

        expect(report.sessions).toHaveLength(1);
        expect(report.sessions[0].typedChars).toBe(3);
        expect(report.sessions[0].startedAt).toBe(t0);
        expect(report.sessions[0].endedAt).toBe(t0 + 2_000);
        expect(report.sessions[0].durationMs).toBe(2_000);
    });

    it("splits into two sessions when a gap exceeds the threshold", () => {
        const t0 = 50_000;
        const report = build([
            makeEvent(1, t0, "type", "a"),
            makeEvent(2, t0 + IDLE_THRESHOLD_MS + 1, "type", "b"),
        ]);

        expect(report.sessions).toHaveLength(2);
        expect(report.sessions[0].startedAt).toBe(t0);
        expect(report.sessions[1].startedAt).toBe(t0 + IDLE_THRESHOLD_MS + 1);
    });

    it("stays in one session when the gap is exactly the threshold", () => {
        const t0 = 50_000;
        const report = build([
            makeEvent(1, t0, "type", "a"),
            makeEvent(2, t0 + IDLE_THRESHOLD_MS, "type", "b"),
        ]);

        expect(report.sessions).toHaveLength(1);
    });
});

// ── Paste log ─────────────────────────────────────────────────────────────────

describe("buildProvenanceReport — paste log", () => {
    it("flags a paste of size >= PASTE_FLAG_CHARS and captures its text", () => {
        const bigText = "x".repeat(PASTE_FLAG_CHARS);
        const report = build([makeEvent(1, 1_000, "paste", bigText)]);

        expect(report.pastes).toHaveLength(1);
        expect(report.pastes[0].flagged).toBe(true);
        expect(report.pastes[0].size).toBe(PASTE_FLAG_CHARS);
        expect(report.pastes[0].text).toBe(bigText);
        expect(report.pastes[0].eventId).toBe(1);
    });

    it("does not flag a small paste below the threshold", () => {
        const smallText = "x".repeat(PASTE_FLAG_CHARS - 1);
        const report = build([makeEvent(1, 1_000, "paste", smallText)]);

        expect(report.pastes).toHaveLength(1);
        expect(report.pastes[0].flagged).toBe(false);
        expect(report.pastes[0].size).toBe(PASTE_FLAG_CHARS - 1);
    });

    it("does not log non-paste events", () => {
        const report = build([makeEvent(1, 1_000, "type", "typed not pasted")]);

        expect(report.pastes).toHaveLength(0);
    });
});

// ── Legacy handling ───────────────────────────────────────────────────────────

describe("buildProvenanceReport — legacy handling", () => {
    it("counts a provenance-less event as unknownChars and marks integrity incomplete", () => {
        const report = build([makeLegacyEvent(1, 1_000, "legacy")]);

        expect(report.totals.unknownChars).toBe(6);
        expect(report.totals.typedChars).toBe(0);
        expect(report.integrity.coversFullHistory).toBe(false);
        expect(report.integrity.legacyEventRatio).toBeGreaterThan(0);
    });

    it("keeps integrity complete when every event carries provenance", () => {
        const report = build([
            makeEvent(1, 1_000, "type", "hello"),
            makeEvent(2, 1_100, "paste", "there"),
        ]);

        expect(report.integrity.coversFullHistory).toBe(true);
        expect(report.integrity.legacyEventRatio).toBe(0);
    });

    it("computes legacyEventRatio as unknown / total inserted chars", () => {
        const report = build([
            makeEvent(1, 1_000, "type", "aaaa"), // 4 typed
            makeLegacyEvent(2, 1_100, "bbbb"), // 4 unknown
        ]);

        expect(report.totals.unknownChars).toBe(4);
        expect(report.integrity.coversFullHistory).toBe(false);
        expect(report.integrity.legacyEventRatio).toBeCloseTo(0.5, 10);
    });
});
