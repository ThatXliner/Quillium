/**
 * timeline.ts — Pure helpers for the document-wide version-history timeline.
 *
 * The history page is a "git reflog" for a whole document: one linear,
 * chronological stream interleaving every draft's content snapshots with the
 * document's structural events (tab/draft create/rename/delete/iterate/branch/
 * lock). Each entry is a coordinate the whole document can be restored to.
 *
 * Everything here is pure (no Svelte/DOM/Tauri) so it can be unit-tested and
 * shared between the timeline list and the structure-map preview. The
 * structure reconstruction mirrors the Rust `reconstruct_structure` in
 * `src-tauri/src/db/tabs.rs` — keep the two in sync.
 */
import type { DocEventRecord, DocumentSnapshotMeta, DraftMeta, TabMeta } from "$lib/db/types";

// ── Timeline items ──────────────────────────────────────────────────

export type TimelineItem =
    | {
          id: string;
          kind: "snapshot";
          createdAt: number;
          snapshot: DocumentSnapshotMeta;
      }
    | {
          id: string;
          kind: "activity";
          createdAt: number;
          event: DocEventRecord;
      };

/**
 * Merges document-wide snapshots and structural events into one timeline,
 * newest first. Ties break deterministically by id so the order is stable.
 */
export function buildTimelineItems(
    snapshots: DocumentSnapshotMeta[],
    docEvents: DocEventRecord[],
): TimelineItem[] {
    const items: TimelineItem[] = [
        ...snapshots.map((snapshot) => ({
            id: `snapshot:${snapshot.id}`,
            kind: "snapshot" as const,
            createdAt: snapshot.createdAt,
            snapshot,
        })),
        ...docEvents.map((event) => ({
            id: `activity:${event.id}`,
            kind: "activity" as const,
            createdAt: event.createdAt,
            event,
        })),
    ];
    // Newest first. Ties break deterministically: same-kind items by their
    // numeric id (NOT lexically — "snapshot:10" must sort after "snapshot:2"),
    // and snapshot-vs-activity ties by kind so the order is always stable.
    const numericId = (item: TimelineItem) =>
        item.kind === "snapshot" ? item.snapshot.id : item.event.id;
    return items.sort(
        (a, b) =>
            b.createdAt - a.createdAt ||
            a.kind.localeCompare(b.kind) ||
            numericId(b) - numericId(a),
    );
}

// ── Structural event descriptions ───────────────────────────────────

/** What a structural event concerns, for the preview map's highlight. */
export type DocEventTarget = {
    kind: "tab" | "draft";
    id: string;
};

export type TimelineTarget = {
    tabId: string | null;
    draftId: string | null;
};

export type DocEventInfo = {
    text: string;
    /** The tab/draft this event acted on (for preview highlight), or null. */
    target: DocEventTarget | null;
    /** A deletion this event performed, restorable from its row, or null. */
    restore: { kind: "tab" | "draft"; id: string } | null;
};

function parsePayload(payload: string): Record<string, unknown> {
    try {
        return JSON.parse(payload) as Record<string, unknown>;
    } catch {
        return {};
    }
}

/**
 * Human-readable description of a structural event. Matches the event types the
 * Rust backend actually emits (see `log_doc_event` call sites in `tabs.rs` /
 * `events.rs`): tab_created/renamed/deleted/restored, tabs_reordered,
 * draft_iterated/branched/renamed/deleted/reparented/locked/unlocked,
 * checkpoint_created.
 */
