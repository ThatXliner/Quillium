/**
 * scenarios.test.ts — Regression tests for replayable debug scenarios.
 *
 * Provenance scenarios must build their complete document through recorded
 * transactions because Authorship Playback reconstructs from an empty state.
 */

import type { EventPayload } from "$lib/db/events";
import type { EventRecord } from "$lib/db/types";
import { scenarios } from "$lib/debug/scenarios";
import { getExtensions } from "$lib/editor/extensions";
import { buildEventPayload } from "$lib/editor/listeners";
import { replayEvents } from "$lib/editor/replay";
import { buildProvenanceReport } from "$lib/provenance/report";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";

let sourceView: EditorView | undefined;

afterEach(() => {
    sourceView?.destroy();
    sourceView = undefined;
    vi.restoreAllMocks();
});

describe("provenance debug scenario", () => {
    it("replays from empty with every provenance bucket represented", () => {
        const scenario = scenarios.find((candidate) => candidate.id === "provenance-matrix");
        expect(scenario).toBeDefined();
        if (!scenario) return;

        const payloads: EventPayload[] = [];
        const sourceState = EditorState.create({
            doc: scenario.doc,
            extensions: getExtensions({
                persist: false,
                updateListener(update) {
                    const payload = buildEventPayload(update);
                    if (payload) payloads.push(payload);
                },
            }),
        });
        sourceView = new EditorView({ state: sourceState });
        scenario.setup(sourceView);

        const events: EventRecord[] = payloads.map((payload, index) => ({
            id: index + 1,
            eventType: payload.type,
            payload: JSON.stringify(payload),
            createdAt: index + 1,
        }));
        const replayWarning = vi.spyOn(console, "warn").mockImplementation(() => {});
        const replayed = replayEvents(
            EditorState.create({ extensions: getExtensions({ persist: false }) }),
            events,
        );

        expect(replayed.doc.toString()).toBe(sourceView.state.doc.toString());
        expect(
            replayWarning.mock.calls.some(([message]) =>
                String(message).includes("Failed to replay event"),
            ),
        ).toBe(false);

        const report = buildProvenanceReport({
            events,
            draftId: "debug-provenance",
            documentTitle: scenario.label,
            generatedAt: "2026-07-13T00:00:00.000Z",
            finalDocLength: replayed.doc.length,
        });
        expect(report.totals.typedChars).toBeGreaterThan(0);
        expect(report.totals.pastedChars).toBeGreaterThan(0);
        expect(report.totals.humanRevisionChars).toBeGreaterThan(0);
        expect(report.totals.aiRevisionChars).toBeGreaterThan(0);
        expect(report.totals.mixedRevisionChars).toBeGreaterThan(0);
    });
});
