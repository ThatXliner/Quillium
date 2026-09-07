// abort.ts — Small shared helpers for linking cancellation and racing work.

export type LinkedAbort = {
    signal: AbortSignal;
    cleanup: () => void;
};

/** Link several signals while preserving the first signal's abort reason. */
export function linkAbortSignals(signals: readonly AbortSignal[]): LinkedAbort {
    const controller = new AbortController();
    const listeners: Array<{ signal: AbortSignal; listener: () => void }> = [];

    for (const signal of signals) {
        if (signal.aborted) {
            controller.abort(signal.reason);
            break;
        }
        const listener = (): void => controller.abort(signal.reason);
        signal.addEventListener("abort", listener, { once: true });
        listeners.push({ signal, listener });
    }

    return {
        signal: controller.signal,
        cleanup: () => {
            for (const { signal, listener } of listeners)
                signal.removeEventListener("abort", listener);
        },
    };
}

/** Reject promptly when a signal aborts, while consuming a late rejection. */
export function raceWithAbort<T>(
    operation: PromiseLike<T>,
    signal: AbortSignal,
    createAbortError: () => Error,
): Promise<T> {
    const pending = Promise.resolve(operation);
    if (signal.aborted) {
        void pending.catch(() => undefined);
        return Promise.reject(createAbortError());
    }
    return new Promise<T>((resolve, reject) => {
        const abort = (): void => {
            signal.removeEventListener("abort", abort);
            reject(createAbortError());
        };
        signal.addEventListener("abort", abort, { once: true });
        pending.then(
            (value) => {
                signal.removeEventListener("abort", abort);
                resolve(value);
            },
            (error: unknown) => {
                signal.removeEventListener("abort", abort);
                reject(error);
            },
        );
    });
}

/** Build an error with the caller-visible cancellation message and name. */
export function abortError(message: string, name = "Error"): Error {
    const error = new Error(message);
    error.name = name;
    return error;
}
