/**
 * fixtures.ts — Builds a realistic shared-document EditorState through the REAL
 * annotation core (the same reducer the desktop editor and the landing renderer
 * use), so the round-trip tests exercise genuine state, not hand-authored JSON.
 *
 * The document:
 *   "The quick brown fox"
 *      0..3  "The"    — a comment
 *      4..9  "quick"  — revision A, versions ["quick", "swift"]
 *     10..15 "brown"  — a suggestion
 *     16..19 "fox"    — revision B, versions ["fox", "hound"]
 *   A version group links revision A's "swift" to revision B's "hound", so
 *   activating one cascades to the other (the linked-revision marquee feature).
 */
import { EditorSelection, EditorState } from "@codemirror/state";
import type { GenericAnnotation } from "@quillium/share/core";
import { annotationField, versionGroupField } from "@quillium/share/core";
import { addAnnotation } from "@quillium/share/core/annotationField";
import { makeVersion } from "@quillium/share/core/models";
import { _addMemberToGroup, _createVersionGroup } from "@quillium/share/core/versionGroupField";
import { serializeShareState } from "../../desktop/src/lib/collab/shareState";

export const FIXTURE_DOC = "The quick brown fox";

export type FixtureIds = {
    revA: number;
    revB: number;
    comment: number;
    suggestion: number;
    vAQuick: string;
    vASwift: string;
    vBFox: string;
    vBHound: string;
};

export const VISUAL_FIXTURE_TIME = Date.UTC(2024, 0, 15, 18, 30);

export const VISUAL_FIXTURE_IDS = {
    startComment: 100,
    nearbyComment: 101,
    rootRevision: 102,
    suggestion: 103,
    endRevision: 104,
    endComment: 105,
    nestedRevision: 201,
    deepRevision: 301,
    deepestComment: 401,
    rootOriginalVersion: "visual-root-original",
    rootAlternateVersion: "visual-root-alternate",
    nestedOriginalVersion: "visual-nested-original",
    nestedAlternateVersion: "visual-nested-alternate",
    deepOriginalVersion: "visual-deep-original",
    deepAlternateVersion: "visual-deep-alternate",
    endOriginalVersion: "visual-end-original",
    endAlternateVersion: "visual-end-alternate",
    linkedGroup: "visual-linked-formal-voice",
} as const;

export type VisualFixture = {
    state: EditorState;
    ids: typeof VISUAL_FIXTURE_IDS;
    targets: {
        start: string;
        middle: string;
        end: string;
        deepest: string;
    };
};

function fixedVersion(id: string, label: string, doc: string): ReturnType<typeof makeVersion> {
    return makeVersion({ id, doc, label });
}

function addFixedVersionGroup(
    state: EditorState,
    group: {
        id: string;
        label: string;
        members: [
            { revisionId: number; versionId: string },
            { revisionId: number; versionId: string },
        ];
    },
): EditorState {
    return state.update({
        effects: [
            _createVersionGroup.of({
                group: { id: group.id, label: group.label, members: [] },
            }),
            ...group.members.map((member) => _addMemberToGroup.of({ groupId: group.id, member })),
        ],
    }).state;
}

function rangeOf(doc: string, text: string): EditorSelection {
    const from = doc.indexOf(text);
    if (from < 0) throw new Error(`Visual fixture text is missing: ${text}`);
    return EditorSelection.single(from, from + text.length);
}

function nestedVersion(
    id: string,
    label: string,
    state: EditorState,
): ReturnType<typeof makeVersion> {
    return makeVersion({
        id,
        label,
        ...state.toJSON({ annotationField }),
        doc: state.doc.toString(),
    });
}

