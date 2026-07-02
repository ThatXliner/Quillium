import type { DocEventRecord, DocumentSnapshotMeta, DraftMeta, TabMeta } from "$lib/db/types";
import {
    buildTimelineItems,
    coordinateForItem,
    describeDocEvent,
    headingForDate,
    reconstructStructureAsOf,
    resolveTabContentAt,
    resolveTimelineTarget,
} from "$lib/editor/history/timeline";
import { describe, expect, it } from "vitest";

// ── Fixtures ────────────────────────────────────────────────────────

function docEvent(
    id: number,
    eventType: string,
    payload: Record<string, unknown>,
    createdAt: number,
): DocEventRecord {
    return { id, documentId: "doc", eventType, payload: JSON.stringify(payload), createdAt };
}

function snapshot(id: number, draftId: string, createdAt: number): DocumentSnapshotMeta {
    return {
        id,
        draftId,
        draftLabel: draftId,
        tabId: "tab",
        upToEventId: 0,
        createdAt,
        label: null,
    };
}

function tab(id: string, createdAt: number, label = id): TabMeta {
    return { id, documentId: "doc", tabType: "draft", label, position: 0, createdAt };
}

function draft(id: string, createdAt: number, label = id): DraftMeta {
    return {
        id,
        documentId: "doc",
        label,
        createdAt,
        isActive: true,
        tabId: "tab",
        parentDraftId: null,
        branchedFrom: null,
        locked: false,
    };
}

const coord = (
    createdAt: number,
    docEventId: number | null = null,
    snapshotId: number | null = null,
) => ({
    createdAt,
    docEventId,
    snapshotId,
});

// ── buildTimelineItems ──────────────────────────────────────────────

describe("buildTimelineItems", () => {
    it("interleaves snapshots and events newest-first", () => {
        const items = buildTimelineItems(
            [snapshot(1, "d", 100), snapshot(2, "d", 300)],
            [docEvent(1, "tab_created", { tabId: "t", label: "A" }, 200)],
        );
        expect(items.map((i) => i.createdAt)).toEqual([300, 200, 100]);
        expect(items[1].kind).toBe("activity");
    });

    it("is stable on timestamp ties", () => {
        const a = buildTimelineItems(
            [snapshot(1, "d", 100)],
            [docEvent(9, "tab_created", {}, 100)],
        );
        const b = buildTimelineItems(
            [snapshot(1, "d", 100)],
            [docEvent(9, "tab_created", {}, 100)],
        );
        expect(a.map((i) => i.id)).toEqual(b.map((i) => i.id));
    });

    it("breaks same-kind ties by numeric id, not lexically", () => {
        // Same timestamp: id 10 must sort ABOVE id 2 (newest-first by id), which
        // a lexical "snapshot:10" < "snapshot:2" compare would get backwards.
        const items = buildTimelineItems([snapshot(2, "d", 100), snapshot(10, "d", 100)], []);
        expect(items.map((i) => i.id)).toEqual(["snapshot:10", "snapshot:2"]);
    });

    it("derives event and snapshot tie-breaker coordinates", () => {
        const items = buildTimelineItems(
            [snapshot(2, "d", 100)],
            [docEvent(9, "tab_created", {}, 100)],
        );
        expect(coordinateForItem(items[0])).toEqual({
            createdAt: 100,
            docEventId: 9,
            snapshotId: null,
        });
        expect(coordinateForItem(items[1])).toEqual({
            createdAt: 100,
            docEventId: null,
            snapshotId: 2,
        });
    });
});

// ── describeDocEvent (real backend event types) ─────────────────────

describe("describeDocEvent", () => {
    it("describes a tab deletion with a restore handle", () => {
        const info = describeDocEvent(
            docEvent(1, "tab_deleted", { tabId: "t", label: "Notes" }, 0),
        );
        expect(info.text).toBe("Deleted tab “Notes”");
        expect(info.restore).toEqual({ kind: "tab", id: "t" });
        expect(info.target).toEqual({ kind: "tab", id: "t" });
    });

    it("labels a normal iteration as a new version", () => {
        const info = describeDocEvent(
            docEvent(1, "draft_iterated", { draftId: "d", label: "v2" }, 0),
        );
        expect(info.text).toBe("New version “v2”");
    });

    it("labels a restore-seeded iteration as a restore", () => {
        const info = describeDocEvent(
            docEvent(1, "draft_iterated", { draftId: "d", label: "x", restoredFromSnapshot: 5 }, 0),
        );
        expect(info.text).toContain("Restored draft");
    });

    it("handles tabs_reordered (a real event the old code lacked)", () => {
        const info = describeDocEvent(docEvent(1, "tabs_reordered", { order: ["a", "b"] }, 0));
        expect(info.text).toBe("Reordered tabs");
        expect(info.restore).toBeNull();
    });

    it("handles legacy draft_created activity", () => {
        const info = describeDocEvent(
            docEvent(1, "draft_created", { draftId: "d", label: "take 2" }, 0),
        );
        expect(info.text).toBe("Created draft “take 2”");
        expect(info.target).toEqual({ kind: "draft", id: "d" });
    });

    it("falls back to the raw type for unknown events", () => {
        const info = describeDocEvent(docEvent(1, "something_new", {}, 0));
        expect(info.text).toBe("something_new");
    });
});

