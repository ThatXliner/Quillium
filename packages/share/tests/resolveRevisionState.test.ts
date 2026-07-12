import { EditorSelection, EditorState } from "@codemirror/state";
import fc from "fast-check";
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

    it("resolves arbitrary nested paths and modal-selected target versions", () => {
        fc.assert(
            fc.property(
                fc.array(fc.integer({ min: 0, max: 2 }), { minLength: 0, maxLength: 4 }),
                fc.integer({ min: 0, max: 2 }),
                (pathVersionIndices, targetVersionIndex) => {
                    const depth = pathVersionIndices.length + 1;
                    const targetVersions = Array.from({ length: 3 }, (_, index) =>
                        makeVersion({ doc: `target-version-${index}` }),
                    );
                    let nestedRevision: Record<string, unknown> = {
                        id: depth,
                        _type: "revision",
                        thread: [],
                        selection: EditorSelection.single(0, 1).toJSON(),
                        activeVersionId: targetVersions[0].id,
                        versions: targetVersions,
                    };

                    for (let parentId = depth - 1; parentId >= 1; parentId -= 1) {
                        const childId = parentId + 1;
                        const pathVersionIndex = pathVersionIndices[parentId - 1];
                        const versions = Array.from({ length: 3 }, (_, versionIndex) => {
                            const version = makeVersion({
                                doc: `level-${parentId}-version-${versionIndex}`,
                            });
                            return versionIndex === pathVersionIndex
                                ? {
                                      ...version,
                                      annotationField: { [childId]: nestedRevision },
                                  }
                                : version;
                        });
                        nestedRevision = {
                            id: parentId,
                            _type: "revision",
                            thread: [],
                            selection: EditorSelection.single(0, 1).toJSON(),
                            activeVersionId: versions[0].id,
                            versions,
                        };
                    }

                    const rootRevision = {
                        ...nestedRevision,
                        selection: EditorSelection.single(0, 1),
                    } as unknown as GenericAnnotation;
                    const initialState = EditorState.create({
                        doc: "root",
                        extensions: [annotationField],
                    });
                    const state = initialState.update({
                        effects: addAnnotation.of(rootRevision),
                    }).state;
                    const targetId = pathVersionIndices.reduce(
                        (id, versionIndex, level) => `${id}.v${versionIndex}.${level + 2}`,
                        "1",
                    );

                    expect(resolveRevisionVersionState(state, targetId)?.doc).toBe(
                        "target-version-0",
                    );
                    expect(
                        resolveRevisionVersionState(state, targetId, {
                            [targetId]: targetVersionIndex,
                        })?.doc,
                    ).toBe(`target-version-${targetVersionIndex}`);
                },
            ),
            { seed: 0x5e5017e, numRuns: 250 },
        );
    });
});
