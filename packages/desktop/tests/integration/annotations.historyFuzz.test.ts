/**
 * annotations.historyFuzz.test.ts — Stateful annotation-history fuzzing.
 *
 * This test treats the document plus annotation/group fields as the semantic
 * value stored at each undo/redo boundary. Forward commands build the model's
 * history stacks; undo and redo must then reproduce that complete prior value,
 * including annotation ranges, revision versions, and version groups. Editor
 * cursor selection is intentionally excluded because CodeMirror does not
 * guarantee that command-provided cursor moves replay on redo. Restart commands
 * cover both direct saved-field round trips and reconstruction from a prior
 * snapshot plus the exact serialized event tail accumulated by EditorHarness.
 *
 * Replay/stress controls:
 *   ANNOTATION_HISTORY_FUZZ_RUNS=1000
 *   ANNOTATION_HISTORY_FUZZ_MAX_COMMANDS=200
 *   ANNOTATION_HISTORY_FUZZ_SEED=12345
 *   ANNOTATION_HISTORY_FUZZ_PATH="0:1:2"
 */

import {
    addAnnotation,
    annotationField,
    branchSuggestion,
    makeVersionFromSelection,
    removeAnnotation,
    updateRevisionVersionLabel,
    updateRevisionVersionState,
    updateThread,
} from "$lib/editor/plugins/annotations/annotationField";
import {
    type GenericAnnotation,
    type RawAnnotation,
    type RawAnnotations,
    RawAnnotationsSchema,
    type VersionGroupMember,
    type VersionGroups,
    VersionGroupsSchema,
    type VersionState,
    activeVersion,
    createNewAnnotation,
    isAnnotationOfType,
    isRawAnnotationOfType,
    makeVersion,
    versionText,
} from "$lib/editor/plugins/annotations/models";
import { canCreateRevision, canCreateSuggestion } from "$lib/editor/plugins/annotations/utils";
import {
    addVersionToGroup,
    createVersionGroup,
    deleteVersionGroup,
    removeVersionFromGroup,
    renameVersionGroup,
    versionGroupField,
} from "$lib/editor/plugins/annotations/versionGroupField";
import { redo as codeMirrorRedo, undo as codeMirrorUndo } from "@codemirror/commands";
import { EditorSelection, Transaction, type TransactionSpec } from "@codemirror/state";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { EditorHarness, type EditorRestartMode } from "../helpers/EditorHarness";

type HistorySnapshot = {
    doc: string;
    annotationField: RawAnnotations;
    versionGroupField: VersionGroups;
};

type HistoryModel = {
    present: HistorySnapshot;
    undo: HistorySnapshot[];
    redo: HistorySnapshot[];
    persistHistory: boolean;
};

type InsertOperation = { type: "insert"; position: number; text: string };
type SelectionBoundaryOperation = {
    type: "selectionBoundary";
    from: number;
    length: number;
    returnToStart: boolean;
};
type NonHistoryPrefixOperation = { type: "nonHistoryPrefix"; text: string };
type DeleteOperation = { type: "delete"; from: number; length: number };
type ReplaceOperation = {
    type: "replace";
    from: number;
    length: number;
    text: string;
};
type AddAnnotationOperation = {
    type: "addComment" | "addSuggestion" | "addRevision";
    from: number;
    length: number;
    text: string;
    time: number;
};
type PickAnnotationOperation = {
    type: "removeAnnotation" | "appendThread";
    annotation: number;
    text: string;
    time: number;
};
type NestedEditOperation = {
    type: "nestedInsert" | "nestedDelete" | "nestedReplace";
    revision: number;
    from: number;
    length: number;
    text: string;
};
type VersionOperation = {
    type: "addVersion" | "switchVersion" | "deleteVersion";
    revision: number;
    version: number;
};
type UpdateVersionOperation = {
    type: "updateVersion" | "labelVersion";
    revision: number;
    version: number;
    text: string;
};
type SuggestionOperation = {
    type: "applySuggestion" | "branchSuggestion";
    suggestion: number;
    replacement: number;
};
type GroupOperation = {
    type: "createGroup" | "addGroupMember" | "removeGroupMember" | "renameGroup" | "deleteGroup";
    group: number;
    first: number;
    second: number;
    version: number;
    text: string;
};
type RestartOperation = { type: "restart"; mode: EditorRestartMode };
type HistoryOperation = { type: "undo" } | { type: "redo" } | RestartOperation;

type Operation =
    | InsertOperation
    | SelectionBoundaryOperation
    | NonHistoryPrefixOperation
    | DeleteOperation
    | ReplaceOperation
    | AddAnnotationOperation
    | PickAnnotationOperation
    | NestedEditOperation
    | VersionOperation
    | UpdateVersionOperation
    | SuggestionOperation
    | GroupOperation
    | HistoryOperation;

function envInteger(name: string, fallback: number, minimum = 0): number {
    const raw = process.env[name];
    if (raw === undefined || raw === "") return fallback;
    const parsed = Number(raw);
    if (!Number.isSafeInteger(parsed) || parsed < minimum) {
        throw new Error(
            `${name} must be an integer >= ${minimum}; received ${JSON.stringify(raw)}`,
        );
    }
    return parsed;
}

const NUM_RUNS = envInteger("ANNOTATION_HISTORY_FUZZ_RUNS", 150, 1);
const MAX_COMMANDS = envInteger("ANNOTATION_HISTORY_FUZZ_MAX_COMMANDS", 60, 1);
const REPLAY_SEED = process.env.ANNOTATION_HISTORY_FUZZ_SEED
    ? envInteger("ANNOTATION_HISTORY_FUZZ_SEED", 0, Number.MIN_SAFE_INTEGER)
    : undefined;
const REPLAY_PATH = process.env.ANNOTATION_HISTORY_FUZZ_PATH || undefined;
const FUZZ_TIMEOUT_MS = NUM_RUNS > 500 || MAX_COMMANDS > 100 ? 10 * 60 * 1_000 : 30_000;

function captureSnapshot(harness: EditorHarness): HistorySnapshot {
    const serialized = harness.view.state.toJSON({ annotationField, versionGroupField });
    return JSON.parse(
        JSON.stringify({
            doc: serialized.doc,
            annotationField: serialized.annotationField,
            versionGroupField: serialized.versionGroupField,
        }),
    ) as HistorySnapshot;
}

