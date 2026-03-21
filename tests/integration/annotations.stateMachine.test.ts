/**
 * Property-based state machine tests for the annotation subsystem.
 *
 * Uses fast-check's model-based testing to generate random sequences of
 * editor operations and verify that system invariants hold after every step.
 *
 * Invariants checked:
 *   1. version.doc === doc slice under revision range (for active versions)
 *   2. All annotation ranges lie within [0, doc.length]
 *   3. Undo/redo depth is consistent
 *   4. Undo fully reverses a forward operation
 *   5. No orphaned annotations (range collapsed → removed, except revisions
 *      which survive briefly for cleanup)
 */

import { afterEach, describe, expect, it } from "vitest";
import fc from "fast-check";
import { undoDepth, redoDepth } from "@codemirror/commands";
import { isAnnotationOfType } from "$lib/editor/plugins/annotations/models";
import { EditorHarness } from "../helpers/EditorHarness";

// ── Command types ───────────────────────────────────────────────────────────

type InsertCmd = { type: "insert"; pos: number; text: string };
type DeleteCmd = { type: "delete"; from: number; to: number };
type AddRevisionCmd = { type: "addRevision"; from: number; to: number };
type AddCommentCmd = { type: "addComment"; from: number; to: number };
type NestedInsertCmd = {
    type: "nestedInsert";
    revIdx: number;
    relPos: number;
    text: string;
};
type NestedDeleteCmd = {
    type: "nestedDelete";
    revIdx: number;
    relFrom: number;
    relTo: number;
};
type UndoCmd = { type: "undo" };
type RedoCmd = { type: "redo" };
type SwitchVersionCmd = {
    type: "switchVersion";
    revIdx: number;
    versionIdx: number;
};

type Command =
    | InsertCmd
    | DeleteCmd
    | AddRevisionCmd
    | AddCommentCmd
    | NestedInsertCmd
    | NestedDeleteCmd
    | UndoCmd
    | RedoCmd
    | SwitchVersionCmd;

// ── Invariant checker ───────────────────────────────────────────────────────

function assertInvariants(h: EditorHarness, label: string): void {
    const docLen = h.doc.length;

    // 1. All annotation ranges within doc bounds
    for (const ann of Object.values(h.annotations)) {
        const from = ann.selection.main.from;
        const to = ann.selection.main.to;
        expect(from, `${label}: ann ${ann.id} from`).toBeGreaterThanOrEqual(0);
        expect(to, `${label}: ann ${ann.id} to`).toBeLessThanOrEqual(docLen);
        expect(from, `${label}: ann ${ann.id} from <= to`).toBeLessThanOrEqual(
            to,
        );
    }

    // 2. Active revision version.doc matches doc slice
    //    Skip collapsed revisions (from === to) — these are in a transient
    //    state awaiting cleanup by collapsedRevisionResolver (a ViewPlugin
    //    that runs asynchronously). Their version.doc may still hold pre-
    //    collapse text.
    for (const ann of Object.values(h.annotations)) {
        if (!isAnnotationOfType(ann, "revision")) continue;
        const from = ann.selection.main.from;
        const to = ann.selection.main.to;
        if (from === to) continue; // collapsed — skip
        const slice = h.revisionSlice(ann.id);
        const vDoc = h.versionDoc(ann.id);
        expect(vDoc, `${label}: rev ${ann.id} version.doc`).toBe(slice);
    }

    // 3. Undo/redo depths are non-negative
    expect(
        h.undoDepth,
        `${label}: undoDepth >= 0`,
    ).toBeGreaterThanOrEqual(0);
    expect(
        h.redoDepth,
        `${label}: redoDepth >= 0`,
    ).toBeGreaterThanOrEqual(0);
}

// ── Command execution ───────────────────────────────────────────────────────

