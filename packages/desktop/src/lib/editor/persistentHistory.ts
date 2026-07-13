/**
 * persistentHistory.ts — Lossless cross-restart CodeMirror history.
 *
 * CodeMirror serializes history changes and selections but intentionally omits
 * StateEffects. Quillium's annotation and version-group inverses live in those
 * effects, so restoring the stock JSON can undo text without its semantic state.
 * This adapter stores tagged Quillium effects alongside CodeMirror's own JSON
 * and rehydrates them into the matching history events on load.
 *
 * CodeMirror does not expose a public history-event codec. The small runtime
 * adapter below is deliberately isolated and fail-closed: if its internal shape
 * or an effect codec is unknown, the loaded document gets a fresh history stack
 * rather than a partially restored one. Round-trip tests pin the integration to
 * the installed @codemirror/commands and @codemirror/state versions.
 */

import {
    type SerializedAnnotationHistoryEffect,
    deserializeAnnotationHistoryEffect,
    serializeAnnotationHistoryEffect,
} from "$lib/editor/plugins/annotations/annotationField";
import {
    type SerializedVersionGroupHistoryEffect,
    deserializeVersionGroupHistoryEffect,
    serializeVersionGroupHistoryEffect,
} from "$lib/editor/plugins/annotations/versionGroupField";
import { historyField } from "@codemirror/commands";
import {
    type EditorSelection,
    type EditorState,
    type Extension,
    Facet,
    type StateEffect,
    StateField,
    Transaction,
} from "@codemirror/state";

const PERSISTED_HISTORY_VERSION = 1;

/** Per-document policy. Existing call sites default to preserving history. */
export const persistHistoryFacet = Facet.define<boolean, boolean>({
    combine: (values) => values[0] ?? true,
});

export type SerializedHistoryEffect =
    | SerializedAnnotationHistoryEffect
    | SerializedVersionGroupHistoryEffect;

type PersistedHistory = {
    version: typeof PERSISTED_HISTORY_VERSION;
    codeMirror: unknown;
    effects: {
        done: SerializedHistoryEffect[][];
        undone: SerializedHistoryEffect[][];
    };
    previous: {
        time: number;
        userEvent?: string;
    };
};

type RuntimeHistoryEvent = {
    changes?: unknown;
    effects: StateEffect<unknown>[];
    selectionsAfter: EditorSelection[];
};

type RuntimeHistoryState = {
    done: RuntimeHistoryEvent[];
    undone: RuntimeHistoryEvent[];
    prevTime: number;
    prevUserEvent?: string;
};

type RuntimeHistoryField = {
    spec: {
        create: (state: EditorState) => unknown;
        toJSON: (value: unknown, state: EditorState) => unknown;
        fromJSON: (value: unknown, state: EditorState) => unknown;
    };
};

// @codemirror/commands keeps these hooks private at the type level, even though
// the StateField runtime exposes them. Keep the cast here so upgrades have one
// auditable compatibility boundary.
const runtimeHistorySpec = (() => {
    const spec = (historyField as unknown as Partial<RuntimeHistoryField>).spec;
    return spec &&
        typeof spec.create === "function" &&
        typeof spec.toJSON === "function" &&
        typeof spec.fromJSON === "function"
        ? spec
        : null;
})();

/**
 * Whether a persisted-state transaction started a new live undo group.
 *
 * Selection-only transactions are intentionally not written to the event log,
 * but they can stop CodeMirror from joining the next edit into the preceding
 * group. A newly appended event retains the prior top event below a new top; a
 * joined event replaces it, while an untracked transaction leaves it as the
 * top. Recording that boundary alongside the top event's surviving selection
 * contribution lets replay reproduce the history shape without writing a
 * standalone event for every cursor movement.
 */
export function transactionStartsNewHistoryGroup(transaction: Transaction): boolean {
    if (
        transaction.annotation(Transaction.addToHistory) === false ||
        transaction.isUserEvent("undo") ||
        transaction.isUserEvent("redo")
    ) {
        return false;
    }
    if (!runtimeHistorySpec) return true;
    const before = transaction.startState.field(historyField, false) as
        | RuntimeHistoryState
        | undefined;
    const after = transaction.state.field(historyField, false) as RuntimeHistoryState | undefined;
    if (!before || !after) return false;
    if (!Array.isArray(before.done) || !Array.isArray(after.done)) return true;
    const previousTop = before.done.at(-1);
    const nextTop = after.done.at(-1);
    return Boolean(previousTop && nextTop !== previousTop && after.done.includes(previousTop));
}