function snapshotKey(snapshot: HistorySnapshot): string {
    return JSON.stringify(snapshot);
}

function prefixSnapshot(snapshot: HistorySnapshot, text: string): HistorySnapshot {
    const shifted = JSON.parse(JSON.stringify(snapshot)) as HistorySnapshot;
    shifted.doc = text + shifted.doc;
    for (const annotation of Object.values(shifted.annotationField ?? {})) {
        for (const range of annotation.selection.ranges) {
            range.anchor += text.length;
            range.head += text.length;
        }
    }
    return shifted;
}

async function settleDeferredAnnotationWork(): Promise<void> {
    // collapsedRevisionResolver dispatches from a queueMicrotask. The second
    // checkpoint also lets any work scheduled by that cleanup finish.
    await Promise.resolve();
    await Promise.resolve();
}

function pick<T>(values: readonly T[], seed: number): T | undefined {
    if (values.length === 0) return undefined;
    return values[seed % values.length];
}

function resolvedRange(
    docLength: number,
    fromSeed: number,
    lengthSeed: number,
): [number, number] | null {
    if (docLength === 0) return null;
    const from = fromSeed % docLength;
    const length = 1 + (lengthSeed % (docLength - from));
    return [from, from + length];
}

function insertPosition(docLength: number, seed: number): number {
    return seed % (docLength + 1);
}

function rawAnnotations(snapshot: HistorySnapshot): RawAnnotation[] {
    return Object.values(snapshot.annotationField ?? {});
}

function rawAnnotationsOfType<T extends GenericAnnotation["_type"]>(
    snapshot: HistorySnapshot,
    type: T,
): Array<RawAnnotation & { _type: T }> {
    return rawAnnotations(snapshot).filter((annotation) =>
        isRawAnnotationOfType(annotation, type),
    ) as Array<RawAnnotation & { _type: T }>;
}

function rawMainRange(annotation: RawAnnotation): [number, number] {
    const mainIndex = annotation.selection.main ?? 0;
    const range = annotation.selection.ranges[mainIndex] ?? annotation.selection.ranges[0];
    return [Math.min(range.anchor, range.head), Math.max(range.anchor, range.head)];
}

function rangeOverlaps([from, to]: [number, number], annotation: RawAnnotation): boolean {
    return annotation.selection.ranges.some((range) => {
        const annotationFrom = Math.min(range.anchor, range.head);
        const annotationTo = Math.max(range.anchor, range.head);
        return from < annotationTo && to > annotationFrom;
    });
}

function rawRevision(snapshot: HistorySnapshot, seed: number) {
    return pick(rawAnnotationsOfType(snapshot, "revision"), seed);
}

function rawSuggestion(snapshot: HistorySnapshot, seed: number) {
    return pick(rawAnnotationsOfType(snapshot, "suggestion"), seed);
}

function rawGroup(snapshot: HistorySnapshot, seed: number) {
    return pick(Object.values(snapshot.versionGroupField ?? {}), seed);
}

function rawVersion(revision: ReturnType<typeof rawRevision>, seed: number) {
    return revision ? pick(revision.versions, seed) : undefined;
}

function hasNestedAnnotationState(revision: ReturnType<typeof rawRevision>): boolean {
    const active = revision?.versions.find((version) => version.id === revision.activeVersionId);
    return Boolean(active && (active as Record<string, unknown>).annotationField !== undefined);
}

function rawThreadTarget(snapshot: HistorySnapshot, seed: number) {
    return pick(
        rawAnnotations(snapshot).filter((annotation) => annotation.thread.length > 0),
        seed,
    );
}

function twoDistinctRawRevisions(snapshot: HistorySnapshot, firstSeed: number, secondSeed: number) {
    const revisions = rawAnnotationsOfType(snapshot, "revision");
    if (revisions.length < 2) return undefined;
    const firstIndex = firstSeed % revisions.length;
    const secondIndex = (firstIndex + 1 + (secondSeed % (revisions.length - 1))) % revisions.length;
    return [revisions[firstIndex], revisions[secondIndex]] as const;
}

function groupMemberCandidates(snapshot: HistorySnapshot, groupSeed: number) {
    const group = rawGroup(snapshot, groupSeed);
    if (!group) return [];
    const candidates: VersionGroupMember[] = [];
    for (const revision of rawAnnotationsOfType(snapshot, "revision")) {
        if (group.members.some((member) => member.revisionId === revision.id)) continue;
        for (const version of revision.versions) {
            if (version.id) {
                candidates.push({ revisionId: revision.id, versionId: version.id });
            }
        }
    }
    return candidates;
}

function removableGroupMembers(snapshot: HistorySnapshot) {
    return Object.values(snapshot.versionGroupField ?? {}).flatMap((group) =>
        group.members.map((member) => ({ groupId: group.id, member })),
    );
}

function branchableSuggestions(snapshot: HistorySnapshot) {
    const revisions = rawAnnotationsOfType(snapshot, "revision");
    return rawAnnotationsOfType(snapshot, "suggestion").filter((suggestion) => {
        const range = rawMainRange(suggestion);
        return !revisions.some((revision) => rangeOverlaps(range, revision));
    });
}