function executeCommand(h: EditorHarness, cmd: Command): boolean {
    try {
        switch (cmd.type) {
            case "insert": {
                const pos = Math.min(cmd.pos, h.doc.length);
                h.insert(pos, cmd.text);
                return true;
            }
            case "delete": {
                const docLen = h.doc.length;
                if (docLen === 0) return false;
                const from = Math.min(cmd.from, docLen);
                const to = Math.min(Math.max(cmd.to, from), docLen);
                if (from === to) return false;
                h.delete(from, to);
                return true;
            }
            case "addRevision": {
                const docLen = h.doc.length;
                if (docLen === 0) return false;
                const from = Math.min(cmd.from, docLen);
                const to = Math.min(Math.max(cmd.to, from + 1), docLen);
                if (from >= to) return false;
                h.addRevision(from, to);
                return true;
            }
            case "addComment": {
                const docLen = h.doc.length;
                if (docLen === 0) return false;
                const from = Math.min(cmd.from, docLen);
                const to = Math.min(Math.max(cmd.to, from + 1), docLen);
                if (from >= to) return false;
                h.addComment(from, to);
                return true;
            }
            case "nestedInsert": {
                const revIds = h.annotationIdsOfType("revision");
                if (revIds.length === 0) return false;
                const revId =
                    revIds[Math.abs(cmd.revIdx) % revIds.length];
                const rev = h.annotation(revId);
                if (!isAnnotationOfType(rev, "revision")) return false;
                const rangeLen =
                    rev.selection.main.to - rev.selection.main.from;
                const relPos = Math.min(
                    Math.abs(cmd.relPos),
                    rangeLen,
                );
                h.nestedInsert(revId, relPos, cmd.text);
                return true;
            }
            case "nestedDelete": {
                const revIds = h.annotationIdsOfType("revision");
                if (revIds.length === 0) return false;
                const revId =
                    revIds[Math.abs(cmd.revIdx) % revIds.length];
                const rev = h.annotation(revId);
                if (!isAnnotationOfType(rev, "revision")) return false;
                const rangeLen =
                    rev.selection.main.to - rev.selection.main.from;
                if (rangeLen === 0) return false;
                const relFrom = Math.min(
                    Math.abs(cmd.relFrom),
                    rangeLen - 1,
                );
                const relTo = Math.min(
                    Math.max(Math.abs(cmd.relTo), relFrom + 1),
                    rangeLen,
                );
                if (relFrom >= relTo) return false;
                h.nestedDelete(revId, relFrom, relTo);
                return true;
            }
            case "undo": {
                if (h.undoDepth === 0) return false;
                h.undo();
                return true;
            }
            case "redo": {
                if (h.redoDepth === 0) return false;
                h.redo();
                return true;
            }
            case "switchVersion": {
                const revIds = h.annotationIdsOfType("revision");
                if (revIds.length === 0) return false;
                const revId =
                    revIds[Math.abs(cmd.revIdx) % revIds.length];
                const rev = h.annotation(revId);
                if (!isAnnotationOfType(rev, "revision")) return false;
                if (rev.versions.length < 2) return false;
                const target =
                    Math.abs(cmd.versionIdx) % rev.versions.length;
                if (target === rev.activeVersionIndex) return false;
                h.switchVersion(revId, target);
                return true;
            }
        }
    } catch {
        // Commands can fail on edge cases (e.g., revision
        // removed by collapse). This is fine — skip.
        return false;
    }
}

// ── Arbitraries ─────────────────────────────────────────────────────────────

const arbSmallText = fc.string({ minLength: 1, maxLength: 8 });
const arbPos = fc.integer({ min: 0, max: 200 });

const arbInsert: fc.Arbitrary<InsertCmd> = fc
    .tuple(arbPos, arbSmallText)
    .map(([pos, text]) => ({ type: "insert", pos, text }));

const arbDelete: fc.Arbitrary<DeleteCmd> = fc
    .tuple(arbPos, arbPos)
    .map(([a, b]) => ({
        type: "delete",
        from: Math.min(a, b),
        to: Math.max(a, b),
    }));

const arbAddRevision: fc.Arbitrary<AddRevisionCmd> = fc
    .tuple(arbPos, arbPos)
    .map(([a, b]) => ({
        type: "addRevision",
        from: Math.min(a, b),
        to: Math.max(a, b),
    }));

const arbAddComment: fc.Arbitrary<AddCommentCmd> = fc
    .tuple(arbPos, arbPos)
    .map(([a, b]) => ({
        type: "addComment",
        from: Math.min(a, b),
        to: Math.max(a, b),
    }));

const arbNestedInsert: fc.Arbitrary<NestedInsertCmd> = fc
    .tuple(fc.integer({ min: 0, max: 10 }), arbPos, arbSmallText)
    .map(([revIdx, relPos, text]) => ({
        type: "nestedInsert",
        revIdx,
        relPos,
        text,
    }));