/** Whether CodeMirror's private done branch has no physical events at all. */
export function historyDoneBranchIsEmpty(state: EditorState): boolean {
    const history = state.field(historyField, false) as RuntimeHistoryState | undefined;
    return Boolean(history && Array.isArray(history.done) && history.done.length === 0);
}

/** Whether the done branch contains only CodeMirror's changeless selection sentinel. */
export function historyDoneBranchIsSelectionSentinel(state: EditorState): boolean {
    const history = state.field(historyField, false) as RuntimeHistoryState | undefined;
    return Boolean(
        history &&
            Array.isArray(history.done) &&
            history.done.length === 1 &&
            !history.done[0].changes &&
            Array.isArray(history.done[0].effects) &&
            history.done[0].effects.length === 0,
    );
}

/**
 * Private-shape snapshot used to reproduce selection-only history traffic that
 * is intentionally omitted from the event log. `undefined` means the installed
 * CodeMirror runtime no longer matches the pinned shape.
 */
export function historyDoneTopInfo(state: EditorState):
    | {
          branchLength: number;
          selectionSentinel: boolean;
          selectionsAfter: readonly EditorSelection[];
      }
    | undefined {
    const history = state.field(historyField, false) as RuntimeHistoryState | undefined;
    if (!history || !Array.isArray(history.done)) return undefined;
    const top = history.done.at(-1);
    if (!top) {
        return { branchLength: 0, selectionSentinel: false, selectionsAfter: [] };
    }
    if (!Array.isArray(top.effects) || !Array.isArray(top.selectionsAfter)) return undefined;
    return {
        branchLength: history.done.length,
        selectionSentinel: !top.changes && top.effects.length === 0,
        selectionsAfter: top.selectionsAfter,
    };
}

export function serializeHistoryEffect(
    effect: StateEffect<unknown>,
): SerializedHistoryEffect | undefined {
    return serializeAnnotationHistoryEffect(effect) ?? serializeVersionGroupHistoryEffect(effect);
}

function requireSerializedEffect(effect: StateEffect<unknown>): SerializedHistoryEffect {
    const serialized =
        serializeAnnotationHistoryEffect(effect) ?? serializeVersionGroupHistoryEffect(effect);
    if (!serialized) throw new Error("Unsupported StateEffect in CodeMirror history");
    return serialized;
}

export function deserializeHistoryEffect(
    serialized: SerializedHistoryEffect,
): StateEffect<unknown> | undefined {
    return (
        deserializeAnnotationHistoryEffect(serialized) ??
        deserializeVersionGroupHistoryEffect(serialized)
    );
}

function requireDeserializedEffect(serialized: SerializedHistoryEffect): StateEffect<unknown> {
    const effect =
        deserializeAnnotationHistoryEffect(serialized) ??
        deserializeVersionGroupHistoryEffect(serialized);
    if (!effect) throw new Error(`Unsupported persisted history effect: ${serialized.type}`);
    return effect;
}