function canRunForward(operation: Exclude<Operation, HistoryOperation>, snapshot: HistorySnapshot) {
    switch (operation.type) {
        case "insert":
            return operation.text.length > 0;
        case "selectionBoundary":
            return snapshot.doc.length > 0;
        case "nonHistoryPrefix":
            return operation.text.length > 0;
        case "delete":
            return snapshot.doc.length > 0;
        case "replace": {
            const range = resolvedRange(snapshot.doc.length, operation.from, operation.length);
            return range !== null && snapshot.doc.slice(range[0], range[1]) !== operation.text;
        }
        case "addComment": {
            const range = resolvedRange(snapshot.doc.length, operation.from, operation.length);
            return (
                range !== null &&
                !rawAnnotationsOfType(snapshot, "revision").some((annotation) =>
                    rangeOverlaps(range, annotation),
                )
            );
        }
        case "addSuggestion": {
            const range = resolvedRange(snapshot.doc.length, operation.from, operation.length);
            return (
                range !== null &&
                !rawAnnotations(snapshot).some((annotation) => rangeOverlaps(range, annotation))
            );
        }
        case "addRevision": {
            const range = resolvedRange(snapshot.doc.length, operation.from, operation.length);
            return (
                range !== null &&
                !rawAnnotations(snapshot).some((annotation) => rangeOverlaps(range, annotation))
            );
        }
        case "removeAnnotation":
            return rawAnnotations(snapshot).length > 0;
        case "appendThread":
            return rawThreadTarget(snapshot, operation.annotation) !== undefined;
        case "nestedInsert":
            return (
                rawRevision(snapshot, operation.revision) !== undefined &&
                !hasNestedAnnotationState(rawRevision(snapshot, operation.revision)) &&
                operation.text.length > 0
            );
        case "nestedDelete": {
            const revision = rawRevision(snapshot, operation.revision);
            return (
                revision !== undefined &&
                !hasNestedAnnotationState(revision) &&
                rawMainRange(revision)[1] > rawMainRange(revision)[0]
            );
        }
        case "nestedReplace": {
            const revision = rawRevision(snapshot, operation.revision);
            if (!revision || hasNestedAnnotationState(revision)) return false;
            const [from, to] = rawMainRange(revision);
            if (from === to) return false;
            const relative = resolvedRange(to - from, operation.from, operation.length);
            return (
                relative !== null &&
                snapshot.doc.slice(from + relative[0], from + relative[1]) !== operation.text
            );
        }
        case "addVersion":
            return rawRevision(snapshot, operation.revision) !== undefined;
        case "switchVersion": {
            const revision = rawRevision(snapshot, operation.revision);
            return Boolean(
                revision?.versions.some((version) => version.id !== revision.activeVersionId),
            );
        }
        case "deleteVersion":
            return rawRevision(snapshot, operation.revision) !== undefined;
        case "updateVersion": {
            const revision = rawRevision(snapshot, operation.revision);
            const version = rawVersion(revision, operation.version);
            // Production callers serialize a live nested editor when a version
            // has sub-annotations, remapping those ranges with the doc change.
            // This raw state-update command has no nested editor model, so only
            // generate it for flat versions instead of manufacturing stale
            // nested ranges that the public UI cannot produce.
            const hasNestedAnnotations =
                version !== undefined &&
                (version as Record<string, unknown>).annotationField !== undefined;
            return version !== undefined && !hasNestedAnnotations && version.doc !== operation.text;
        }
        case "labelVersion": {
            const revision = rawRevision(snapshot, operation.revision);
            const version = rawVersion(revision, operation.version);
            return version !== undefined && version.label !== operation.text;
        }
        case "applySuggestion":
            return rawSuggestion(snapshot, operation.suggestion) !== undefined;
        case "branchSuggestion":
            return pick(branchableSuggestions(snapshot), operation.suggestion) !== undefined;
        case "createGroup":
            return (
                twoDistinctRawRevisions(snapshot, operation.first, operation.second) !== undefined
            );
        case "addGroupMember":
            return groupMemberCandidates(snapshot, operation.group).length > 0;
        case "removeGroupMember":
            return removableGroupMembers(snapshot).length > 0;
        case "renameGroup": {
            const group = rawGroup(snapshot, operation.group);
            return group !== undefined && group.label !== operation.text;
        }
        case "deleteGroup":
            return rawGroup(snapshot, operation.group) !== undefined;
    }
}

function runtimeAnnotationsOfType<T extends GenericAnnotation["_type"]>(
    harness: EditorHarness,
    type: T,
): Array<Extract<GenericAnnotation, { _type: T }>> {
    return Object.values(harness.annotations).filter((annotation) =>
        isAnnotationOfType(annotation, type),
    ) as Array<Extract<GenericAnnotation, { _type: T }>>;
}

function runtimeAnnotation(harness: EditorHarness, seed: number) {
    return pick(Object.values(harness.annotations), seed);
}

function runtimeRevision(harness: EditorHarness, seed: number) {
    return pick(runtimeAnnotationsOfType(harness, "revision"), seed);
}

function runtimeSuggestion(harness: EditorHarness, seed: number) {
    return pick(runtimeAnnotationsOfType(harness, "suggestion"), seed);
}

function dispatchHistorySpec(harness: EditorHarness, spec: TransactionSpec): void {
    harness.view.dispatch({
        ...spec,
        annotations: Transaction.addToHistory.of(true),
    });
}

