// restartState.ts — Per-window restart freeze and in-flight database barrier.
import { writable } from "svelte/store";

export const restartPending = writable(false);
let attempt: string | null = null;
let flushingNested = false;
const pendingWrites = new Set<Promise<unknown>>();
let barrierWriteFailed = false;

export function restartIsPending(): boolean {
    return attempt !== null;
}

export function beginRestart(attemptId: string): boolean {
    if (attempt !== null) return false;
    attempt = attemptId;
    barrierWriteFailed = false;
    restartPending.set(true);
    return true;
}

export function cancelRestart(attemptId: string): void {
    if (attempt !== attemptId) return;
    attempt = null;
    restartPending.set(false);
}

export function editorMutationAllowed(): boolean {
    return attempt === null || flushingNested;
}

export function flushNestedForRestart(flush: () => void): void {
    flushingNested = true;
    try {
        flush();
    } finally {
        flushingNested = false;
    }
}

export function requireEditorialMutation(): void {
    if (restartIsPending())
        throw new Error("Quillium is saving before restarting. Try again shortly.");
}

export function trackDatabaseWrite<T>(write: Promise<T>): Promise<T> {
    pendingWrites.add(write);
    void write.then(
        () => pendingWrites.delete(write),
        () => {
            pendingWrites.delete(write);
            if (restartIsPending()) barrierWriteFailed = true;
        },
    );
    return write;
}

export async function drainDatabaseWrites(): Promise<void> {
    while (pendingWrites.size > 0) await Promise.allSettled([...pendingWrites]);
    if (barrierWriteFailed) throw new Error("A pending database change could not be saved.");
}

const restartParticipants = new Set<() => Promise<void>>();

export function registerRestartParticipant(flush: () => Promise<void>): () => void {
    restartParticipants.add(flush);
    return () => restartParticipants.delete(flush);
}

export async function flushRestartParticipants(): Promise<void> {
    await Promise.all([...restartParticipants].map((flush) => flush()));
}
