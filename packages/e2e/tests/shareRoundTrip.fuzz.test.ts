/**
 * shareRoundTrip.fuzz.test.ts — Bounded, seeded property coverage for the Omni
 * Web Preview annotation wire round-trip.
 *
 * fast-check supplies composable generators and shrinking. The explicit seed
 * and run count keep CI runtime bounded and every failure locally reproducible.
 */
import { EditorSelection, EditorState } from "@codemirror/state";
import type { GenericAnnotation } from "@quillium/share/core";
import {
    annotationField,
    getReadonlyExtensions,
    isAnnotationOfType,
    readonlySavedFields,
    serializeFromState,
    versionGroupField,
} from "@quillium/share/core";
import { addAnnotation } from "@quillium/share/core/annotationField";
import type { ThreadMessage } from "@quillium/share/core/models";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

const FUZZ_SEED = 0x51a7e42;
const FUZZ_RUNS = 100;
const TEXT_ALPHABET = "abcdefghijklmnopqrstuvwxyz ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,!?\n";

type RangeSpec = {
    from: number;
    to: number;
};

type BaseSpec = RangeSpec & {
    id: number;
    thread: ThreadMessage[];
};

type CommentSpec = BaseSpec & {
    kind: "comment";
};

type SuggestionSpec = BaseSpec & {
    kind: "suggestion";
    replacements: Array<{ text: string; rationale?: string }>;
    author?: string;
};

type RevisionSpec = BaseSpec & {
    kind: "revision";
    activeVersionId: string;
    versions: Array<{ id: string; doc: string; label?: string }>;
};

type AnnotationSpec = CommentSpec | SuggestionSpec | RevisionSpec;

type GeneratedCase = {
    doc: string;
    annotations: AnnotationSpec[];
};

type BaseDraft = RangeSpec & {
    thread: ThreadMessage[];
};

type CommentDraft = BaseDraft & {
    kind: "comment";
};

type SuggestionDraft = BaseDraft & {
    kind: "suggestion";
    replacements: Array<{ text: string; rationale?: string }>;
    author?: string;
};

type RevisionDraft = BaseDraft & {
    kind: "revision";
    activeVersionIndex: number;
    versions: Array<{ doc: string; label?: string }>;
};

type AnnotationDraft = CommentDraft | SuggestionDraft | RevisionDraft;

const characterArbitrary = fc.constantFrom(...TEXT_ALPHABET);

function textArbitrary(minLength: number, maxLength: number): fc.Arbitrary<string> {
    return fc.string({ unit: characterArbitrary, minLength, maxLength });
}

const threadArbitrary = fc.array(
    fc.record({
        author: fc.integer({ min: 1, max: 5 }).map((reader) => `Reader ${reader}`),
        message: textArbitrary(0, 30),
        time: fc.integer({ min: 0, max: 2_000_000_000 }),
    }),
    { maxLength: 3 },
);

const replacementArbitrary = fc
    .tuple(textArbitrary(0, 24), fc.option(textArbitrary(0, 28), { nil: null }))
    .map(([text, rationale]) => ({
        text,
        ...(rationale !== null ? { rationale } : {}),
    }));

const optionalAuthorArbitrary = fc
    .option(fc.integer({ min: 1, max: 4 }), { nil: null })
    .map((persona) => (persona === null ? undefined : `Persona ${persona}`));

const optionalLabelArbitrary = fc
    .option(textArbitrary(0, 18), { nil: null })
    .map((label) => (label === null ? undefined : label));

function rangeArbitrary(docLength: number): fc.Arbitrary<RangeSpec> {
    return fc
        .integer({ min: 0, max: docLength - 1 })
        .chain((from) => fc.integer({ min: from + 1, max: docLength }).map((to) => ({ from, to })));
}