export function describeDocEvent(ev: DocEventRecord): DocEventInfo {
    const p = parsePayload(ev.payload);
    const label = typeof p.label === "string" ? p.label : "";
    const prev = typeof p.previousLabel === "string" ? p.previousLabel : "";
    const tabId = typeof p.tabId === "string" ? p.tabId : null;
    const draftId = typeof p.draftId === "string" ? p.draftId : null;
    const tabTarget = (): DocEventTarget | null => (tabId ? { kind: "tab", id: tabId } : null);
    const draftTarget = (): DocEventTarget | null =>
        draftId ? { kind: "draft", id: draftId } : null;

    switch (ev.eventType) {
        case "tab_created":
            return { text: `Created tab “${label}”`, target: tabTarget(), restore: null };
        case "tab_renamed":
            return {
                text: `Renamed tab “${prev}” to “${label}”`,
                target: tabTarget(),
                restore: null,
            };
        case "tab_deleted":
            return {
                text: `Deleted tab “${label}”`,
                target: tabTarget(),
                restore: tabId ? { kind: "tab", id: tabId } : null,
            };
        case "tab_restored":
            return { text: `Restored tab “${label}”`, target: tabTarget(), restore: null };
        case "tabs_reordered":
            return { text: "Reordered tabs", target: null, restore: null };
        case "draft_created":
            return { text: `Created draft “${label}”`, target: draftTarget(), restore: null };
        case "draft_iterated": {
            const restored = typeof p.restoredFromSnapshot === "number";
            return {
                text: restored ? `Restored draft “${label}”` : `New version “${label}”`,
                target: draftTarget(),
                restore: null,
            };
        }
        case "draft_branched":
            return { text: `Branched draft “${label}”`, target: draftTarget(), restore: null };
        case "draft_renamed":
            return {
                text: `Renamed draft “${prev}” to “${label}”`,
                target: draftTarget(),
                restore: null,
            };
        case "draft_deleted":
            return {
                text: `Deleted draft “${label}”`,
                target: draftTarget(),
                restore: draftId ? { kind: "draft", id: draftId } : null,
            };
        case "draft_reparented":
            return { text: "Re-attached draft", target: draftTarget(), restore: null };
        case "draft_locked":
            return { text: `Locked draft “${label}”`, target: draftTarget(), restore: null };
        case "draft_unlocked":
            return { text: `Unlocked draft “${label}”`, target: draftTarget(), restore: null };
        case "checkpoint_created": {
            const draftLabel = typeof p.draftLabel === "string" ? p.draftLabel : "";
            return {
                text: `Saved checkpoint “${label}” on draft “${draftLabel}”`,
                target: draftTarget(),
                restore: null,
            };
        }
        default:
            return { text: ev.eventType, target: null, restore: null };
    }
}

/**
 * Resolves the tab/draft a timeline coordinate concerns. Snapshot rows carry
 * their tab directly; draft-level activity rows may only carry `draftId`, so
 * fall back to the full draft roster for older events and lock/rename/delete
 * events whose payloads do not include `tabId`.
 */
export function resolveTimelineTarget(item: TimelineItem, allDrafts: DraftMeta[]): TimelineTarget {
    if (item.kind === "snapshot") {
        const draft = allDrafts.find((d) => d.id === item.snapshot.draftId);
        return {
            tabId: item.snapshot.tabId ?? draft?.tabId ?? null,
            draftId: item.snapshot.draftId,
        };
    }

    const info = describeDocEvent(item.event);
    if (!info.target) return { tabId: null, draftId: null };
    if (info.target.kind === "tab") return { tabId: info.target.id, draftId: null };

    const payload = parsePayload(item.event.payload);
    const payloadTabId = typeof payload.tabId === "string" ? payload.tabId : null;
    const draft = allDrafts.find((d) => d.id === info.target?.id);
    return {
        tabId: payloadTabId ?? draft?.tabId ?? null,
        draftId: info.target.id,
    };
}

// ── Structure reconstruction (as-of a coordinate) ───────────────────