function executeForward(
    operation: Exclude<Operation, HistoryOperation>,
    harness: EditorHarness,
): void {
    switch (operation.type) {
        case "insert":
            harness.insert(insertPosition(harness.doc.length, operation.position), operation.text);
            return;
        case "selectionBoundary": {
            const range = resolvedRange(harness.doc.length, operation.from, operation.length);
            if (!range) throw new Error("selection command lost its valid range");
            const original = harness.view.state.selection;
            harness.view.dispatch({
                selection: EditorSelection.single(range[0], range[1]),
                annotations: Transaction.userEvent.of("select"),
            });
            if (operation.returnToStart) {
                harness.view.dispatch({
                    selection: original,
                    annotations: Transaction.userEvent.of("select"),
                });
            }
            return;
        }
        case "nonHistoryPrefix":
            harness.view.dispatch({
                changes: { from: 0, insert: operation.text },
                annotations: Transaction.addToHistory.of(false),
            });
            return;
        case "delete": {
            const range = resolvedRange(harness.doc.length, operation.from, operation.length);
            if (!range) throw new Error("delete command lost its valid range");
            harness.delete(range[0], range[1]);
            return;
        }
        case "replace": {
            const range = resolvedRange(harness.doc.length, operation.from, operation.length);
            if (!range) throw new Error("replace command lost its valid range");
            harness.replace(range[0], range[1], operation.text);
            return;
        }
        case "addComment": {
            const range = resolvedRange(harness.doc.length, operation.from, operation.length);
            if (!range) throw new Error("comment command lost its valid range");
            const annotation = {
                ...createNewAnnotation(
                    harness.annotations,
                    EditorSelection.single(range[0], range[1]),
                    "comment",
                ),
                thread: [{ message: operation.text, author: "fuzz", time: operation.time }],
            };
            dispatchHistorySpec(harness, { effects: [addAnnotation.of(annotation)] });
            return;
        }
        case "addSuggestion": {
            const range = resolvedRange(harness.doc.length, operation.from, operation.length);
            if (!range) throw new Error("suggestion command lost its valid range");
            const selection = EditorSelection.single(range[0], range[1]);
            if (!canCreateSuggestion(harness.annotations, selection)) {
                throw new Error("suggestion command violated canCreateSuggestion");
            }
            const annotation = {
                ...createNewAnnotation(harness.annotations, selection, "suggestion"),
                replacements: [{ text: operation.text }],
                thread: [{ message: "suggest", author: "fuzz", time: operation.time }],
            };
            dispatchHistorySpec(harness, { effects: [addAnnotation.of(annotation)] });
            return;
        }
        case "addRevision": {
            const range = resolvedRange(harness.doc.length, operation.from, operation.length);
            if (!range) throw new Error("revision command lost its valid range");
            const selection = EditorSelection.single(range[0], range[1]);
            if (!canCreateRevision(harness.annotations, selection)) {
                throw new Error("revision command violated canCreateRevision");
            }
            const { version: original, containedAnnotations } = makeVersionFromSelection(
                harness.view.state,
                selection,
                { label: "Original" },
            );
            const alternate = makeVersion({ doc: operation.text, label: "Alternative" });
            const annotation = {
                ...createNewAnnotation(harness.annotations, selection, "revision"),
                activeVersionId: original.id,
                versions: [original, alternate],
                thread: [{ message: "revise", author: "fuzz", time: operation.time }],
            };
            dispatchHistorySpec(harness, {
                effects: [
                    ...containedAnnotations.map((contained) => removeAnnotation.of(contained)),
                    addAnnotation.of(annotation),
                ],
            });
            return;
        }
        case "removeAnnotation": {
            const annotation = runtimeAnnotation(harness, operation.annotation);
            if (!annotation) throw new Error("remove command lost its annotation");
            harness.removeAnnotation(annotation.id);
            return;
        }
        case "appendThread": {
            const annotation = pick(
                Object.values(harness.annotations).filter(
                    (candidate) => candidate.thread.length > 0,
                ),
                operation.annotation,
            );
            if (!annotation) throw new Error("thread command lost its annotation");
            dispatchHistorySpec(harness, {
                effects: [
                    updateThread.of({
                        annotationId: annotation.id,
                        newThread: [
                            ...annotation.thread,
                            { message: operation.text, author: "fuzz", time: operation.time },
                        ],
                    }),
                ],
            });
            return;
        }
        case "nestedInsert": {
            const revision = runtimeRevision(harness, operation.revision);
            if (!revision) throw new Error("nested insert lost its revision");
            const length = revision.selection.main.to - revision.selection.main.from;
            harness.nestedInsert(
                revision.id,
                insertPosition(length, operation.from),
                operation.text,
            );
            return;
        }
        case "nestedDelete":
        case "nestedReplace": {
            const revision = runtimeRevision(harness, operation.revision);
            if (!revision) throw new Error("nested range edit lost its revision");
            const length = revision.selection.main.to - revision.selection.main.from;
            const range = resolvedRange(length, operation.from, operation.length);
            if (!range) throw new Error("nested range edit lost its valid range");
            harness.nestedEdit(
                revision.id,
                range[0],
                range[1],
                operation.type === "nestedDelete" ? "" : operation.text,
            );
            return;
        }
        case "addVersion": {
            const revision = runtimeRevision(harness, operation.revision);
            if (!revision) throw new Error("add-version command lost its revision");
            harness.addNewVersion(revision.id);
            return;
        }
        case "switchVersion": {
            const revision = runtimeRevision(harness, operation.revision);
            if (!revision) throw new Error("switch command lost its revision");
            const candidates = revision.versions.filter(
                (version) => version.id !== revision.activeVersionId,
            );
            const target = pick(candidates, operation.version);
            if (!target) throw new Error("switch command lost its target version");
            harness.switchVersionById(revision.id, target.id);
            return;
        }
        case "deleteVersion": {
            const revision = runtimeRevision(harness, operation.revision);
            if (!revision) throw new Error("delete-version command lost its revision");
            const version = pick(revision.versions, operation.version);
            if (!version) throw new Error("delete-version command lost its target");
            harness.deleteVersion(revision.id, revision.versions.indexOf(version));
            return;
        }
        case "updateVersion": {
            const revision = runtimeRevision(harness, operation.revision);
            if (!revision) throw new Error("update-version command lost its revision");
            const version = pick(revision.versions, operation.version);
            if (!version) throw new Error("update-version command lost its target");
            const nextVersion = { ...version, id: version.id, doc: operation.text } as VersionState;
            harness.view.dispatch(
                updateRevisionVersionState(
                    harness.view.state,
                    revision.id,
                    version.id,
                    nextVersion,
                ),
            );
            return;
        }
        case "labelVersion": {
            const revision = runtimeRevision(harness, operation.revision);
            if (!revision) throw new Error("label command lost its revision");
            const version = pick(revision.versions, operation.version);
            if (!version) throw new Error("label command lost its target");
            harness.view.dispatch(
                updateRevisionVersionLabel(
                    harness.view.state,
                    revision.id,
                    version.id,
                    operation.text,
                ),
            );
            return;
        }
        case "applySuggestion": {
            const suggestion = runtimeSuggestion(harness, operation.suggestion);
            if (!suggestion) throw new Error("apply command lost its suggestion");
            harness.applySuggestion(
                suggestion.id,
                operation.replacement % suggestion.replacements.length,
            );
            return;
        }
        case "branchSuggestion": {
            const revisions = runtimeAnnotationsOfType(harness, "revision");
            const candidates = runtimeAnnotationsOfType(harness, "suggestion").filter(
                (suggestion) => {
                    const { from, to } = suggestion.selection.main;
                    return !revisions.some((revision) =>
                        revision.selection.ranges.some(
                            (range) => from < range.to && to > range.from,
                        ),
                    );
                },
            );
            const suggestion = pick(candidates, operation.suggestion);
            if (!suggestion) throw new Error("branch command lost its suggestion");
            harness.view.dispatch(branchSuggestion(harness.view.state, suggestion.id));
            return;
        }
        case "createGroup": {
            const revisions = runtimeAnnotationsOfType(harness, "revision");
            if (revisions.length < 2) throw new Error("create-group lost its revisions");
            const firstIndex = operation.first % revisions.length;
            const secondIndex =
                (firstIndex + 1 + (operation.second % (revisions.length - 1))) % revisions.length;
            const first = revisions[firstIndex];
            const second = revisions[secondIndex];
            const firstVersion = pick(first.versions, operation.version);
            const secondVersion = pick(second.versions, operation.version + operation.second);
            if (!firstVersion || !secondVersion) throw new Error("create-group lost its versions");
            const created = createVersionGroup(operation.text, [
                { revisionId: first.id, versionId: firstVersion.id },
                { revisionId: second.id, versionId: secondVersion.id },
            ]);
            dispatchHistorySpec(harness, created.spec);
            return;
        }
        case "addGroupMember": {
            const snapshot = captureSnapshot(harness);
            const group = rawGroup(snapshot, operation.group);
            const member = pick(groupMemberCandidates(snapshot, operation.group), operation.first);
            if (!group || !member) throw new Error("add-member command lost its target");
            dispatchHistorySpec(harness, addVersionToGroup(harness.view.state, group.id, member));
            return;
        }
        case "removeGroupMember": {
            const candidate = pick(
                removableGroupMembers(captureSnapshot(harness)),
                operation.first,
            );
            if (!candidate) throw new Error("remove-member command lost its target");
            dispatchHistorySpec(
                harness,
                removeVersionFromGroup(harness.view.state, candidate.member),
            );
            return;
        }
        case "renameGroup": {
            const group = rawGroup(captureSnapshot(harness), operation.group);
            if (!group) throw new Error("rename command lost its group");
            dispatchHistorySpec(
                harness,
                renameVersionGroup(harness.view.state, group.id, operation.text),
            );
            return;
        }
        case "deleteGroup": {
            const group = rawGroup(captureSnapshot(harness), operation.group);
            if (!group) throw new Error("delete-group command lost its group");
            dispatchHistorySpec(harness, deleteVersionGroup(harness.view.state, group.id));
            return;
        }
    }
}

