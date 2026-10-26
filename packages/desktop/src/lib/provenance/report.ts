/**
 * report.ts — Writing provenance / authorship report builder.
 *
 * Transforms a draft's full, ordered event stream (the append-only
 * `events` log) into a structured authorship report: how much text was
 * typed vs pasted vs accepted from an AI revision, when the writing
 * happened (sessions + active-writing time), a paste log with large
 * pastes flagged, and an honest integrity statement.
 *
 * Two entry points:
 *   - `buildProvenanceReport` is PURE and deterministic (no Date.now /
 *     Math.random); the caller passes `generatedAt` and `finalDocLength`
 *     so it stays trivially unit-testable.
 *   - `generateProvenanceReport` is a convenience async wrapper that
 *     fetches the events via Tauri, reconstructs the doc to measure its
 *     final length (mirroring src/lib/export.ts), and stamps the time.
 *
 * Reads provenance off each doc-changing event (see
 * src/lib/provenance/classify.ts and src/lib/db/events.ts); events
 * written before the feature lack provenance and are treated as
 * `origin: "unknown"` (legacy), which is surfaced in the integrity
 * section rather than hidden.
 */

import type {
    ChangeSpec,
    CompoundEvent,
    DocChangeEvent,
    EventPayload,
    Provenance,
} from "$lib/db/events";
import type { EventRecord } from "$lib/db/types";

// ── Tunables ─────────────────────────────────────────────────────

/** Gap (ms) above which two consecutive events count as separate sessions / idle. */
export const IDLE_THRESHOLD_MS = 120_000; // 2 min — matches snapshot time threshold.
/** Inserted-char count at/above which a single paste is flagged for review. */
export const PASTE_FLAG_CHARS = 200;

// ── Public types ─────────────────────────────────────────────────

export type WritingSession = {
    startedAt: number; // ms epoch
    endedAt: number;
    durationMs: number;
    typedChars: number;
    pastedChars: number;
};

export type PasteEntry = {
    eventId: number;
    timestamp: number; // ms epoch
    size: number; // inserted chars
    text: string; // the pasted text (joined inserts)
    flagged: boolean; // size >= PASTE_FLAG_CHARS
};

export type ProvenanceReport = {
    schemaVersion: 1;
    documentTitle: string;
    draftId: string;
    generatedAt: string; // ISO — supplied by the caller
    eventCount: number;
    firstEventAt: number | null;
    lastEventAt: number | null;
    totals: {
        typedChars: number;
        pastedChars: number;
        cutChars: number;
        humanRevisionChars: number;
        aiRevisionChars: number;
        mixedRevisionChars: number;
        formatChars: number;
        unknownChars: number;
        finalDocLength: number;
    };
    activeWritingMs: number;
    idleThresholdMs: number;
    sessions: WritingSession[];
    pastes: PasteEntry[];
    aiAssist: { aiRevisionEvents: number; aiAuthoredAnnotations: number };
    integrity: {
        statement: string;
        coversFullHistory: boolean; // false if any "unknown"-origin doc event exists
        legacyEventRatio: number; // unknownChars / max(1, totalInsertedChars)
    };
};

// ── Internal: per-event normalized view ──────────────────────────

type DocEventLike = DocChangeEvent | CompoundEvent;

/** Normalized facts pulled out of one parsed event record. */
type NormalizedEvent = {
    id: number;
    createdAt: number;
    /** Provenance, when the event carries it (doc/compound only). */
    provenance: Provenance | undefined;
    insertedChars: number;
    /** Joined inserted text across this event's change specs. */
    insertedText: string;
};

const INTEGRITY_STATEMENT =
    "This report is evidence of your writing process, not cryptographic proof. " +
    "It records a timestamped, ordered history of edits captured locally on this " +
    "device, showing how much text was typed, pasted, or accepted from an AI " +
    "revision. It cannot prevent someone from retyping AI-generated text by hand, " +
    "and it is tamper-evident only insofar as the local database is trusted.";

/** Returns the doc-change list for an event payload, or undefined if it has none. */
function docChangesOf(payload: EventPayload): ChangeSpec[] | undefined {
    if (payload.type === "doc_change") return payload.changes;
    if (payload.type === "compound") return payload.docChanges;
    return undefined;
}