/**
 * Reconstructs the document's tab/draft structure at time `t` for the preview
 * map. Takes the document's full tab/draft roster (incl. soft-deleted — e.g.
 * from `listDocumentStructure`) and replays `docEvents ≤ t` to decide which
 * were live then and their labels. Existence is gated by each node's real
 * `createdAt` (so a node created after `t` is excluded even though it has no
 * events ≤ t), mirroring the Rust `restore_structure_to`.
 *
 * Returns the live-at-`t` tabs and drafts, with labels rewound to `t`. Drafts
 * keep their structural links (parent/branch) from the row, so `layoutDraftRows`
 * renders the historical tree correctly.
 */
export function reconstructStructureAsOf(
    allTabs: TabMeta[],
    allDrafts: DraftMeta[],
    docEvents: DocEventRecord[],
    t: number,
): { tabs: TabMeta[]; drafts: DraftMeta[] } {
    // Replay events ≤ t (oldest first) into deleted-state + label maps.
    const events = [...docEvents]
        .filter((e) => e.createdAt <= t)
        .sort((a, b) => a.createdAt - b.createdAt || a.id - b.id);

    const tabDeleted = new Map<string, boolean>();
    const tabLabel = new Map<string, string>();
    const draftDeleted = new Map<string, boolean>();
    const draftLabel = new Map<string, string>();
    // Historical tab order at `t`, mirroring the Rust `reconstruct_structure`:
    // `tab_created` appends, `tabs_reordered` replaces the whole order. Empty
    // when no order was ever logged (legacy) → fall back to the live order.
    let tabOrder: string[] = [];

    for (const ev of events) {
        let p: Record<string, unknown> = {};
        try {
            p = JSON.parse(ev.payload) as Record<string, unknown>;
        } catch {
            continue;
        }
        const str = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : undefined);
        const tabId = str("tabId");
        const draftId = str("draftId");
        const label = str("label");
        switch (ev.eventType) {
            case "tab_created": {
                if (tabId) {
                    tabDeleted.set(tabId, false);
                    if (label) tabLabel.set(tabId, label);
                    if (!tabOrder.includes(tabId)) tabOrder.push(tabId);
                    const root = str("rootDraftId");
                    if (root) {
                        draftDeleted.set(root, false);
                        draftLabel.set(root, "main");
                    }
                }
                break;
            }
            case "tabs_reordered": {
                if (Array.isArray(p.order)) {
                    tabOrder = p.order.filter((id): id is string => typeof id === "string");
                }
                break;
            }
            case "tab_renamed":
                if (tabId && label) tabLabel.set(tabId, label);
                break;
            case "tab_deleted":
                if (tabId) tabDeleted.set(tabId, true);
                break;
            case "tab_restored":
                if (tabId) tabDeleted.set(tabId, false);
                break;
            case "draft_iterated":
            case "draft_branched": {
                if (draftId) {
                    draftDeleted.set(draftId, false);
                    if (label) draftLabel.set(draftId, label);
                }
                break;
            }
            case "draft_renamed":
                if (draftId && label) draftLabel.set(draftId, label);
                break;
            case "draft_deleted": {
                if (p.mode === "cascade" && Array.isArray(p.ids)) {
                    for (const id of p.ids) if (typeof id === "string") draftDeleted.set(id, true);
                } else if (draftId) {
                    draftDeleted.set(draftId, true);
                }
                break;
            }
            case "draft_restored":
                if (draftId) draftDeleted.set(draftId, false);
                break;
            default:
                break;
        }
    }

    const liveTabs = allTabs
        .filter((tab) => tab.createdAt <= t && !(tabDeleted.get(tab.id) ?? false))
        .map((tab) => ({ ...tab, label: tabLabel.get(tab.id) ?? tab.label }));

    // Reorder to the historical order at `t`. A tab missing from `tabOrder`
    // (legacy / no logged order) sorts after the ordered ones, keeping its live
    // relative position — a stable sort on the order index, with absent ids at
    // the end. With no order ever logged, this is a no-op (live order kept).
    const orderIndex = (id: string) => {
        const i = tabOrder.indexOf(id);
        return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    };
    const tabs = liveTabs
        .map((tab, i) => ({ tab, i }))
        .sort((a, b) => orderIndex(a.tab.id) - orderIndex(b.tab.id) || a.i - b.i)
        .map(({ tab }) => tab);

    const drafts = allDrafts
        .filter((d) => d.createdAt <= t && !(draftDeleted.get(d.id) ?? false))
        .map((d) => ({ ...d, label: draftLabel.get(d.id) ?? d.label }));

    return { tabs, drafts };
}