function assertRawAnnotationTree(raw: unknown, doc: string, path: string): void {
    const annotations = RawAnnotationsSchema.parse(raw);
    for (const [key, annotation] of Object.entries(annotations)) {
        expect(String(annotation.id), `${path}.${key}: map key must equal annotation.id`).toBe(key);
        for (const range of annotation.selection.ranges) {
            expect(range.anchor, `${path}.${key}: anchor lower bound`).toBeGreaterThanOrEqual(0);
            expect(range.head, `${path}.${key}: head lower bound`).toBeGreaterThanOrEqual(0);
            expect(range.anchor, `${path}.${key}: anchor upper bound`).toBeLessThanOrEqual(
                doc.length,
            );
            expect(range.head, `${path}.${key}: head upper bound`).toBeLessThanOrEqual(doc.length);
        }
        if (!isRawAnnotationOfType(annotation, "revision")) continue;

        const versionIds = annotation.versions.map((version) => version.id);
        expect(versionIds.every((id) => typeof id === "string" && id.length > 0)).toBe(true);
        expect(new Set(versionIds).size, `${path}.${key}: unique version ids`).toBe(
            versionIds.length,
        );
        expect(typeof annotation.activeVersionId, `${path}.${key}: activeVersionId`).toBe("string");
        const active = annotation.versions.find(
            (version) => version.id === annotation.activeVersionId,
        );
        expect(active, `${path}.${key}: activeVersionId must resolve`).toBeDefined();
        const [from, to] = rawMainRange(annotation);
        expect(active?.doc, `${path}.${key}: active version must match parent slice`).toBe(
            doc.slice(from, to),
        );

        for (const [versionIndex, version] of annotation.versions.entries()) {
            const nested = (version as Record<string, unknown>).annotationField;
            if (nested !== undefined) {
                assertRawAnnotationTree(
                    nested,
                    version.doc,
                    `${path}.${key}.versions[${versionIndex}].annotationField`,
                );
            }
        }
    }
}

function assertInvariants(harness: EditorHarness, label: string): void {
    const snapshot = captureSnapshot(harness);
    RawAnnotationsSchema.parse(snapshot.annotationField);
    VersionGroupsSchema.parse(snapshot.versionGroupField);
    assertRawAnnotationTree(snapshot.annotationField, snapshot.doc, "annotationField");

    const revisions = runtimeAnnotationsOfType(harness, "revision");
    for (const [key, annotation] of Object.entries(harness.annotations)) {
        expect(String(annotation.id), `${label}: annotation map key`).toBe(key);
        for (const range of annotation.selection.ranges) {
            expect(range.from, `${label}: annotation ${annotation.id} from`).toBeGreaterThanOrEqual(
                0,
            );
            expect(range.to, `${label}: annotation ${annotation.id} to`).toBeLessThanOrEqual(
                harness.doc.length,
            );
            expect(range.from, `${label}: annotation ${annotation.id} ordered`).toBeLessThanOrEqual(
                range.to,
            );
        }
        if (isAnnotationOfType(annotation, "revision")) {
            expect(annotation.versions.length, `${label}: revision has versions`).toBeGreaterThan(
                0,
            );
            const ids = annotation.versions.map((version) => version.id);
            expect(ids.every((id) => typeof id === "string" && id.length > 0)).toBe(true);
            expect(new Set(ids).size, `${label}: revision ${annotation.id} unique ids`).toBe(
                ids.length,
            );
            const active = annotation.versions.find(
                (version) => version.id === annotation.activeVersionId,
            );
            expect(
                active,
                `${label}: revision ${annotation.id} activeVersionId exists`,
            ).toBeDefined();
            expect(
                active ? versionText(active) : undefined,
                `${label}: revision ${annotation.id} active doc matches slice`,
            ).toBe(
                harness.view.state.sliceDoc(
                    annotation.selection.main.from,
                    annotation.selection.main.to,
                ),
            );
            expect(activeVersion(annotation).id).toBe(annotation.activeVersionId);
        }
        if (isAnnotationOfType(annotation, "suggestion")) {
            expect(
                annotation.replacements.length,
                `${label}: suggestion replacements`,
            ).toBeGreaterThan(0);
        }
    }

    for (let i = 0; i < revisions.length; i++) {
        for (let j = i + 1; j < revisions.length; j++) {
            const a = revisions[i].selection.main;
            const b = revisions[j].selection.main;
            expect(a.from < b.to && a.to > b.from, `${label}: revisions must not overlap`).toBe(
                false,
            );
        }
    }

    const membership = new Set<string>();
    for (const [key, group] of Object.entries(harness.view.state.field(versionGroupField))) {
        expect(group.id, `${label}: group map key`).toBe(key);
        expect(group.members.length, `${label}: non-degenerate group`).toBeGreaterThanOrEqual(2);
        const revisionIds = new Set<number>();
        for (const member of group.members) {
            expect(revisionIds.has(member.revisionId), `${label}: one member per revision`).toBe(
                false,
            );
            revisionIds.add(member.revisionId);
            const revision = harness.annotations[member.revisionId];
            expect(
                revision && isAnnotationOfType(revision, "revision"),
                `${label}: group member revision exists`,
            ).toBe(true);
            if (!revision || !isAnnotationOfType(revision, "revision")) continue;
            expect(
                revision.versions.some((version) => version.id === member.versionId),
                `${label}: group member version exists`,
            ).toBe(true);
            const memberKey = `${member.revisionId}:${member.versionId}`;
            expect(membership.has(memberKey), `${label}: exclusive group membership`).toBe(false);
            membership.add(memberKey);
        }
    }
}