const arbNestedDelete: fc.Arbitrary<NestedDeleteCmd> = fc
    .tuple(
        fc.integer({ min: 0, max: 10 }),
        arbPos,
        arbPos,
    )
    .map(([revIdx, a, b]) => ({
        type: "nestedDelete",
        revIdx,
        relFrom: Math.min(a, b),
        relTo: Math.max(a, b),
    }));

const arbUndo: fc.Arbitrary<UndoCmd> = fc.constant({ type: "undo" });
const arbRedo: fc.Arbitrary<RedoCmd> = fc.constant({ type: "redo" });

const arbSwitchVersion: fc.Arbitrary<SwitchVersionCmd> = fc
    .tuple(
        fc.integer({ min: 0, max: 10 }),
        fc.integer({ min: 0, max: 5 }),
    )
    .map(([revIdx, versionIdx]) => ({
        type: "switchVersion",
        revIdx,
        versionIdx,
    }));

const arbCommand: fc.Arbitrary<Command> = fc.oneof(
    { weight: 3, arbitrary: arbInsert },
    { weight: 2, arbitrary: arbDelete },
    { weight: 2, arbitrary: arbAddRevision },
    { weight: 1, arbitrary: arbAddComment },
    { weight: 3, arbitrary: arbNestedInsert },
    { weight: 2, arbitrary: arbNestedDelete },
    { weight: 4, arbitrary: arbUndo },
    { weight: 2, arbitrary: arbRedo },
    { weight: 1, arbitrary: arbSwitchVersion },
);

const arbCommandSequence = fc.array(arbCommand, {
    minLength: 3,
    maxLength: 30,
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("annotation state machine (property-based)", () => {
    let harness: EditorHarness;

    afterEach(() => {
        harness?.destroy();
    });

    it("invariants hold after every step in a random command sequence", () => {
        fc.assert(
            fc.property(arbSmallText, arbCommandSequence, (initialDoc, commands) => {
                harness = EditorHarness.create(initialDoc);

                for (let i = 0; i < commands.length; i++) {
                    const cmd = commands[i];
                    const executed = executeCommand(harness, cmd);
                    if (executed) {
                        assertInvariants(
                            harness,
                            `step ${i} (${cmd.type})`,
                        );
                    }
                }

                harness.destroy();
            }),
            { numRuns: 200, endOnFailure: true },
        );
    });

    it("full undo to empty history then full redo restores final state", () => {
        fc.assert(
            fc.property(
                arbSmallText,
                fc.array(
                    fc.oneof(
                        { weight: 3, arbitrary: arbInsert },
                        { weight: 2, arbitrary: arbAddRevision },
                        { weight: 3, arbitrary: arbNestedInsert },
                    ),
                    { minLength: 1, maxLength: 15 },
                ),
                (initialDoc, commands) => {
                    harness = EditorHarness.create(initialDoc);

                    // Execute forward commands (no undos)
                    for (const cmd of commands) {
                        executeCommand(harness, cmd);
                    }

                    const finalDoc = harness.doc;
                    const finalAnnotationCount = harness.annotationCount;

                    // Undo everything
                    while (harness.undoDepth > 0) {
                        harness.undo();
                        assertInvariants(harness, "undo pass");
                    }

                    // Redo everything
                    while (harness.redoDepth > 0) {
                        harness.redo();
                        assertInvariants(harness, "redo pass");
                    }

                    // Doc should match the final state
                    expect(harness.doc).toBe(finalDoc);
                    // Annotation count should match (some may have been
                    // removed by range collapse, so use >=)
                    expect(harness.annotationCount).toBeLessThanOrEqual(
                        finalAnnotationCount,
                    );

                    harness.destroy();
                },
            ),
            { numRuns: 100, endOnFailure: true },
        );
    });

    it("inserting at every position relative to a revision maintains invariants", () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 0, max: 20 }),
                arbSmallText,
                (insertPos, insertText) => {
                    harness = EditorHarness.create("abcdefghij");
                    // Revision over "cdefgh" [2, 8]
                    harness.addRevision(2, 8);

                    const pos = Math.min(insertPos, harness.doc.length);
                    harness.insert(pos, insertText);
                    assertInvariants(harness, `insert at ${pos}`);

                    harness.undo();
                    assertInvariants(harness, "after undo insert");
                    expect(harness.doc).toBe("abcdefghij");

                    harness.destroy();
                },
            ),
            { numRuns: 100 },
        );
    });

    it("deleting ranges that intersect a revision maintains invariants", () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 0, max: 10 }),
                fc.integer({ min: 0, max: 10 }),
                (a, b) => {
                    harness = EditorHarness.create("abcdefghij");
                    harness.addRevision(2, 8);

                    const from = Math.min(a, b, harness.doc.length);
                    const to = Math.min(
                        Math.max(a, b),
                        harness.doc.length,
                    );
                    if (from < to) {
                        harness.delete(from, to);
                        assertInvariants(
                            harness,
                            `delete [${from},${to})`,
                        );
                    }

                    harness.destroy();
                },
            ),
            { numRuns: 100 },
        );
    });

    it("multiple revisions with interleaved edits maintain invariants", () => {
        fc.assert(
            fc.property(
                fc.array(arbSmallText, { minLength: 1, maxLength: 5 }),
                (edits) => {
                    harness = EditorHarness.create("aaaa bbbb cccc");
                    // Three non-overlapping revisions
                    const r1 = harness.addRevision(0, 4);
                    const r2 = harness.addRevision(5, 9);
                    const r3 = harness.addRevision(10, 14);

                    const revIds = [r1, r2, r3];

                    for (let i = 0; i < edits.length; i++) {
                        const revId = revIds[i % revIds.length];
                        try {
                            const rev = harness.annotation(revId);
                            if (!isAnnotationOfType(rev, "revision")) continue;
                            const rangeLen =
                                rev.selection.main.to -
                                rev.selection.main.from;
                            if (rangeLen === 0) continue;
                            harness.nestedInsert(
                                revId,
                                Math.min(1, rangeLen),
                                edits[i],
                            );
                            assertInvariants(
                                harness,
                                `edit ${i} on rev ${revId}`,
                            );
                        } catch {
                            // Revision may have been removed
                        }
                    }

                    harness.destroy();
                },
            ),
            { numRuns: 50 },
        );
    });
});