/** Reads provenance off a doc/compound payload (undefined elsewhere). */
function provenanceOf(payload: EventPayload): Provenance | undefined {
    if (payload.type === "doc_change" || payload.type === "compound") {
        return (payload as DocEventLike).provenance;
    }
    return undefined;
}

/** Parses one record's JSON payload, or undefined if it is malformed. */
function parsePayload(record: EventRecord): EventPayload | undefined {
    try {
        return JSON.parse(record.payload) as EventPayload;
    } catch {
        return undefined;
    }
}

/**
 * Normalizes a record into the facts the builder needs. Inserted chars
 * prefer the captured `provenance.insertedChars`; otherwise they are
 * summed from the event's change specs. The joined inserted text is kept
 * for the paste log.
 */
function normalize(record: EventRecord): NormalizedEvent {
    const payload = parsePayload(record);
    const provenance = payload ? provenanceOf(payload) : undefined;
    const changes = payload ? docChangesOf(payload) : undefined;

    const insertedText = changes ? changes.map((change) => change.insert).join("") : "";
    const insertedChars =
        provenance?.insertedChars !== undefined ? provenance.insertedChars : insertedText.length;

    return {
        id: record.id,
        createdAt: record.createdAt,
        provenance,
        insertedChars,
        insertedText,
    };
}

/** The origin to bucket an event under; legacy/non-doc events are "unknown". */
function originOf(event: NormalizedEvent): Provenance["origin"] {
    return event.provenance?.origin ?? "unknown";
}

// ── Annotation authorship (aiAssist) ─────────────────────────────

type LooseAnnotation = {
    thread?: Array<{ author?: unknown }>;
    aiProvenance?: { requestId?: unknown };
};

/**
 * True when an annotation_add payload carries explicit AI request metadata or
 * has a legacy thread message authored by "AI".
 */
function isAiAuthoredAnnotation(payload: EventPayload): boolean {
    if (payload.type !== "annotation_add") return false;
    const annotation = payload.annotation as LooseAnnotation | undefined;
    if (typeof annotation?.aiProvenance?.requestId === "string") return true;
    const thread = annotation?.thread;
    if (!Array.isArray(thread)) return false;
    return thread.some((message) => message?.author === "AI");
}

// ── Pure builder ─────────────────────────────────────────────────

