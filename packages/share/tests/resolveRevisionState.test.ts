import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { addAnnotation, annotationField } from "../src/core/annotationField";
import { type GenericAnnotation, makeVersion } from "../src/core/models";
import { resolveRevisionVersionState } from "../src/core/resolveRevisionState";

function buildNestedState(): EditorState {
    const nestedOriginal = makeVersion({ doc: "nested original" });
    const nestedAlternative = makeVersion({ doc: "nested alternative" });
    const outerOriginal = {
        ...makeVersion({ doc: "outer original" }),
        annotationField: {
            2: {
                id: 2,
                _type: "revision",
                thread: [],
                selection: { ranges: [{ anchor: 0, head: 6 }], main: 0 },
                activeVersionId: nestedOriginal.id,
                versions: [nestedOriginal, nestedAlternative],
            },
        },
    };
    const outerAlternative = makeVersion({ doc: "outer alternative" });
    const revision: GenericAnnotation = {
        id: 1,
        _type: "revision",
        thread: [],
        selection: EditorSelection.single(0, 14),
        activeVersionId: outerOriginal.id,
        versions: [outerOriginal, outerAlternative],
    };
    const state = EditorState.create({ doc: "outer original", extensions: [annotationField] });
    return state.update({ effects: addAnnotation.of(revision) }).state;
}

describe("resolveRevisionVersionState", () => {
    it("resolves active and modal-selected root versions", () => {
        const state = buildNestedState();

        expect(resolveRevisionVersionState(state, "1")?.doc).toBe("outer original");
        expect(resolveRevisionVersionState(state, "1", { 1: 1 })?.doc).toBe("outer alternative");
    });

    it("walks encoded nested annotation paths without flattening editor state", () => {
        const state = buildNestedState();

        expect(resolveRevisionVersionState(state, "1.v0.2")?.doc).toBe("nested original");
        expect(resolveRevisionVersionState(state, "1.v0.2", { "1.v0.2": 1 })?.doc).toBe(
            "nested alternative",
        );
    });

    it("returns null for malformed paths and non-revision ids", () => {
        const state = buildNestedState();

        expect(resolveRevisionVersionState(state, "not-an-id")).toBeNull();
        expect(resolveRevisionVersionState(state, "1.v8.2")).toBeNull();
    });
});
