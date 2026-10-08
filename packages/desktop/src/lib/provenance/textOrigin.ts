import type {
    ChangeSpec,
    EventPayload,
    Provenance,
    TransactionReplayAnnotations,
} from "$lib/db/events";
import type { EventRecord } from "$lib/db/types";
/** textOrigin.ts — Reconstruct surviving wording from recorded edits, never a detector.
 * Snapshot text and unrecorded sources start unknown. Exact transaction traces
 * preserve acceptance boundaries and undo groups; legacy undo stays unknown.
 */
import { ChangeSet } from "@codemirror/state";
import { classifyOrigin } from "./classify";

export type TextOrigin = "human" | "ai" | "edited-ai" | "unknown";
export type OriginSpan = { from: number; to: number; origin: TextOrigin };
export type TextOriginState = { text: string; spans: OriginSpan[] };

function initial(text: string): TextOriginState {
    return { text, spans: text.length ? [{ from: 0, to: text.length, origin: "unknown" }] : [] };
}

function originOf(provenance?: Provenance): TextOrigin {
    if (provenance?.userEvent === "input.drop") return "unknown";
    switch (provenance?.origin) {
        case "ai-revision":
            return "ai";
        case "mixed-revision":
            return "edited-ai";
        case "type":
        case "human-revision":
            return "human";
        default:
            return "unknown";
    }
}

function apply(
    state: TextOriginState,
    changes: ChangeSpec[],
    origin: TextOrigin,
    authoredReplacement = true,
): TextOriginState {
    const spans: OriginSpan[] = [];
    const parts: string[] = [];
    let cursor = 0;
    let length = 0;
    function append(text: string, kind: TextOrigin): void {
        if (!text.length) return;
        const last = spans.at(-1);
        if (last?.origin === kind) last.to += text.length;
        else spans.push({ from: length, to: length + text.length, origin: kind });
        parts.push(text);
        length += text.length;
    }
    function retain(from: number, to: number): void {
        for (const span of state.spans) {
            const start = Math.max(from, span.from);
            const end = Math.min(to, span.to);
            if (end > start) append(state.text.slice(start, end), span.origin);
        }
    }
    for (const change of changes) {
        if (
            !Number.isInteger(change.from) ||
            !Number.isInteger(change.to) ||
            change.from < cursor ||
            change.to < change.from ||
            change.to > state.text.length ||
            typeof change.insert !== "string"
        )
            throw new Error("Invalid origin change range");
        retain(cursor, change.from);
        const replacesAi = state.spans.some(
            (span) =>
                span.from < change.to &&
                span.to > change.from &&
                (span.origin === "ai" || span.origin === "edited-ai"),
        );
        append(
            change.insert,
            origin === "human" && authoredReplacement && replacesAi ? "edited-ai" : origin,
        );
        cursor = change.to;
    }
    retain(cursor, state.text.length);
    return { text: parts.join(""), spans };
}

function traceOrigin(annotations: TransactionReplayAnnotations): TextOrigin {
    if (
        annotations.userEvent === "input.paste" ||
        annotations.userEvent === "input.restore" ||
        annotations.userEvent === "input.drop"
    )
        return "unknown";
    // Older nested acceptance events omitted their source AI annotations.
    // Without a typing signal or source metadata, the nested marker alone
    // cannot establish who authored the inserted wording.
    if (
        annotations.nestedEditorEdit !== undefined &&
        !annotations.revisionInternalEdit &&
        !annotations.userEvent &&
        !annotations.aiGenerations?.length
    )
        return "unknown";
    // Typing inside an AI version authors only the inserted text, not the whole version.
    if (
        !annotations.revisionInternalEdit &&
        !annotations.aiGenerations?.length &&
        annotations.userEvent?.startsWith("input.type")
    )
        return "human";
    if (
        annotations.aiGenerations?.length &&
        annotations.revisionProvenance === "mixed" &&
        annotations.nestedEditorEdit !== undefined
    )
        return "unknown";
    return originOf({
        origin: classifyOrigin({
            userEvent: annotations.userEvent,
            hasRevisionInternalEdit: annotations.revisionInternalEdit === true,
            hasNestedEditorEdit: annotations.nestedEditorEdit !== undefined,
            hasAiEdit: !!annotations.aiGenerations?.length,
            revisionProvenance: annotations.revisionProvenance,
        }),
    });
}

/** Ordered, draft-scoped events. Baseline content has no recoverable wording lineage. */
export function buildTextOrigin(events: EventRecord[], baselineText = ""): TextOriginState {
    let state = initial(baselineText);
    type Group = { before: TextOriginState; after: TextOriginState };
    const done: Group[] = [];
    const undone: Group[] = [];
    for (const event of events) {
        const payload = JSON.parse(event.payload) as EventPayload;
        if (payload.transactionReplay) {
            for (const entry of payload.transactionReplay.transactions) {
                const transaction = entry.kind === "transaction" ? entry : entry.fallback;
                const set = ChangeSet.fromJSON(transaction.changeSet);
                if (set.length !== state.text.length)
                    throw new Error("Origin history does not match draft");
                const changes: ChangeSpec[] = [];
                set.iterChanges((from, to, _fromB, _toB, insert) =>
                    changes.push({ from, to, insert: insert.toString() }),
                );
                const before = state;
                const next = apply(
                    state,
                    changes,
                    entry.kind === "transaction" ? traceOrigin(transaction.annotations) : "unknown",
                    transaction.annotations.revisionInternalEdit !== true,
                );
                if (entry.kind === "undo" || entry.kind === "redo") {
                    const source = entry.kind === "undo" ? done : undone;
                    const target = entry.kind === "undo" ? undone : done;
                    const group = source.pop();
                    const expected = entry.kind === "undo" ? group?.before : group?.after;
                    const previous = entry.kind === "undo" ? group?.after : group?.before;
                    if (group && previous?.text === before.text && expected?.text === next.text) {
                        state = expected;
                        target.push(group);
                    } else {
                        state = next;
                        done.length = undone.length = 0;
                    }
                } else {
                    state = next;
                    const a = transaction.annotations;
                    if (a.historyRuntimeDisabled) done.length = undone.length = 0;
                    else if (a.addToHistory) {
                        undone.length = 0;
                        const last = done.at(-1);
                        if (
                            !last ||
                            a.startsNewHistoryGroup ||
                            a.isolateHistory === "before" ||
                            a.isolateHistory === "full"
                        ) {
                            done.push({ before, after: state });
                        } else last.after = state;
                    } else if (!set.empty) done.length = undone.length = 0;
                }
            }
        } else if (payload.stateFallback) {
            if (payload.stateFallback.doc !== state.text)
                state = initial(payload.stateFallback.doc);
            done.length = undone.length = 0;
        } else if (payload.type === "doc_change" || payload.type === "compound") {
            state = apply(
                state,
                payload.type === "doc_change" ? payload.changes : payload.docChanges,
                originOf(payload.provenance),
                payload.provenance?.origin !== "human-revision",
            );
            done.length = undone.length = 0;
        }
    }
    return state;
}
