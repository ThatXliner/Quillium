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
import { createVersionGroup } from "@quillium/share/core/versionGroupField";
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

export function buildFixtureState(): { state: EditorState; ids: FixtureIds } {
    let state = EditorState.create({
        doc: FIXTURE_DOC,
        extensions: [annotationField, versionGroupField],
    });

    const vAQuick = makeVersion({ doc: "quick" });
    const vASwift = makeVersion({ doc: "swift" });
    const revA: GenericAnnotation = {
        id: 1,
        _type: "revision",
        thread: [{ author: "Editor", message: "Opening claim.", time: 3 }],
        selection: EditorSelection.single(4, 9),
        activeVersionId: vAQuick.id,
        versions: [vAQuick, vASwift],
    };

    const vBFox = makeVersion({ doc: "fox" });
    const vBHound = makeVersion({ doc: "hound" });
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

    const { spec } = createVersionGroup("Formal voice", [
        { revisionId: 1, versionId: vASwift.id },
        { revisionId: 2, versionId: vBHound.id },
    ]);
    state = state.update(spec).state;

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
 * The public-share WIRE payload: exactly what desktop's
 * `serializeShareState(state)` writes (`state.toJSON({ annotationField,
 * versionGroupField })`) and what lands in Supabase `published_state`. Kept as
 * one line so any drift from that producer is obvious.
 */
export function serializeFixtureWire(state: EditorState): Record<string, unknown> {
    return serializeShareState(state);
}
