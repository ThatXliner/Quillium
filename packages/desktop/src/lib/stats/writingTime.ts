/**
 * writingTime.ts — Pure writing-time calculations from persisted draft events.
 *
 * Human document edits are grouped into sessions. A gap beyond the shared
 * provenance idle threshold ends the session, so time away from the keyboard
 * never inflates the totals. The latest session remains live until that idle
 * threshold expires.
 */

import type { EventPayload } from "$lib/db/events";
import type { EventRecord } from "$lib/db/types";
import { IDLE_THRESHOLD_MS } from "$lib/provenance/report";

export type WritingTimeSession = {
    startedAt: number;
    endedAt: number;
    durationMs: number;
    editCount: number;
    isActive: boolean;
};

export type WritingTimeSummary = {
    activeWritingMs: number;
    sessionCount: number;
    editCount: number;
};

export type WritingTimeStats = {
    latestSession: WritingTimeSession | null;
    today: WritingTimeSummary;
    week: WritingTimeSummary;
    month: WritingTimeSummary;
    allTime: WritingTimeSummary;
};

type SessionRange = Omit<WritingTimeSession, "durationMs" | "isActive">;

const NON_HUMAN_ORIGINS = new Set(["ai-revision", "restore"]);

function isHumanEdit(record: EventRecord): boolean {
    try {
        const payload = JSON.parse(record.payload) as EventPayload;
        if (payload.type !== "doc_change" && payload.type !== "compound") return false;
        const changes = payload.type === "doc_change" ? payload.changes : payload.docChanges;
        if (changes.length === 0) return false;
        return !NON_HUMAN_ORIGINS.has(payload.provenance?.origin ?? "unknown");
    } catch {
        return false;
    }
}

function startOfDay(now: number): number {
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
}

function startOfWeek(now: number): number {
    const date = new Date(startOfDay(now));
    const daysSinceMonday = (date.getDay() + 6) % 7;
    date.setDate(date.getDate() - daysSinceMonday);
    return date.getTime();
}

function startOfMonth(now: number): number {
    const date = new Date(now);
    date.setDate(1);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
}

function buildSessions(
    events: EventRecord[],
    now: number,
    idleThresholdMs: number,
): SessionRange[] {
    const timestamps = events
        .filter(isHumanEdit)
        .map((event) => event.createdAt)
        .filter((timestamp) => Number.isFinite(timestamp) && timestamp <= now)
        .sort((a, b) => a - b);

    const sessions: SessionRange[] = [];
    for (const timestamp of timestamps) {
        const current = sessions.at(-1);
        if (!current || timestamp - current.endedAt > idleThresholdMs) {
            sessions.push({ startedAt: timestamp, endedAt: timestamp, editCount: 1 });
            continue;
        }
        current.endedAt = timestamp;
        current.editCount += 1;
    }

    return sessions.map((session, index) => ({
        ...session,
        // An activity tracker can only know the writer went idle after the
        // threshold passes. Credit that final window, capped at the next
        // session and at the caller's current time.
        endedAt: Math.min(
            session.endedAt + idleThresholdMs,
            sessions[index + 1]?.startedAt ?? Number.POSITIVE_INFINITY,
            now,
        ),
    }));
}

function summarize(sessions: SessionRange[], periodStart: number): WritingTimeSummary {
    let activeWritingMs = 0;
    let sessionCount = 0;
    let editCount = 0;

    for (const session of sessions) {
        if (session.endedAt < periodStart) continue;
        sessionCount += 1;
        editCount += session.editCount;
        activeWritingMs += Math.max(0, session.endedAt - Math.max(session.startedAt, periodStart));
    }

    return { activeWritingMs, sessionCount, editCount };
}

export function computeWritingTime(
    events: EventRecord[],
    now = Date.now(),
    idleThresholdMs = IDLE_THRESHOLD_MS,
): WritingTimeStats {
    const sessions = buildSessions(events, now, idleThresholdMs);
    const latest = sessions.at(-1);
    const latestActivity = events
        .filter(isHumanEdit)
        .map((event) => event.createdAt)
        .filter((timestamp) => timestamp <= now)
        .sort((a, b) => b - a)[0];
    const latestSession = latest
        ? {
              ...latest,
              durationMs: Math.max(0, latest.endedAt - latest.startedAt),
              isActive: latestActivity !== undefined && now - latestActivity <= idleThresholdMs,
          }
        : null;

    return {
        latestSession,
        today: summarize(sessions, startOfDay(now)),
        week: summarize(sessions, startOfWeek(now)),
        month: summarize(sessions, startOfMonth(now)),
        allTime: summarize(sessions, Number.NEGATIVE_INFINITY),
    };
}

export function formatWritingDuration(ms: number): string {
    if (!Number.isFinite(ms) || ms <= 0) return "0m";
    const totalMinutes = Math.floor(ms / 60_000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
    return totalMinutes > 0 ? `${totalMinutes}m` : "< 1m";
}