export function buildFixtureState(): { state: EditorState; ids: FixtureIds } {
    let state = EditorState.create({
        doc: FIXTURE_DOC,
        extensions: [annotationField, versionGroupField],
    });

    const vAQuick = makeVersion({ id: "fixture-a-quick", doc: "quick" });
    const vASwift = makeVersion({ id: "fixture-a-swift", doc: "swift" });
    const revA: GenericAnnotation = {
        id: 1,
        _type: "revision",
        thread: [{ author: "Editor", message: "Opening claim.", time: 3 }],
        selection: EditorSelection.single(4, 9),
        activeVersionId: vAQuick.id,
        versions: [vAQuick, vASwift],
    };

    const vBFox = makeVersion({ id: "fixture-b-fox", doc: "fox" });
    const vBHound = makeVersion({ id: "fixture-b-hound", doc: "hound" });
    const revB: GenericAnnotation = {
        id: 2,
        _type: "revision",
        thread: [],
        selection: EditorSelection.single(16, 19),
        activeVersionId: vBFox.id,
        versions: [vBFox, vBHound],
    };

    const comment: GenericAnnotation = {
        id: 3,
        _type: "comment",
        thread: [{ author: "Reviewer", message: "Strong opener.", time: 1 }],
        selection: EditorSelection.single(0, 3),
    };

    const suggestion: GenericAnnotation = {
        id: 4,
        _type: "suggestion",
        author: "AI",
        thread: [{ author: "AI", message: "Consider a more vivid color.", time: 2 }],
        selection: EditorSelection.single(10, 15),
        replacements: [{ text: "russet", rationale: "More specific" }, { text: "umber" }],
    };

    state = state.update({
        effects: [
            addAnnotation.of(revA),
            addAnnotation.of(revB),
            addAnnotation.of(comment),
            addAnnotation.of(suggestion),
        ],
    }).state;

    state = addFixedVersionGroup(state, {
        id: "fixture-formal-voice",
        label: "Formal voice",
        members: [
            { revisionId: 1, versionId: vASwift.id },
            { revisionId: 2, versionId: vBHound.id },
        ],
    });

    return {
        state,
        ids: {
            revA: 1,
            revB: 2,
            comment: 3,
            suggestion: 4,
            vAQuick: vAQuick.id,
            vASwift: vASwift.id,
            vBFox: vBFox.id,
            vBHound: vBHound.id,
        },
    };
}

/**
 * Long-form, fixed-identity fixture for cross-surface visual regression.
 *
 * It deliberately places annotations near the start, middle, and end, creates
 * enough adjacent cards to exercise column stacking, and embeds revisions to
 * depth three. Every visible timestamp, annotation id, version id, and group id
 * is fixed so desktop, history, and Web Preview can consume byte-stable state.
 */