async function runForwardCommand(
    model: HistoryModel,
    harness: EditorHarness,
    operation: Exclude<Operation, HistoryOperation>,
): Promise<void> {
    const before = captureSnapshot(harness);
    expect(before, `${operation.type}: model and editor diverged before command`).toEqual(
        model.present,
    );
    expect(harness.undoDepth).toBe(model.undo.length);
    expect(harness.redoDepth).toBe(model.redo.length);

    if (operation.type === "nonHistoryPrefix") {
        const undoDepthBefore = harness.undoDepth;
        const redoDepthBefore = harness.redoDepth;
        executeForward(operation, harness);
        await settleDeferredAnnotationWork();

        model.present = prefixSnapshot(model.present, operation.text);
        model.undo = model.undo.map((snapshot) => prefixSnapshot(snapshot, operation.text));
        model.redo = model.redo.map((snapshot) => prefixSnapshot(snapshot, operation.text));

        assertInvariants(harness, operation.type);
        expect(
            captureSnapshot(harness),
            "non-history prefix must rebase the current and stored history snapshots",
        ).toEqual(model.present);
        expect(harness.undoDepth).toBe(undoDepthBefore);
        expect(harness.redoDepth).toBe(redoDepthBefore);
        return;
    }

    const undoDepthBefore = harness.undoDepth;
    const redoDepthBefore = harness.redoDepth;
    const payloadCountBefore = harness.pendingEventPayloadCount;
    executeForward(operation, harness);
    await settleDeferredAnnotationWork();
    assertInvariants(harness, operation.type);

    if (operation.type === "selectionBoundary") {
        expect(
            harness.pendingEventPayloadCount,
            "selection-only commands must not append persistence events",
        ).toBe(payloadCountBefore);
    }

    const after = captureSnapshot(harness);
    if (snapshotKey(after) === snapshotKey(before)) {
        expect(harness.undoDepth, `${operation.type}: no-op changed undo depth`).toBe(
            undoDepthBefore,
        );
        expect(harness.redoDepth, `${operation.type}: no-op changed redo depth`).toBe(
            redoDepthBefore,
        );
        model.present = after;
        return;
    }

    const undoDelta = harness.undoDepth - undoDepthBefore;
    expect([0, 1], `${operation.type}: one transaction may add at most one history item`).toContain(
        undoDelta,
    );
    if (undoDelta === 0) {
        expect(
            model.undo.length,
            `${operation.type}: first mutation was not added to history`,
        ).toBeGreaterThan(0);
    } else {
        model.undo.push(before);
    }
    model.redo = [];
    model.present = after;
    expect(harness.undoDepth).toBe(model.undo.length);
    expect(harness.redoDepth).toBe(0);
}

async function runUndoCommand(model: HistoryModel, harness: EditorHarness): Promise<void> {
    const before = captureSnapshot(harness);
    expect(before, "undo: model and editor diverged before command").toEqual(model.present);
    const expected = model.undo.at(-1);
    if (!expected) throw new Error("undo command ran without a modeled history item");
    const isNetZeroGroup = snapshotKey(before) === snapshotKey(expected);
    const redoDepthBefore = harness.redoDepth;
    expect(codeMirrorUndo(harness.view), "CodeMirror refused a modeled undo").toBe(true);
    await settleDeferredAnnotationWork();

    model.undo.pop();
    // Adjacent transactions may join into a history group whose net state is
    // identical to its starting snapshot (for example insert, then delete the
    // inserted text). CodeMirror may consume that empty group without creating
    // a redo item. Effect-bearing groups can still produce redo when their
    // observable snapshot is net-zero, so use its reported depth for this
    // otherwise invisible detail.
    const redoDelta = harness.redoDepth - redoDepthBefore;
    expect([0, 1], "undo may add at most one redo item").toContain(redoDelta);
    if (!isNetZeroGroup) expect(redoDelta, "a state-changing undo must be redoable").toBe(1);
    if (redoDelta === 1) model.redo.push(before);
    model.present = expected;
    assertInvariants(harness, "undo");
    expect(captureSnapshot(harness), "undo must restore the exact previous snapshot").toEqual(
        expected,
    );
    expect(harness.undoDepth).toBe(model.undo.length);
    expect(harness.redoDepth).toBe(model.redo.length);
}

async function runRedoCommand(model: HistoryModel, harness: EditorHarness): Promise<void> {
    const before = captureSnapshot(harness);
    expect(before, "redo: model and editor diverged before command").toEqual(model.present);
    const expected = model.redo.at(-1);
    if (!expected) throw new Error("redo command ran without a modeled history item");
    expect(codeMirrorRedo(harness.view), "CodeMirror refused a modeled redo").toBe(true);
    await settleDeferredAnnotationWork();

    model.redo.pop();
    model.undo.push(before);
    model.present = expected;
    assertInvariants(harness, "redo");
    expect(captureSnapshot(harness), "redo must restore the exact next snapshot").toEqual(expected);
    expect(harness.undoDepth).toBe(model.undo.length);
    expect(harness.redoDepth).toBe(model.redo.length);
}

