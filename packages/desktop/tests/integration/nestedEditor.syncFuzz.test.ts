/**
 * nestedEditor.syncFuzz.test.ts — Stateful fuzzing for the live inline-editor
 * synchronization loop.
 *
 * Unlike EditorHarness.nestedEdit(), this mounts a real NestedEditorController
 * and therefore exercises the complete nested → parent → reactive-sync cycle.
 * Every operation checks the central three-replica invariant:
 *
 *   nested editor doc === parent revision slice === active version doc
 *
 * Replay/stress controls:
 *   NESTED_EDITOR_SYNC_FUZZ_RUNS=1000
 *   NESTED_EDITOR_SYNC_FUZZ_MAX_OPERATIONS=200
 *   NESTED_EDITOR_SYNC_FUZZ_SEED=12345
 *   NESTED_EDITOR_SYNC_FUZZ_PATH="0:1:2"
 */

import { annotations as annotationExtensions } from "$lib/editor/plugins/annotations";
import { NestedEditorController } from "$lib/editor/plugins/annotations/NestedEditorController";
import {
    addAnnotation,
    annotationField,
    createNewRevision,
    deleteRevisionVersion,
    setActiveRevisionVersion,
} from "$lib/editor/plugins/annotations/annotationField";
import {
    type Annotation,
    activeVersion,
    activeVersionIndex,
    createNewAnnotation,
    isAnnotationOfType,
    makeVersion,
    versionText,
} from "$lib/editor/plugins/annotations/models";
import { redo, undo } from "@codemirror/commands";
import { EditorSelection, EditorState, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

type Operation =
    | { type: "nestedInsert"; position: number; text: string }
    | { type: "nestedDelete"; from: number; length: number }
    | { type: "nestedReplace"; from: number; length: number; text: string }
    | { type: "parentInsert"; position: number; text: string }
    | { type: "parentDelete"; from: number; length: number }
    | { type: "syncCurrent" }
    | { type: "syncStale"; snapshot: number }
    | { type: "undo" }
    | { type: "redo" }
    | { type: "addVersion" }
    | { type: "switchVersion"; version: number }
    | { type: "deleteVersion"; version: number }
    | { type: "remount" };

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

const NUM_RUNS = envInteger("NESTED_EDITOR_SYNC_FUZZ_RUNS", 200, 1);
const MAX_OPERATIONS = envInteger("NESTED_EDITOR_SYNC_FUZZ_MAX_OPERATIONS", 60, 1);
const REPLAY_SEED = process.env.NESTED_EDITOR_SYNC_FUZZ_SEED
    ? envInteger("NESTED_EDITOR_SYNC_FUZZ_SEED", 0, Number.MIN_SAFE_INTEGER)
    : undefined;
const REPLAY_PATH = process.env.NESTED_EDITOR_SYNC_FUZZ_PATH || undefined;
const FUZZ_TIMEOUT_MS = NUM_RUNS > 500 || MAX_OPERATIONS > 100 ? 10 * 60 * 1_000 : 30_000;

const arbText = fc
    .array(fc.constantFrom("a", "b", "c", " ", "\n"), { minLength: 1, maxLength: 5 })
    .map((characters) => characters.join(""));
const arbInitialDocument = fc
    .array(fc.constantFrom("a", "b", "c", " ", "\n"), { minLength: 1, maxLength: 16 })
    .map((characters) => characters.join(""));
const arbPosition = fc.nat({ max: 100 });

const arbOperation: fc.Arbitrary<Operation> = fc.oneof(
    {
        weight: 5,
        arbitrary: fc.record({
            type: fc.constant("nestedInsert" as const),
            position: arbPosition,
            text: arbText,
        }),
    },
    {
        weight: 4,
        arbitrary: fc.record({
            type: fc.constant("nestedDelete" as const),
            from: arbPosition,
            length: arbPosition,
        }),
    },
    {
        weight: 3,
        arbitrary: fc.record({
            type: fc.constant("nestedReplace" as const),
            from: arbPosition,
            length: arbPosition,
            text: arbText,
        }),
    },
    {
        weight: 3,
        arbitrary: fc.record({
            type: fc.constant("parentInsert" as const),
            position: arbPosition,
            text: arbText,
        }),
    },
    {
        weight: 2,
        arbitrary: fc.record({
            type: fc.constant("parentDelete" as const),
            from: arbPosition,
            length: arbPosition,
        }),
    },
    { weight: 2, arbitrary: fc.constant({ type: "syncCurrent" as const }) },
    {
        weight: 4,
        arbitrary: fc.record({
            type: fc.constant("syncStale" as const),
            snapshot: arbPosition,
        }),
    },
    { weight: 4, arbitrary: fc.constant({ type: "undo" as const }) },
    { weight: 2, arbitrary: fc.constant({ type: "redo" as const }) },
    { weight: 2, arbitrary: fc.constant({ type: "addVersion" as const }) },
    {
        weight: 2,
        arbitrary: fc.record({
            type: fc.constant("switchVersion" as const),
            version: arbPosition,
        }),
    },
    {
        weight: 1,
        arbitrary: fc.record({
            type: fc.constant("deleteVersion" as const),
            version: arbPosition,
        }),
    },
    { weight: 2, arbitrary: fc.constant({ type: "remount" as const }) },
);

class LiveNestedEditorHarness {
    readonly parentHost = document.createElement("div");
    readonly nestedHost = document.createElement("div");
    readonly parentView: EditorView;
    readonly revisionId: number;
    readonly controller: NestedEditorController;
    readonly observedDocs: string[] = [];

    constructor(initialDocument: string) {
        document.body.append(this.parentHost, this.nestedHost);
        this.parentView = new EditorView({
            parent: this.parentHost,
            state: EditorState.create({
                doc: `^${initialDocument}$`,
                extensions: [annotationExtensions()],
            }),
        });

        const version = makeVersion({ doc: initialDocument });
        const revision = {
            ...createNewAnnotation(
                this.parentView.state.field(annotationField),
                EditorSelection.single(1, initialDocument.length + 1),
                "revision",
            ),
            activeVersionId: version.id,
            versions: [version],
        };
        this.revisionId = revision.id;
        this.parentView.dispatch({
            effects: addAnnotation.of(revision),
            annotations: Transaction.addToHistory.of(false),
        });

        this.controller = new NestedEditorController(
            this.parentView,
            this.revisionId,
            {},
            "flush-on-destroy",
        );
        this.mount();
        this.rememberCurrentDoc();
    }

    get revision(): Annotation<"revision"> {
        const annotation = this.parentView.state.field(annotationField)[this.revisionId];
        if (!annotation || !isAnnotationOfType(annotation, "revision")) {
            throw new Error(`Revision ${this.revisionId} disappeared`);
        }
        return annotation;
    }

    get editor(): EditorView {
        const editor = this.controller.editor;
        if (!editor) throw new Error("Nested editor is not mounted");
        return editor;
    }

    run(operation: Operation): void {
        switch (operation.type) {
            case "nestedInsert": {
                const position = operation.position % (this.editor.state.doc.length + 1);
                this.editor.dispatch({ changes: { from: position, insert: operation.text } });
                break;
            }
            case "nestedDelete": {
                const range = this.range(operation.from, operation.length);
                if (range) this.editor.dispatch({ changes: range });
                break;
            }
            case "nestedReplace": {
                const range = this.range(operation.from, operation.length);
                if (range) {
                    this.editor.dispatch({ changes: { ...range, insert: operation.text } });
                }
                break;
            }
            case "parentInsert": {
                const revision = this.revision;
                const length = revision.selection.main.to - revision.selection.main.from;
                if (length === 0) break;
                const relativePosition = operation.position % length;
                this.parentView.dispatch({
                    changes: {
                        from: revision.selection.main.from + relativePosition,
                        insert: operation.text,
                    },
                });
                this.reconcile();
                break;
            }
            case "parentDelete": {
                const revision = this.revision;
                const length = revision.selection.main.to - revision.selection.main.from;
                // A non-nested deletion that collapses the entire revision is
                // resolved asynchronously by collapsedRevisionResolver. That
                // separate state machine is fuzzed elsewhere; retain at least
                // one character here so this suite stays about live sync.
                if (length <= 1) break;
                const from = operation.from % (length - 1);
                const deleteLength = 1 + (operation.length % (length - from - 1));
                this.parentView.dispatch({
                    changes: {
                        from: revision.selection.main.from + from,
                        to: revision.selection.main.from + from + deleteLength,
                    },
                });
                this.reconcile();
                break;
            }
            case "syncCurrent":
                this.controller.syncFromParent(versionText(activeVersion(this.revision)));
                break;
            case "syncStale": {
                const snapshot = this.observedDocs[operation.snapshot % this.observedDocs.length];
                this.controller.syncFromParent(snapshot);
                break;
            }
            case "undo":
                undo(this.parentView);
                this.reconcile();
                break;
            case "redo":
                redo(this.parentView);
                this.reconcile();
                break;
            case "addVersion":
                this.controller.flushCurrentStateToParent(false);
                this.parentView.dispatch(createNewRevision(this.parentView.state, this.revisionId));
                this.reconcile();
                break;
            case "switchVersion": {
                const revision = this.revision;
                const version = revision.versions[operation.version % revision.versions.length];
                this.controller.flushCurrentStateToParent(false);
                this.parentView.dispatch(
                    setActiveRevisionVersion(this.parentView.state, this.revisionId, version.id),
                );
                this.reconcile();
                break;
            }
            case "deleteVersion": {
                const revision = this.revision;
                if (revision.versions.length <= 1) break;
                const version = revision.versions[operation.version % revision.versions.length];
                this.controller.flushCurrentStateToParent(false);
                this.parentView.dispatch(
                    deleteRevisionVersion(this.parentView.state, this.revisionId, version.id),
                );
                this.reconcile();
                break;
            }
            case "remount":
                this.controller.destroy();
                this.mount();
                break;
        }

        this.rememberCurrentDoc();
    }

    assertInvariants(label: string): void {
        const revision = this.revision;
        const range = revision.selection.main;
        const parentSlice = this.parentView.state.doc.sliceString(range.from, range.to);
        const activeDoc = versionText(activeVersion(revision));
        const nestedDoc = this.editor.state.doc.toString();

        expect(range.from, `${label}: revision start`).toBeGreaterThanOrEqual(0);
        expect(range.to, `${label}: revision end`).toBeLessThanOrEqual(
            this.parentView.state.doc.length,
        );
        expect(range.from, `${label}: revision range`).toBeLessThanOrEqual(range.to);
        expect(
            activeVersionIndex(revision),
            `${label}: active version index`,
        ).toBeGreaterThanOrEqual(0);
        expect(
            activeVersionIndex(revision),
            `${label}: active version index upper bound`,
        ).toBeLessThan(revision.versions.length);
        expect(activeDoc, `${label}: active version vs parent slice`).toBe(parentSlice);
        expect(nestedDoc, `${label}: nested editor vs active version`).toBe(activeDoc);
        expect(
            this.controller.needsVersionSwitch(revision.activeVersionId),
            `${label}: mounted version`,
        ).toBe(false);
    }

    destroy(): void {
        this.controller.destroy({ skipFlush: true });
        this.parentView.destroy();
        this.nestedHost.remove();
        this.parentHost.remove();
    }

    private range(fromSeed: number, lengthSeed: number): { from: number; to: number } | undefined {
        const length = this.editor.state.doc.length;
        if (length === 0) return undefined;
        const from = fromSeed % length;
        const deleteLength = 1 + (lengthSeed % (length - from));
        return { from, to: from + deleteLength };
    }

    private mount(): void {
        const revision = this.revision;
        this.controller.create(
            this.nestedHost,
            activeVersion(revision),
            activeVersionIndex(revision),
        );
    }

    private reconcile(): void {
        const revision = this.revision;
        if (this.controller.needsVersionSwitch(revision.activeVersionId)) {
            this.controller.destroy({ skipFlush: true });
            this.mount();
            return;
        }
        this.controller.syncFromParent(versionText(activeVersion(revision)));
    }

    private rememberCurrentDoc(): void {
        const doc = versionText(activeVersion(this.revision));
        if (this.observedDocs.at(-1) !== doc) this.observedDocs.push(doc);
    }
}

describe("live nested editor synchronization state machine", () => {
    it(
        `keeps all replicas converged (${NUM_RUNS} runs, up to ${MAX_OPERATIONS} operations)`,
        { timeout: FUZZ_TIMEOUT_MS },
        () => {
            fc.assert(
                fc.property(
                    arbInitialDocument,
                    fc.array(arbOperation, { minLength: 1, maxLength: MAX_OPERATIONS }),
                    (initialDocument, operations) => {
                        const harness = new LiveNestedEditorHarness(initialDocument);
                        try {
                            harness.assertInvariants("initial");
                            for (let index = 0; index < operations.length; index++) {
                                harness.run(operations[index]);
                                harness.assertInvariants(
                                    `step ${index} (${operations[index].type})`,
                                );
                            }
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
});