export function buildProvenanceReport(args: {
    events: EventRecord[]; // ordered by id ASC
    draftId: string;
    documentTitle: string;
    generatedAt: string; // ISO string from caller
    finalDocLength: number; // caller computes via replayEvents
    idleThresholdMs?: number;
    pasteFlagChars?: number;
}): ProvenanceReport {
    const idleThresholdMs = args.idleThresholdMs ?? IDLE_THRESHOLD_MS;
    const pasteFlagChars = args.pasteFlagChars ?? PASTE_FLAG_CHARS;

    const normalized = args.events.map(normalize);

    const totals = {
        typedChars: 0,
        pastedChars: 0,
        cutChars: 0,
        humanRevisionChars: 0,
        aiRevisionChars: 0,
        mixedRevisionChars: 0,
        formatChars: 0,
        unknownChars: 0,
        finalDocLength: args.finalDocLength,
    };

    const sessions: WritingSession[] = [];
    const pastes: PasteEntry[] = [];
    let activeWritingMs = 0;
    let aiRevisionEvents = 0;

    let prevAt: number | null = null;
    let session: WritingSession | null = null;

    for (const event of normalized) {
        const origin = originOf(event);

        // Char buckets — only inserting origins contribute authored chars.
        switch (origin) {
            case "type":
                totals.typedChars += event.insertedChars;
                break;
            case "paste":
                totals.pastedChars += event.insertedChars;
                break;
            case "cut":
                totals.cutChars += event.insertedChars;
                break;
            case "ai-revision":
                totals.aiRevisionChars += event.insertedChars;
                aiRevisionEvents += 1;
                break;
            case "human-revision":
                totals.humanRevisionChars += event.insertedChars;
                break;
            case "mixed-revision":
                totals.mixedRevisionChars += event.insertedChars;
                aiRevisionEvents += 1;
                break;
            case "format":
                totals.formatChars += event.insertedChars;
                break;
            case "unknown":
                totals.unknownChars += event.insertedChars;
                break;
            // delete / restore / nested-edit do not add to authored char totals.
            default:
                break;
        }

        // Timing + sessions — walk every event for the timeline.
        const gap = prevAt === null ? 0 : event.createdAt - prevAt;
        if (prevAt !== null && gap > 0) {
            // Clamp idle gaps (gap > threshold) to a 0 contribution.
            activeWritingMs += gap > idleThresholdMs ? 0 : gap;
        }

        const startsNewSession = session === null || (prevAt !== null && gap > idleThresholdMs);
        if (startsNewSession) {
            if (session !== null) sessions.push(session);
            session = {
                startedAt: event.createdAt,
                endedAt: event.createdAt,
                durationMs: 0,
                typedChars: 0,
                pastedChars: 0,
            };
        } else if (session !== null) {
            session.endedAt = event.createdAt;
            session.durationMs = session.endedAt - session.startedAt;
        }
        if (session !== null) {
            if (origin === "type") session.typedChars += event.insertedChars;
            if (origin === "paste") session.pastedChars += event.insertedChars;
        }

        // Paste log.
        if (origin === "paste") {
            pastes.push({
                eventId: event.id,
                timestamp: event.createdAt,
                size: event.insertedChars,
                text: event.insertedText,
                flagged: event.insertedChars >= pasteFlagChars,
            });
        }

        prevAt = event.createdAt;
    }
    if (session !== null) sessions.push(session);

    // AI-authored annotations — re-parse only what we need, defensively.
    let aiAuthoredAnnotations = 0;
    for (const record of args.events) {
        const payload = parsePayload(record);
        if (payload && isAiAuthoredAnnotation(payload)) aiAuthoredAnnotations += 1;
    }

    const totalInsertedChars =
        totals.typedChars +
        totals.pastedChars +
        totals.cutChars +
        totals.aiRevisionChars +
        totals.formatChars +
        totals.unknownChars;

    const firstEventAt = normalized.length > 0 ? normalized[0].createdAt : null;
    const lastEventAt = normalized.length > 0 ? normalized[normalized.length - 1].createdAt : null;

    return {
        schemaVersion: 1,
        documentTitle: args.documentTitle,
        draftId: args.draftId,
        generatedAt: args.generatedAt,
        eventCount: args.events.length,
        firstEventAt,
        lastEventAt,
        totals,
        activeWritingMs,
        idleThresholdMs,
        sessions,
        pastes,
        aiAssist: { aiRevisionEvents, aiAuthoredAnnotations },
        integrity: {
            statement: INTEGRITY_STATEMENT,
            coversFullHistory: totals.unknownChars === 0,
            legacyEventRatio: totals.unknownChars / Math.max(1, totalInsertedChars),
        },
    };
}

// ── Convenience async fetcher ────────────────────────────────────

/**
 * Fetches a draft's full event stream, reconstructs the doc to measure
 * its final length, stamps the time, and builds the report. Heavy
 * dependencies (Tauri db, CodeMirror replay) are dynamically imported so
 * this module stays light and the pure builder remains testable without
 * a Tauri runtime — mirrors src/lib/export.ts exportDocumentById.
 */
export async function generateProvenanceReport(
    draftId: string,
    documentTitle: string,
): Promise<ProvenanceReport> {
    const { listDraftEvents, listSnapshots, loadSnapshotState } = await import("$lib/db");
    const { getExtensions } = await import("$lib/editor/extensions");
    const { reconstructState } = await import("$lib/editor/replay");

    const [events, snapshots] = await Promise.all([
        listDraftEvents(draftId),
        listSnapshots(draftId),
    ]);
    const latestSnapshot = snapshots.reduce<(typeof snapshots)[number] | undefined>(
        (latest, snapshot) => {
            if (!latest || snapshot.upToEventId > latest.upToEventId) return snapshot;
            return latest;
        },
        undefined,
    );
    const snapshotStateJson = latestSnapshot ? await loadSnapshotState(latestSnapshot.id) : null;
    const eventsSinceSnapshot = latestSnapshot
        ? events.filter((event) => event.id > latestSnapshot.upToEventId)
        : events;

    const state = reconstructState(
        snapshotStateJson,
        eventsSinceSnapshot,
        getExtensions({ persist: false }),
    );

    return buildProvenanceReport({
        events,
        draftId,
        documentTitle,
        generatedAt: new Date().toISOString(),
        finalDocLength: state.doc.length,
    });
}