// ── Date grouping ───────────────────────────────────────────────────

export type TimelineGroup = { heading: string; items: TimelineItem[] };

export function groupByDate(items: TimelineItem[], now: number): TimelineGroup[] {
    const groups: TimelineGroup[] = [];
    let lastHeading = "";
    for (const item of items) {
        const heading = headingForDate(item.createdAt, now);
        if (heading !== lastHeading) {
            groups.push({ heading, items: [] });
            lastHeading = heading;
        }
        groups[groups.length - 1].items.push(item);
    }
    return groups;
}

export function headingForDate(ms: number, now: number): string {
    const d = new Date(ms);
    const nowDate = new Date(now);
    // Count CALENDAR days between the two local midnights, not elapsed time —
    // otherwise an entry from 11pm last night reads as "Today" at 12:30am.
    const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diffDays = Math.round((startOfDay(nowDate) - startOfDay(d)) / 86400000);
    // `diffDays <= 0` (not just `=== 0`) so an entry whose stored timestamp is
    // slightly ahead of `now` (backend/frontend clock skew) still reads "Today"
    // instead of falling through to the weekday branch.
    if (diffDays <= 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
    if (d.getMonth() === nowDate.getMonth() && d.getFullYear() === nowDate.getFullYear())
        return "This month";
    return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export function formatTime(ms: number): string {
    const d = new Date(ms);
    const date = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    return `${date}, ${time}`;
}

export function formatTimeShort(ms: number): string {
    return new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

// ── Per-tab content at a coordinate ─────────────────────────────────

/**
 * The snapshots that represent a tab's content at coordinate `t`, for the
 * track-changes preview: `current` is the latest snapshot (of the tab's most
 * recently-active draft) at or before `t`; `previous` is the one just before
 * that (the diff baseline). Either may be null (no content yet / no prior
 * version). `draftId` is the draft whose content is shown.
 */
export type TabContentRef = {
    draftId: string | null;
    current: DocumentSnapshotMeta | null;
    previous: DocumentSnapshotMeta | null;
};

/**
 * Resolves which content to show for `tabId` at coordinate `t`.
 *
 * Picks the tab's draft that had the most recent snapshot at/before `t` (the
 * one you were actually working in), then within that draft returns the
 * snapshot at/before `t` (`current`) and the next-older one (`previous`).
 * `snapshots` is the document-wide list (newest-first, as `listDocumentSnapshots`
 * returns); `drafts` is the tab's drafts live at `t` (to scope to this tab).
 */
export function resolveTabContentAt(
    snapshots: DocumentSnapshotMeta[],
    drafts: DraftMeta[],
    tabId: string,
    t: number,
): TabContentRef {
    const tabDraftIds = new Set(drafts.filter((d) => d.tabId === tabId).map((d) => d.id));
    // Snapshots of this tab's drafts at/before t, newest first.
    const eligible = snapshots
        .filter((s) => tabDraftIds.has(s.draftId) && s.createdAt <= t)
        .sort((a, b) => b.createdAt - a.createdAt || b.id - a.id);

    if (eligible.length === 0) return { draftId: null, current: null, previous: null };

    const current = eligible[0];
    // Baseline: the next-older snapshot OF THE SAME DRAFT (track-changes is
    // within one draft's history, not across drafts).
    const previous =
        eligible.find((s) => s.draftId === current.draftId && s.id !== current.id) ?? null;
    return { draftId: current.draftId, current, previous };
}