function revisionPayloadArbitrary(doc: string, range: RangeSpec): fc.Arbitrary<RevisionDraft> {
    return fc.integer({ min: 1, max: 4 }).chain((versionCount) =>
        fc.integer({ min: 0, max: versionCount - 1 }).chain((activeVersionIndex) => {
            const versions = Array.from({ length: versionCount }, (_, index) =>
                fc.record({
                    doc:
                        index === activeVersionIndex
                            ? fc.constant(doc.slice(range.from, range.to))
                            : textArbitrary(0, 28),
                    label: optionalLabelArbitrary,
                }),
            );
            return fc
                .tuple(...versions)
                .map((generatedVersions) => ({
                    ...range,
                    kind: "revision" as const,
                    activeVersionIndex,
                    versions: generatedVersions.map(({ doc: versionDoc, label }) => ({
                        doc: versionDoc,
                        ...(label !== undefined ? { label } : {}),
                    })),
                }))
                .chain((revision) => threadArbitrary.map((thread) => ({ ...revision, thread })));
        }),
    );
}

function annotationArbitrary(
    doc: string,
    forcedKind?: AnnotationDraft["kind"],
): fc.Arbitrary<AnnotationDraft> {
    return rangeArbitrary(doc.length).chain((range) => {
        const comment = threadArbitrary.map(
            (thread): CommentDraft => ({ ...range, kind: "comment", thread }),
        );
        const suggestion = fc
            .tuple(
                threadArbitrary,
                fc.array(replacementArbitrary, { minLength: 1, maxLength: 3 }),
                optionalAuthorArbitrary,
            )
            .map(
                ([thread, replacements, author]): SuggestionDraft => ({
                    ...range,
                    kind: "suggestion",
                    thread,
                    replacements,
                    ...(author !== undefined ? { author } : {}),
                }),
            );
        const revision = revisionPayloadArbitrary(doc, range);

        if (forcedKind === "comment") return comment;
        if (forcedKind === "suggestion") return suggestion;
        if (forcedKind === "revision") return revision;
        return fc.oneof(comment, suggestion, revision);
    });
}

function addStableIds(drafts: AnnotationDraft[]): AnnotationSpec[] {
    return drafts.map((draft, index) => {
        const id = index + 1;
        if (draft.kind !== "revision") return { ...draft, id };

        const versions = draft.versions.map((version, versionIndex) => ({
            id: `v-${id}-${versionIndex}`,
            ...version,
        }));
        const { activeVersionIndex: activeIndex, ...base } = draft;
        return {
            ...base,
            id,
            activeVersionId: versions[activeIndex].id,
            versions,
        };
    });
}

const generatedCaseArbitrary: fc.Arbitrary<GeneratedCase> = textArbitrary(1, 72).chain((doc) =>
    fc
        .tuple(
            annotationArbitrary(doc, "comment"),
            annotationArbitrary(doc, "suggestion"),
            annotationArbitrary(doc, "revision"),
            fc.array(annotationArbitrary(doc), { maxLength: 5 }),
        )
        .map(([comment, suggestion, revision, additional]) => ({
            doc,
            annotations: addStableIds([comment, suggestion, revision, ...additional]),
        })),
);

function toAnnotation(spec: AnnotationSpec): GenericAnnotation {
    const base = {
        id: spec.id,
        selection: EditorSelection.single(spec.from, spec.to),
        thread: spec.thread,
    };
    if (spec.kind === "suggestion") {
        return {
            ...base,
            _type: "suggestion",
            replacements: spec.replacements,
            ...(spec.author !== undefined ? { author: spec.author } : {}),
        };
    }
    if (spec.kind === "revision") {
        return {
            ...base,
            _type: "revision",
            activeVersionId: spec.activeVersionId,
            versions: spec.versions,
        };
    }
    return { ...base, _type: "comment" };
}

function buildState(generated: GeneratedCase): EditorState {
    const state = EditorState.create({
        doc: generated.doc,
        extensions: [annotationField, versionGroupField],
    });
    return state.update({
        effects: generated.annotations.map((spec) => addAnnotation.of(toAnnotation(spec))),
    }).state;
}