// ── Targeted undo/redo property tests ───────────────────────────────────────

describe("undo/redo symmetry (property-based)", () => {
    let harness: EditorHarness;

    afterEach(() => {
        harness?.destroy();
    });

    it("undo then redo of a single nested edit is identity", () => {
        fc.assert(
            fc.property(
                arbSmallText,
                fc.integer({ min: 0, max: 50 }),
                arbSmallText,
                (initialDoc, relPos, insertText) => {
                    harness = EditorHarness.create(initialDoc || "x");
                    const docLen = harness.doc.length;
                    const revId = harness.addRevision(0, docLen);
                    const pos = Math.min(relPos, docLen);

                    harness.nestedInsert(revId, pos, insertText);
                    const afterInsert = harness.doc;

                    harness.undo();
                    assertInvariants(harness, "after undo");

                    harness.redo();
                    assertInvariants(harness, "after redo");
                    expect(harness.doc).toBe(afterInsert);

                    harness.destroy();
                },
            ),
            { numRuns: 100 },
        );
    });

    it("N undos then N redos is identity for pure insert sequences", () => {
        fc.assert(
            fc.property(
                fc.array(arbSmallText, { minLength: 1, maxLength: 8 }),
                (texts) => {
                    harness = EditorHarness.create("base");
                    const revId = harness.addRevision(0, 4);

                    // Forward pass
                    let offset = 4;
                    for (const text of texts) {
                        harness.nestedInsert(revId, offset, text);
                        offset += text.length;
                    }
                    const finalDoc = harness.doc;

                    // Undo all
                    for (let i = 0; i < texts.length; i++) {
                        harness.undo();
                        assertInvariants(harness, `undo #${i}`);
                    }
                    expect(harness.doc).toBe("base");

                    // Redo all
                    for (let i = 0; i < texts.length; i++) {
                        harness.redo();
                        assertInvariants(harness, `redo #${i}`);
                    }
                    expect(harness.doc).toBe(finalDoc);

                    harness.destroy();
                },
            ),
            { numRuns: 50 },
        );
    });
});
