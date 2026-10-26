/**
 * analytics.ts — Pure writing-history aggregation for the statistics dashboard.
 *
 * Event payloads are intentionally parsed here instead of in the UI so daily
 * totals, sessions, streaks, productive hours, goals, and exports share one
 * deterministic interpretation of the append-only draft history.
 */
import type { ChangeSpec, EventPayload, Provenance } from "$lib/db/events";
import type { EventRecord } from "$lib/db/types";

export const ANALYTICS_SESSION_GAP_MS = 30 * 60 * 1000;

export type DailyWriting = {
    date: string;
    words: number;
    sessions: number;
};

export type HourlyWriting = {
    hour: number;
    words: number;
};

export type WritingAnalytics = {
    daily: DailyWriting[];
    hourly: HourlyWriting[];
    totalWordsWritten: number;
    sessionCount: number;
    averageWordsPerSession: number;
    currentStreak: number;
    longestStreak: number;
    mostProductiveHour: number | null;
};

type WritingEvent = {
    createdAt: number;
    words: number;
};

function dateKey(timestamp: number): string {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function startOfLocalDay(timestamp: number): number {
    const date = new Date(timestamp);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function countWords(text: string): number {
    return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function changesOf(payload: EventPayload): ChangeSpec[] | undefined {
    if (payload.type === "doc_change") return payload.changes;
    if (payload.type === "compound") return payload.docChanges;
    return undefined;
}

function provenanceOf(payload: EventPayload): Provenance | undefined {
    if (payload.type === "doc_change" || payload.type === "compound") {
        return payload.provenance;
    }
    return undefined;
}

function writingEvents(records: EventRecord[]): WritingEvent[] {
    const result: WritingEvent[] = [];
    for (const record of records) {
        try {
            const payload = JSON.parse(record.payload) as EventPayload;
            const changes = changesOf(payload);
            if (!changes) continue;
            const origin = provenanceOf(payload)?.origin;
            // Restores and AI-only insertions are not the writer's output. Legacy
            // events remain useful: their inserted text is the best evidence we have.
            if (origin === "restore" || origin === "ai-revision") continue;
            const words = changes.reduce((sum, change) => sum + countWords(change.insert), 0);
            if (words > 0) result.push({ createdAt: record.createdAt, words });
        } catch {
            // A malformed historical record should not make the dashboard unusable.
        }
    }
    return result.sort((a, b) => a.createdAt - b.createdAt);
}

function streaks(activeDays: number[], today: number): { current: number; longest: number } {
    if (activeDays.length === 0) return { current: 0, longest: 0 };
    let longest = 1;
    let run = 1;
    for (let index = 1; index < activeDays.length; index++) {
        const previous = new Date(activeDays[index - 1]);
        const expected = new Date(
            previous.getFullYear(),
            previous.getMonth(),
            previous.getDate() + 1,
        );
        if (expected.getTime() === activeDays[index]) {
            run += 1;
            longest = Math.max(longest, run);
        } else {
            run = 1;
        }
    }

    const last = activeDays.at(-1) ?? 0;
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (last !== today && last !== yesterday.getTime()) return { current: 0, longest };

    let current = 1;
    for (let index = activeDays.length - 1; index > 0; index--) {
        const currentDay = new Date(activeDays[index]);
        const expectedPrevious = new Date(
            currentDay.getFullYear(),
            currentDay.getMonth(),
            currentDay.getDate() - 1,
        );
        if (expectedPrevious.getTime() !== activeDays[index - 1]) break;
        current += 1;
    }
    return { current, longest };
}

export function computeWritingAnalytics(
    records: EventRecord[],
    now = Date.now(),
): WritingAnalytics {
    const events = writingEvents(records);
    const dailyMap = new Map<string, DailyWriting>();
    const hourlyWords = Array.from({ length: 24 }, () => 0);
    let sessionCount = 0;
    let previousAt: number | null = null;

    for (const event of events) {
        const key = dateKey(event.createdAt);
        const startsSession =
            previousAt === null || event.createdAt - previousAt > ANALYTICS_SESSION_GAP_MS;
        if (startsSession) sessionCount += 1;
        const day = dailyMap.get(key) ?? { date: key, words: 0, sessions: 0 };
        day.words += event.words;
        if (startsSession) day.sessions += 1;
        dailyMap.set(key, day);
        hourlyWords[new Date(event.createdAt).getHours()] += event.words;
        previousAt = event.createdAt;
    }

    const daily = [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date));
    const totalWordsWritten = daily.reduce((sum, day) => sum + day.words, 0);
    const activeDays = daily.map((day) =>
        startOfLocalDay(new Date(`${day.date}T12:00:00`).getTime()),
    );
    const streak = streaks(activeDays, startOfLocalDay(now));
    const mostProductiveHour = hourlyWords.some((words) => words > 0)
        ? hourlyWords.indexOf(Math.max(...hourlyWords))
        : null;

    return {
        daily,
        hourly: hourlyWords.map((words, hour) => ({ hour, words })),
        totalWordsWritten,
        sessionCount,
        averageWordsPerSession: sessionCount > 0 ? Math.round(totalWordsWritten / sessionCount) : 0,
        currentStreak: streak.current,
        longestStreak: streak.longest,
        mostProductiveHour,
    };
}

export function analyticsCsv(analytics: WritingAnalytics): string {
    const rows = ["date,words,sessions"];
    for (const day of analytics.daily) rows.push(`${day.date},${day.words},${day.sessions}`);
    return `${rows.join("\n")}\n`;
}