export function buildVisualFixtureState(): VisualFixture {
    const deepestText = "the brass bell answered the storm with one clear note";
    const deepestState = EditorState.create({
        doc: deepestText,
        extensions: [annotationField],
    }).update({
        effects: addAnnotation.of({
            id: VISUAL_FIXTURE_IDS.deepestComment,
            _type: "comment",
            thread: [
                {
                    author: "Mara Chen",
                    message: "Keep this image. It is the quiet center of the passage.",
                    time: VISUAL_FIXTURE_TIME - 60_000,
                },
            ],
            selection: rangeOf(deepestText, "one clear note"),
        }),
    }).state;

    const deepContainer =
        "Below the lantern room, the keeper listened as the brass bell answered the storm with one clear note before dawn.";
    const deepOriginal = nestedVersion(
        VISUAL_FIXTURE_IDS.deepOriginalVersion,
        "Measured",
        deepestState,
    );
    const deepAlternate = fixedVersion(
        VISUAL_FIXTURE_IDS.deepAlternateVersion,
        "Urgent",
        "the brass bell warned the harbor with three quick notes",
    );
    const deepState = EditorState.create({
        doc: deepContainer,
        extensions: [annotationField],
    }).update({
        effects: addAnnotation.of({
            id: VISUAL_FIXTURE_IDS.deepRevision,
            _type: "revision",
            thread: [],
            selection: rangeOf(deepContainer, deepestText),
            activeVersionId: deepOriginal.id,
            versions: [deepOriginal, deepAlternate],
        }),
    }).state;

    const nestedContainer = `Inside the margin note, the curator remembered: ${deepContainer} She underlined the passage twice.`;
    const nestedOriginal = nestedVersion(
        VISUAL_FIXTURE_IDS.nestedOriginalVersion,
        "Archive note",
        deepState,
    );
    const nestedAlternate = fixedVersion(
        VISUAL_FIXTURE_IDS.nestedAlternateVersion,
        "Condensed",
        "The curator remembered the keeper listening below the lantern room before dawn.",
    );
    const nestedState = EditorState.create({
        doc: nestedContainer,
        extensions: [annotationField],
    }).update({
        effects: addAnnotation.of({
            id: VISUAL_FIXTURE_IDS.nestedRevision,
            _type: "revision",
            thread: [
                {
                    author: "Noah Bell",
                    message: "The memory inside the memory should remain visible.",
                    time: VISUAL_FIXTURE_TIME - 120_000,
                },
            ],
            selection: rangeOf(nestedContainer, deepContainer),
            activeVersionId: nestedOriginal.id,
            versions: [nestedOriginal, nestedAlternate],
        }),
    }).state;

    const startTarget = "The harbor woke before the bells";
    const middleTarget = nestedContainer;
    const suggestionTarget = "The tide tables promised calm";
    const endTarget = "the last lamp went dark";
    const proseBefore = [
        `${startTarget}, while fog pressed its pale hand against every window on the quay. Ropes knocked softly against the masts, and the bakery sent a warm ribbon of smoke toward the water.`,
        "By six, the fishmongers had lifted their shutters. Their jokes crossed the square before their footsteps did, familiar as gulls and twice as sharp. A clerk chalked the wind direction on a slate no one admitted reading.",
        "Salt worried the windows of the old archive. Each pane held a different version of the morning: silver from the street, green from the sea, and amber where the lamps still burned over unfinished ledgers.",
        "The curator climbed the narrow stairs with a blue folder tucked beneath her coat. She paused at every landing, listening for the building to settle, then continued toward the room where the keeper's letters waited.",
    ].join("\n\n");
    const proseAfter = [
        `${suggestionTarget}, but the gulls flew inland and the barometer continued its slow, stubborn fall. Nobody mentioned the mismatch until the first launch turned back.`,
        "At noon, rain erased the chalkboard and drove the market beneath striped awnings. The archive hummed with pipes, wet wool, and the papery scent released whenever a box was opened after years in the dark.",
        "The curator copied three lines into her notebook, crossed out two, and left the third standing alone. Outside, the breakwater vanished behind weather that seemed to have been waiting just beyond the headland.",
        `By evening ${endTarget}. The harbor kept moving without it: chains tightened, radios crackled, and somewhere beyond the wall a bell counted a distance no map could show.`,
        "She closed the folder only after the rain eased. On the cover, in a hand smaller than she expected, someone had written: return this to the room above the sea.",
    ].join("\n\n");
    const doc = `${proseBefore}\n\n${middleTarget}\n\n${proseAfter}`;

    const rootOriginal = nestedVersion(
        VISUAL_FIXTURE_IDS.rootOriginalVersion,
        "Layered memory",
        nestedState,
    );
    const rootAlternate = fixedVersion(
        VISUAL_FIXTURE_IDS.rootAlternateVersion,
        "Direct account",
        "The curator found a margin note about the keeper, the lantern room, and a bell heard before dawn.",
    );
    const endOriginal = fixedVersion(VISUAL_FIXTURE_IDS.endOriginalVersion, "Original", endTarget);
    const endAlternate = fixedVersion(
        VISUAL_FIXTURE_IDS.endAlternateVersion,
        "Sharper",
        "the final harbor lamp surrendered to the weather",
    );

    const annotations: GenericAnnotation[] = [
        {
            id: VISUAL_FIXTURE_IDS.startComment,
            _type: "comment",
            selection: rangeOf(doc, startTarget),
            thread: [
                {
                    author: "Mara Chen",
                    message: "This opening gives us place and motion immediately.",
                    time: VISUAL_FIXTURE_TIME - 600_000,
                },
                {
                    author: "Noah Bell",
                    message: "Agreed. I would keep the bells in the first line.",
                    time: VISUAL_FIXTURE_TIME - 540_000,
                },
                {
                    author: "Mara Chen",
                    message: "Keeping them, then. The sound returns at the end.",
                    time: VISUAL_FIXTURE_TIME - 480_000,
                },
            ],
        },
        {
            id: VISUAL_FIXTURE_IDS.nearbyComment,
            _type: "comment",
            selection: rangeOf(doc, "Salt worried the windows"),
            thread: [
                {
                    author: "Line Editor",
                    message: "Lovely verb, but the paragraph is carrying several color images.",
                    time: VISUAL_FIXTURE_TIME - 420_000,
                },
            ],
        },
        {
            id: VISUAL_FIXTURE_IDS.rootRevision,
            _type: "revision",
            selection: rangeOf(doc, middleTarget),
            activeVersionId: rootOriginal.id,
            versions: [rootOriginal, rootAlternate],
            thread: [
                {
                    author: "Mara Chen",
                    message:
                        "The nested recollection is intentional. Please test the direct version, but preserve all three layers for comparison.",
                    time: VISUAL_FIXTURE_TIME - 360_000,
                },
                {
                    author: "Noah Bell",
                    message: "The layered version earns its complexity once the bell repeats.",
                    time: VISUAL_FIXTURE_TIME - 300_000,
                },
            ],
        },
        {
            id: VISUAL_FIXTURE_IDS.suggestion,
            _type: "suggestion",
            author: "AI",
            selection: rangeOf(doc, suggestionTarget),
            replacements: [
                {
                    text: "The tide tables forecast calm water",
                    rationale: "Uses the more precise verb for a recorded prediction.",
                },
                {
                    text: "The printed tide tables insisted on calm",
                    rationale: "Adds tension between the document and the visible weather.",
                },
                {
                    text: "Every tide table on the quay predicted calm",
                    rationale: "Broadens the claim while keeping the sentence concrete.",
                },
            ],
            thread: [
                {
                    author: "AI",
                    message:
                        "The weather contradiction is strong; a more exact reporting verb can make it feel deliberate rather than accidental.",
                    time: VISUAL_FIXTURE_TIME - 240_000,
                },
                {
                    author: "Mara Chen",
                    message: "Option two has the right pressure, though I may keep promised.",
                    time: VISUAL_FIXTURE_TIME - 180_000,
                },
                {
                    author: "Noah Bell",
                    message: "Promised quietly echoes the letters. I vote to retain it.",
                    time: VISUAL_FIXTURE_TIME - 120_000,
                },
            ],
        },
        {
            id: VISUAL_FIXTURE_IDS.endRevision,
            _type: "revision",
            selection: rangeOf(doc, endTarget),
            activeVersionId: endOriginal.id,
            versions: [endOriginal, endAlternate],
            thread: [],
        },
        {
            id: VISUAL_FIXTURE_IDS.endComment,
            _type: "comment",
            selection: rangeOf(doc, "a bell counted a distance no map could show"),
            thread: [
                {
                    author: "Line Editor",
                    message: "The final bell resolves the sound introduced in line one.",
                    time: VISUAL_FIXTURE_TIME - 30_000,
                },
            ],
        },
    ];

    let state = EditorState.create({
        doc,
        selection: EditorSelection.cursor(doc.indexOf(middleTarget) - 1),
        extensions: [annotationField, versionGroupField],
    }).update({
        effects: annotations.map((annotation) => addAnnotation.of(annotation)),
    }).state;
    state = addFixedVersionGroup(state, {
        id: VISUAL_FIXTURE_IDS.linkedGroup,
        label: "Formal voice",
        members: [
            {
                revisionId: VISUAL_FIXTURE_IDS.rootRevision,
                versionId: VISUAL_FIXTURE_IDS.rootAlternateVersion,
            },
            {
                revisionId: VISUAL_FIXTURE_IDS.endRevision,
                versionId: VISUAL_FIXTURE_IDS.endAlternateVersion,
            },
        ],
    });

    return {
        state,
        ids: VISUAL_FIXTURE_IDS,
        targets: {
            start: startTarget,
            middle: middleTarget,
            end: endTarget,
            deepest: deepestText,
        },
    };
}

/** Wrap the linked fixture inside one revision version for real modal exploration tests. */
export function buildNestedLinkedFixtureState(): EditorState {
    const { state: nestedState } = buildFixtureState();
    const nestedWire = serializeFixtureWire(nestedState);
    const outerVersion = makeVersion({
        ...nestedWire,
        doc: nestedState.doc.toString(),
    });
    const outerRevision: GenericAnnotation = {
        id: 10,
        _type: "revision",
        thread: [],
        selection: EditorSelection.single(0, nestedState.doc.length),
        activeVersionId: outerVersion.id,
        versions: [outerVersion],
    };
    const outerState = EditorState.create({
        doc: nestedState.doc.toString(),
        extensions: [annotationField, versionGroupField],
    });
    return outerState.update({ effects: addAnnotation.of(outerRevision) }).state;
}

/**
 * The public-share WIRE payload: exactly what desktop's
 * `serializeShareState(state)` writes (`state.toJSON({ annotationField,
 * versionGroupField })`) and what lands in Supabase `published_state`. Kept as
 * one line so any drift from that producer is obvious.
 */
export function serializeFixtureWire(state: EditorState): Record<string, unknown> {
    return serializeShareState(state);
}