// ── resolveTimelineTarget ──────────────────────────────────────────

describe("resolveTimelineTarget", () => {
    const drafts = [
        { ...draft("d1", 0), tabId: "tab1" },
        { ...draft("d2", 0), tabId: "tab2" },
    ];

    it("resolves a draft activity's owning tab from the draft roster", () => {
        const event = docEvent(1, "draft_unlocked", { draftId: "d2", label: "take 2" }, 100);
        const item = {
            id: "activity:1",
            kind: "activity" as const,
            createdAt: event.createdAt,
            event,
        };

        expect(resolveTimelineTarget(item, drafts)).toEqual({ tabId: "tab2", draftId: "d2" });
    });

    it("prefers a snapshot's tab id and falls back through the draft roster", () => {
        expect(
            resolveTimelineTarget(
                {
                    id: "snapshot:1",
                    kind: "snapshot",
                    createdAt: 100,
                    snapshot: { ...snapshot(1, "d2", 100), tabId: null },
                },
                drafts,
            ),
        ).toEqual({ tabId: "tab2", draftId: "d2" });
    });
});

// ── reconstructStructureAsOf ────────────────────────────────────────

describe("reconstructStructureAsOf", () => {
    const tabs = [tab("tab1", 0, "Main"), tab("tab2", 200, "Second")];
    const drafts = [draft("d1", 0, "main"), draft("d2", 200, "main")];
    const events = [
        docEvent(1, "tab_created", { tabId: "tab1", label: "Main", rootDraftId: "d1" }, 0),
        docEvent(2, "tab_created", { tabId: "tab2", label: "Second", rootDraftId: "d2" }, 200),
        docEvent(3, "tab_renamed", { tabId: "tab1", label: "Renamed" }, 300),
    ];

    it("excludes a tab created after T", () => {
        const { tabs: t } = reconstructStructureAsOf(tabs, drafts, events, coord(100, 1));
        expect(t.map((x) => x.id)).toEqual(["tab1"]);
    });

    it("includes both tabs after the second was created", () => {
        const { tabs: t } = reconstructStructureAsOf(tabs, drafts, events, coord(250, 2));
        expect(t.map((x) => x.id).sort()).toEqual(["tab1", "tab2"]);
    });

    it("rewinds a label to its value at T", () => {
        const before = reconstructStructureAsOf(tabs, drafts, events, coord(250, 2));
        const after = reconstructStructureAsOf(tabs, drafts, events, coord(350, 3));
        expect(before.tabs.find((x) => x.id === "tab1")!.label).toBe("Main");
        expect(after.tabs.find((x) => x.id === "tab1")!.label).toBe("Renamed");
    });

    it("rewinds tab order across a tabs_reordered event", () => {
        const evs = [...events, docEvent(4, "tabs_reordered", { order: ["tab2", "tab1"] }, 400)];
        // Before the reorder: creation order (tab1, tab2).
        expect(
            reconstructStructureAsOf(tabs, drafts, evs, coord(350, 3)).tabs.map((x) => x.id),
        ).toEqual(["tab1", "tab2"]);
        // After: the reordered order (tab2, tab1).
        expect(
            reconstructStructureAsOf(tabs, drafts, evs, coord(450, 4)).tabs.map((x) => x.id),
        ).toEqual(["tab2", "tab1"]);
    });

    it("treats a deleted-then-not-restored draft as gone at T", () => {
        const evs = [...events, docEvent(4, "draft_deleted", { draftId: "d2" }, 400)];
        const { drafts: d } = reconstructStructureAsOf(tabs, drafts, evs, coord(450, 4));
        expect(d.map((x) => x.id)).not.toContain("d2");
    });

    it("revives a draft that was restored by T", () => {
        const evs = [
            ...events,
            docEvent(4, "draft_deleted", { draftId: "d2" }, 400),
            docEvent(5, "draft_restored", { draftId: "d2" }, 500),
        ];
        const { drafts: d } = reconstructStructureAsOf(tabs, drafts, evs, coord(550, 5));
        expect(d.map((x) => x.id)).toContain("d2");
    });

    it("uses the doc event id to split same-millisecond structural coordinates", () => {
        const evs = [
            docEvent(1, "tab_created", { tabId: "tab1", label: "Main", rootDraftId: "d1" }, 100),
            docEvent(2, "tab_renamed", { tabId: "tab1", label: "Renamed" }, 100),
        ];

        expect(reconstructStructureAsOf(tabs, drafts, evs, coord(100, 1)).tabs[0].label).toBe(
            "Main",
        );
        expect(reconstructStructureAsOf(tabs, drafts, evs, coord(100, 2)).tabs[0].label).toBe(
            "Renamed",
        );
    });

    it("keeps a legacy tab whose creation was never logged (backfilled createdAt)", () => {
        // Pre-#160 documents: the migration backfills the "Main" tab stamped
        // with the MIGRATION time, so pre-migration coordinates predate the
        // tab row's createdAt. With no tab_created event anywhere in the log,
        // the tab (and its never-logged draft) must still render — otherwise
        // every pre-migration snapshot previews as "No tabs at this point".
        const legacyTabs = [tab("legacy-tab", 1000, "Main")];
        const legacyDrafts = [{ ...draft("legacy-draft", 500, "main"), tabId: "legacy-tab" }];

        const { tabs: t, drafts: d } = reconstructStructureAsOf(
            legacyTabs,
            legacyDrafts,
            [],
            coord(600),
        );

        expect(t.map((x) => x.id)).toEqual(["legacy-tab"]);
        expect(d.map((x) => x.id)).toEqual(["legacy-draft"]);
    });

    it("still excludes a logged tab created after T", () => {
        // The legacy leniency must not leak: a tab whose creation IS logged
        // (just after T) stays excluded.
        const { tabs: t } = reconstructStructureAsOf(tabs, drafts, events, coord(100, 1));
        expect(t.map((x) => x.id)).not.toContain("tab2");
    });
});