function runRestartCommand(
    model: HistoryModel,
    harness: EditorHarness,
    operation: RestartOperation,
): void {
    const before = captureSnapshot(harness);
    const selectionBefore = JSON.parse(
        JSON.stringify(harness.view.state.selection.toJSON()),
    ) as unknown;
    const label = `restart.${operation.mode}`;
    expect(before, `${label}: model and editor diverged before round-trip`).toEqual(model.present);
    harness.restart(operation.mode);
    expect(captureSnapshot(harness), `${label}: must preserve semantic editor state`).toEqual(
        model.present,
    );
    // Cursor-only traffic deliberately does not enter the event log. A direct
    // snapshot must preserve it exactly; an event tail may legitimately fall
    // back to the checkpoint selection when no semantic event followed it.
    if (operation.mode === "snapshot") {
        expect(
            harness.view.state.selection.toJSON(),
            `${label}: must preserve the exact current selection`,
        ).toEqual(selectionBefore);
    }
    if (!model.persistHistory) {
        model.undo = [];
        model.redo = [];
    }
    expect(harness.undoDepth).toBe(model.undo.length);
    expect(harness.redoDepth).toBe(model.redo.length);
    expect(harness.pendingEventPayloadCount).toBe(0);
    assertInvariants(harness, label);
}

class AnnotationHistoryCommand implements fc.AsyncCommand<HistoryModel, EditorHarness> {
    constructor(readonly operation: Operation) {}

    check(model: Readonly<HistoryModel>): boolean {
        if (this.operation.type === "undo") return model.undo.length > 0;
        if (this.operation.type === "redo") return model.redo.length > 0;
        if (this.operation.type === "restart") return true;
        return canRunForward(this.operation, model.present);
    }

    async run(model: HistoryModel, harness: EditorHarness): Promise<void> {
        if (this.operation.type === "undo") {
            await runUndoCommand(model, harness);
        } else if (this.operation.type === "redo") {
            await runRedoCommand(model, harness);
        } else if (this.operation.type === "restart") {
            runRestartCommand(model, harness, this.operation);
        } else {
            await runForwardCommand(model, harness, this.operation);
        }
    }

    toString(): string {
        return JSON.stringify(this.operation);
    }
}

const arbSmallText = fc
    .array(fc.constantFrom("a", "b", "c", " ", "\n"), { minLength: 1, maxLength: 5 })
    .map((characters) => characters.join(""));
const arbMaybeEmptyText = fc
    .array(fc.constantFrom("a", "b", "c", " ", "\n"), { maxLength: 5 })
    .map((characters) => characters.join(""));
const arbSeed = fc.nat({ max: 1_000 });

const arbOperation: fc.Arbitrary<Operation> = fc.oneof(
    {
        weight: 3,
        arbitrary: fc.record({
            type: fc.constant("insert" as const),
            position: arbSeed,
            text: arbSmallText,
        }),
    },
    {
        weight: 2,
        arbitrary: fc.record({
            type: fc.constant("selectionBoundary" as const),
            from: arbSeed,
            length: arbSeed,
            returnToStart: fc.boolean(),
        }),
    },
    {
        weight: 1,
        arbitrary: fc.record({
            type: fc.constant("nonHistoryPrefix" as const),
            text: arbSmallText,
        }),
    },
    {
        weight: 2,
        arbitrary: fc.record({
            type: fc.constant("delete" as const),
            from: arbSeed,
            length: arbSeed,
        }),
    },
    {
        weight: 2,
        arbitrary: fc.record({
            type: fc.constant("replace" as const),
            from: arbSeed,
            length: arbSeed,
            text: arbMaybeEmptyText,
        }),
    },
    ...(["addComment", "addSuggestion", "addRevision"] as const).map((type) => ({
        weight: type === "addRevision" ? 4 : 2,
        arbitrary: fc.record({
            type: fc.constant(type),
            from: arbSeed,
            length: arbSeed,
            text: arbMaybeEmptyText,
            time: arbSeed,
        }),
    })),
    ...(["removeAnnotation", "appendThread"] as const).map((type) => ({
        weight: 1,
        arbitrary: fc.record({
            type: fc.constant(type),
            annotation: arbSeed,
            text: arbSmallText,
            time: arbSeed,
        }),
    })),
    ...(["nestedInsert", "nestedDelete", "nestedReplace"] as const).map((type) => ({
        weight: type === "nestedInsert" ? 4 : 3,
        arbitrary: fc.record({
            type: fc.constant(type),
            revision: arbSeed,
            from: arbSeed,
            length: arbSeed,
            text: arbMaybeEmptyText,
        }),
    })),
    ...(["addVersion", "switchVersion", "deleteVersion"] as const).map((type) => ({
        weight: 3,
        arbitrary: fc.record({
            type: fc.constant(type),
            revision: arbSeed,
            version: arbSeed,
        }),
    })),
    ...(["updateVersion", "labelVersion"] as const).map((type) => ({
        weight: 2,
        arbitrary: fc.record({
            type: fc.constant(type),
            revision: arbSeed,
            version: arbSeed,
            text: arbMaybeEmptyText,
        }),
    })),
    ...(["applySuggestion", "branchSuggestion"] as const).map((type) => ({
        weight: 2,
        arbitrary: fc.record({
            type: fc.constant(type),
            suggestion: arbSeed,
            replacement: arbSeed,
        }),
    })),
    ...(
        [
            "createGroup",
            "addGroupMember",
            "removeGroupMember",
            "renameGroup",
            "deleteGroup",
        ] as const
    ).map((type) => ({
        weight: 1,
        arbitrary: fc.record({
            type: fc.constant(type),
            group: arbSeed,
            first: arbSeed,
            second: arbSeed,
            version: arbSeed,
            text: arbSmallText,
        }),
    })),
    { weight: 5, arbitrary: fc.constant({ type: "undo" as const }) },
    { weight: 3, arbitrary: fc.constant({ type: "redo" as const }) },
    {
        weight: 2,
        arbitrary: fc.record({
            type: fc.constant("restart" as const),
            mode: fc.constantFrom<EditorRestartMode>("snapshot", "eventTail"),
        }),
    },
);

const arbInitialDocument = fc
    .array(fc.constantFrom("a", "b", "c", " ", "\n"), { minLength: 1, maxLength: 16 })
    .map((characters) => characters.join(""));