function restore(wire: Record<string, unknown>): EditorState {
    return EditorState.fromJSON(wire, { extensions: getReadonlyExtensions() }, readonlySavedFields);
}

function assertAnnotationFidelity(state: EditorState, generated: GeneratedCase): void {
    const restoredMap = state.field(annotationField);
    const projection = serializeFromState(state);

    expect(projection.content).toBe(generated.doc);
    expect(Object.keys(restoredMap)).toHaveLength(generated.annotations.length);
    expect(projection.annotations).toHaveLength(generated.annotations.length);

    for (const spec of generated.annotations) {
        const restoredAnnotation = restoredMap[spec.id];
        const projectedAnnotation = projection.annotations.find(
            (annotation) => annotation.id === String(spec.id),
        );
        expect(restoredAnnotation).toBeDefined();
        expect(projectedAnnotation).toBeDefined();
        if (!restoredAnnotation || !projectedAnnotation) continue;

        expect(restoredAnnotation.id).toBe(spec.id);
        expect(restoredAnnotation.selection.toJSON()).toEqual(
            EditorSelection.single(spec.from, spec.to).toJSON(),
        );
        expect(restoredAnnotation.thread).toEqual(spec.thread);
        expect(projectedAnnotation).toMatchObject({
            id: String(spec.id),
            type: spec.kind,
            from: spec.from,
            to: spec.to,
            selectedText: generated.doc.slice(spec.from, spec.to),
            thread: spec.thread,
        });

        if (spec.kind === "suggestion") {
            expect(isAnnotationOfType(restoredAnnotation, "suggestion")).toBe(true);
            if (!isAnnotationOfType(restoredAnnotation, "suggestion")) continue;
            expect(restoredAnnotation.replacements).toEqual(spec.replacements);
            expect(restoredAnnotation.author).toBe(spec.author);
            expect(projectedAnnotation).toMatchObject({
                replacements: spec.replacements,
                author: spec.author,
            });
            continue;
        }

        if (spec.kind === "revision") {
            expect(isAnnotationOfType(restoredAnnotation, "revision")).toBe(true);
            if (!isAnnotationOfType(restoredAnnotation, "revision")) continue;
            expect(restoredAnnotation.activeVersionId).toBe(spec.activeVersionId);
            expect(restoredAnnotation.versions).toEqual(spec.versions);
            expect(projectedAnnotation).toMatchObject({
                activeVersionIndex: spec.versions.findIndex(
                    (version) => version.id === spec.activeVersionId,
                ),
                versions: spec.versions.map((version, index) => ({
                    index,
                    text: version.doc,
                    label: version.label,
                    annotations: [],
                })),
            });
            continue;
        }

        expect(isAnnotationOfType(restoredAnnotation, "comment")).toBe(true);
    }
}

describe("Omni share round-trip fuzz properties", () => {
    it(`preserves generated documents and annotations (${FUZZ_RUNS} seeded runs)`, () => {
        fc.assert(
            fc.property(generatedCaseArbitrary, (generated) => {
                const original = buildState(generated);
                const wire = original.toJSON(readonlySavedFields);
                const firstSerialization = JSON.stringify(wire);

                expect(JSON.stringify(original.toJSON(readonlySavedFields))).toBe(
                    firstSerialization,
                );

                const restored = restore(wire);
                expect(restored.doc.toString()).toBe(generated.doc);
                expect(restored.toJSON(readonlySavedFields)).toEqual(wire);
                expect(JSON.stringify(restored.toJSON(readonlySavedFields))).toBe(
                    JSON.stringify(restored.toJSON(readonlySavedFields)),
                );
                assertAnnotationFidelity(restored, generated);
            }),
            { seed: FUZZ_SEED, numRuns: FUZZ_RUNS },
        );
    });
});