// ── resolveTabContentAt ─────────────────────────────────────────────

describe("resolveTabContentAt", () => {
    // tabA owns draft dA; tabB owns draft dB.
    const drafts = [
        { ...draft("dA", 0), tabId: "tabA" },
        { ...draft("dB", 0), tabId: "tabB" },
    ];
    const snap = (id: number, draftId: string, createdAt: number): DocumentSnapshotMeta => ({
        ...snapshot(id, draftId, createdAt),
        tabId: draftId === "dA" ? "tabA" : "tabB",
    });
    // newest-first, as the backend returns.
    const snaps = [snap(3, "dA", 300), snap(2, "dB", 200), snap(1, "dA", 100)];

    it("returns the latest snapshot of the tab at/before T as current", () => {
        const ref = resolveTabContentAt(snaps, drafts, "tabA", coord(350));
        expect(ref.current?.id).toBe(3);
        expect(ref.previous?.id).toBe(1); // prior dA snapshot is the baseline
        expect(ref.draftId).toBe("dA");
    });

    it("ignores snapshots after T", () => {
        const ref = resolveTabContentAt(snaps, drafts, "tabA", coord(150));
        expect(ref.current?.id).toBe(1);
        expect(ref.previous).toBeNull(); // nothing older
    });

    it("scopes to the requested tab only", () => {
        const ref = resolveTabContentAt(snaps, drafts, "tabB", coord(350));
        expect(ref.current?.id).toBe(2);
        expect(ref.draftId).toBe("dB");
    });

    it("returns nulls when the tab has no content at T", () => {
        const ref = resolveTabContentAt(snaps, drafts, "tabB", coord(150));
        expect(ref.current).toBeNull();
        expect(ref.draftId).toBeNull();
    });

    it("uses the snapshot id to split same-millisecond content coordinates", () => {
        const sameTime = [snap(10, "dA", 100), snap(2, "dA", 100)];

        expect(resolveTabContentAt(sameTime, drafts, "tabA", coord(100, null, 2)).current?.id).toBe(
            2,
        );
        expect(
            resolveTabContentAt(sameTime, drafts, "tabA", coord(100, null, 10)).current?.id,
        ).toBe(10);
    });
});

// ── headingForDate (calendar days, not elapsed ms) ──────────────────

describe("headingForDate", () => {
    it("labels an entry from late last night as Yesterday at 12:30am, not Today", () => {
        const now = new Date(2026, 5, 26, 0, 30).getTime(); // Jun 26, 12:30am
        const lastNight = new Date(2026, 5, 25, 23, 30).getTime(); // Jun 25, 11:30pm
        // Only ~1h elapsed, but it's the previous calendar day.
        expect(headingForDate(lastNight, now)).toBe("Yesterday");
    });

    it("labels an entry from earlier the same calendar day as Today", () => {
        const now = new Date(2026, 5, 26, 23, 0).getTime(); // Jun 26, 11pm
        const morning = new Date(2026, 5, 26, 1, 0).getTime(); // Jun 26, 1am
        expect(headingForDate(morning, now)).toBe("Today");
    });

    it("labels a slightly-future entry (clock skew) as Today, not a weekday", () => {
        const now = new Date(2026, 5, 26, 12, 0).getTime(); // Jun 26, noon
        const future = new Date(2026, 5, 27, 1, 0).getTime(); // Jun 27, 1am (ahead of now)
        expect(headingForDate(future, now)).toBe("Today");
    });
});