describe("annotation history state machine", () => {
    it(
        `restores exact snapshots and event tails (${NUM_RUNS} runs, up to ${MAX_COMMANDS} commands)`,
        { timeout: FUZZ_TIMEOUT_MS },
        async () => {
            const commands = fc.commands<HistoryModel, EditorHarness, false>(
                [arbOperation.map((operation) => new AnnotationHistoryCommand(operation))],
                { maxCommands: MAX_COMMANDS },
            );

            await fc.assert(
                fc.asyncProperty(
                    arbInitialDocument,
                    fc.boolean(),
                    commands,
                    async (initialDocument, persistHistory, sequence) => {
                        const harness = EditorHarness.create(
                            initialDocument,
                            persistHistory,
                            250,
                            true,
                        );
                        try {
                            const initial = captureSnapshot(harness);
                            assertInvariants(harness, "initial");
                            await fc.asyncModelRun(
                                () => ({
                                    model: {
                                        present: initial,
                                        undo: [],
                                        redo: [],
                                        persistHistory,
                                    },
                                    real: harness,
                                }),
                                sequence,
                            );
                        } finally {
                            harness.destroy();
                        }
                    },
                ),
                {
                    numRuns: NUM_RUNS,
                    verbose: 2,
                    ...(REPLAY_SEED === undefined ? {} : { seed: REPLAY_SEED }),
                    ...(REPLAY_PATH === undefined ? {} : { path: REPLAY_PATH }),
                },
            );
        },
    );

    it(
        `round-trips arbitrary non-history edits (${NUM_RUNS} runs)`,
        { timeout: FUZZ_TIMEOUT_MS },
        async () => {
            await fc.assert(
                fc.asyncProperty(
                    arbInitialDocument,
                    fc.constantFrom("annotationReplace" as const, "activeVersionUpdate" as const),
                    fc.constantFrom("comment" as const, "suggestion" as const),
                    fc.constantFrom("insert" as const, "delete" as const, "replace" as const),
                    arbSeed,
                    arbSeed,
                    arbSeed,
                    arbSeed,
                    arbMaybeEmptyText,
                    arbSmallText,
                    async (
                        initialDocument,
                        scenario,
                        annotationType,
                        nonHistoryKind,
                        annotationFrom,
                        annotationLength,
                        historyFrom,
                        historyLength,
                        historyText,
                        nonHistoryText,
                    ) => {
                        const harness = EditorHarness.create(initialDocument, false, 250, true);
                        try {
                            const annotationRange = resolvedRange(
                                harness.doc.length,
                                annotationFrom,
                                annotationLength,
                            );
                            fc.pre(annotationRange !== null);

                            let nonHistoryTarget: [number, number];
                            if (scenario === "activeVersionUpdate") {
                                const revisionId = harness.addRevision(
                                    annotationRange[0],
                                    annotationRange[1],
                                );
                                const revision = harness.annotation(revisionId);
                                if (!isAnnotationOfType(revision, "revision")) {
                                    throw new Error("fuzz revision setup failed");
                                }
                                const currentVersion = activeVersion(revision);
                                fc.pre(versionText(currentVersion) !== historyText);
                                harness.view.dispatch(
                                    updateRevisionVersionState(
                                        harness.view.state,
                                        revisionId,
                                        currentVersion.id,
                                        { ...currentVersion, doc: historyText },
                                    ),
                                );
                                const updated = harness.annotation(revisionId);
                                if (!isAnnotationOfType(updated, "revision")) {
                                    throw new Error("fuzz revision update failed");
                                }
                                nonHistoryTarget = [
                                    updated.selection.main.from,
                                    updated.selection.main.to,
                                ];
                            } else {
                                if (annotationType === "comment") {
                                    harness.addComment(annotationRange[0], annotationRange[1]);
                                } else {
                                    harness.addSuggestion(annotationRange[0], annotationRange[1], [
                                        { text: historyText },
                                    ]);
                                }
                                const historyRange = resolvedRange(
                                    harness.doc.length,
                                    historyFrom,
                                    historyLength,
                                );
                                fc.pre(historyRange !== null);
                                fc.pre(
                                    harness.doc.slice(historyRange[0], historyRange[1]) !==
                                        historyText,
                                );
                                harness.replace(historyRange[0], historyRange[1], historyText);
                                nonHistoryTarget = [0, harness.doc.length];
                            }

                            const depthBeforeNonHistory = harness.undoDepth;
                            const targetLength = nonHistoryTarget[1] - nonHistoryTarget[0];
                            if (nonHistoryKind === "insert") {
                                const relative = historyFrom % (targetLength + 1);
                                harness.view.dispatch({
                                    changes: {
                                        from: nonHistoryTarget[0] + relative,
                                        insert: nonHistoryText,
                                    },
                                    annotations: Transaction.addToHistory.of(false),
                                });
                            } else {
                                const relativeRange = resolvedRange(
                                    targetLength,
                                    historyFrom,
                                    historyLength,
                                );
                                fc.pre(relativeRange !== null);
                                const from = nonHistoryTarget[0] + relativeRange[0];
                                const to = nonHistoryTarget[0] + relativeRange[1];
                                const insert = nonHistoryKind === "delete" ? "" : nonHistoryText;
                                fc.pre(harness.doc.slice(from, to) !== insert);
                                harness.view.dispatch({
                                    changes: { from, to, insert },
                                    annotations: Transaction.addToHistory.of(false),
                                });
                            }
                            await settleDeferredAnnotationWork();

                            expect(harness.undoDepth).toBe(depthBeforeNonHistory);
                            assertInvariants(harness, `nonHistory.${scenario}.${nonHistoryKind}`);
                            const beforeUndo = captureSnapshot(harness);

                            expect(codeMirrorUndo(harness.view)).toBe(true);
                            await settleDeferredAnnotationWork();
                            assertInvariants(
                                harness,
                                `nonHistory.${scenario}.${nonHistoryKind}.undo`,
                            );

                            expect(codeMirrorRedo(harness.view)).toBe(true);
                            await settleDeferredAnnotationWork();
                            assertInvariants(
                                harness,
                                `nonHistory.${scenario}.${nonHistoryKind}.redo`,
                            );
                            expect(captureSnapshot(harness)).toEqual(beforeUndo);
                        } finally {
                            harness.destroy();
                        }
                    },
                ),
                {
                    numRuns: NUM_RUNS,
                    verbose: 2,
                    ...(REPLAY_SEED === undefined ? {} : { seed: REPLAY_SEED }),
                },
            );
        },
    );
});