function serializeBranch(branch: RuntimeHistoryEvent[]): SerializedHistoryEffect[][] {
    return branch.map((event) => event.effects.map(requireSerializedEffect));
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseEffectBranch(value: unknown): SerializedHistoryEffect[][] {
    if (!Array.isArray(value)) throw new Error("Persisted history branch is not an array");
    return value.map((event) => {
        if (!Array.isArray(event)) throw new Error("Persisted history event is not an array");
        return event.map((effect) => {
            if (!isRecord(effect) || typeof effect.type !== "string" || !("value" in effect)) {
                throw new Error("Invalid persisted history effect");
            }
            return effect as SerializedHistoryEffect;
        });
    });
}

function parsePersistedHistory(value: unknown): PersistedHistory | null {
    if (value == null) return null;
    if (!isRecord(value) || value.version !== PERSISTED_HISTORY_VERSION) {
        // Legacy CodeMirror history has no effect payload and is unsafe to load.
        return null;
    }
    if (!isRecord(value.effects)) throw new Error("Invalid persisted history effects");
    if (!isRecord(value.previous) || typeof value.previous.time !== "number") {
        throw new Error("Invalid persisted history grouping state");
    }
    if (value.previous.userEvent !== undefined && typeof value.previous.userEvent !== "string") {
        throw new Error("Invalid persisted history user event");
    }
    return {
        version: PERSISTED_HISTORY_VERSION,
        codeMirror: value.codeMirror,
        effects: {
            done: parseEffectBranch(value.effects.done),
            undone: parseEffectBranch(value.effects.undone),
        },
        previous: {
            time: value.previous.time,
            userEvent: value.previous.userEvent,
        },
    };
}

function hydrateBranch(
    events: RuntimeHistoryEvent[],
    serialized: SerializedHistoryEffect[][],
): void {
    if (events.length !== serialized.length) {
        throw new Error("Persisted history event/effect counts do not match");
    }
    for (let index = 0; index < events.length; index++) {
        events[index].effects = serialized[index].map(requireDeserializedEffect);
    }
}

function hydrateHistory(value: PersistedHistory, state: EditorState): unknown {
    if (!runtimeHistorySpec) throw new Error("CodeMirror history runtime hooks are unavailable");
    const history = runtimeHistorySpec.fromJSON(value.codeMirror, state) as RuntimeHistoryState;
    if (!history || !Array.isArray(history.done) || !Array.isArray(history.undone)) {
        throw new Error("CodeMirror history runtime shape changed");
    }
    hydrateBranch(history.done, value.effects.done);
    hydrateBranch(history.undone, value.effects.undone);
    history.prevTime = value.previous.time;
    history.prevUserEvent = value.previous.userEvent;
    return history;
}

export const persistentHistoryField = StateField.define<PersistedHistory | null>({
    create: () => null,
    // The parsed blob is only an initialization hand-off to historyField. Drop
    // it after the first transaction so removing/re-adding history (collab mode)
    // can never resurrect a stale pre-collaboration stack.
    update: () => null,
    toJSON(_value, state): PersistedHistory | null {
        if (!state.facet(persistHistoryFacet)) return null;
        const history = state.field(historyField, false) as RuntimeHistoryState | undefined;
        if (!history || !runtimeHistorySpec) return null;
        try {
            return {
                version: PERSISTED_HISTORY_VERSION,
                codeMirror: runtimeHistorySpec.toJSON(history, state),
                effects: {
                    done: serializeBranch(history.done),
                    undone: serializeBranch(history.undone),
                },
                previous: {
                    time: history.prevTime,
                    userEvent: history.prevUserEvent,
                },
            };
        } catch (error) {
            console.error("[persistentHistory] Could not serialize history safely", error);
            return null;
        }
    },
    fromJSON(value, state): PersistedHistory | null {
        if (!state.facet(persistHistoryFacet)) return null;
        try {
            return parsePersistedHistory(value);
        } catch (error) {
            console.warn("[persistentHistory] Ignoring invalid persisted history", error);
            return null;
        }
    },
});

function initializeHistory(state: EditorState): unknown {
    if (!runtimeHistorySpec) throw new Error("CodeMirror history runtime hooks are unavailable");
    if (!state.facet(persistHistoryFacet)) return runtimeHistorySpec.create(state);
    const persisted = state.field(persistentHistoryField, false);
    if (persisted) {
        try {
            return hydrateHistory(persisted, state);
        } catch (error) {
            console.warn("[persistentHistory] Starting with fresh history", error);
        }
    }
    return runtimeHistorySpec.create(state);
}

/** Companion field stays installed when collaboration temporarily removes CM history. */
export const persistentHistoryStateExtension: Extension = persistentHistoryField;

/** Must live beside history() so removing the history compartment removes both. */
export const persistentHistoryRuntimeExtension: Extension = runtimeHistorySpec
    ? historyField.init(initializeHistory)
    : [];

/** Convenient complete stack for standalone states and tests. */
export const persistentHistoryExtension: Extension = [
    persistentHistoryStateExtension,
    persistentHistoryRuntimeExtension,
];
