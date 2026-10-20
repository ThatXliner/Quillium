import { applyEditorialAction, resolveExactEditorialRange } from "$lib/ai/editorialAction";
import { annotationField } from "$lib/editor/plugins/annotations";
import { invertedAnnotationFieldEffects } from "$lib/editor/plugins/annotations/annotationField";
import {
    type AiGenerationProvenance,
    isAnnotationOfType,
} from "$lib/editor/plugins/annotations/models";
import { history, redo, undo } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

const provenance: AiGenerationProvenance = {
    requestId: "request-a",
    task: "local-rewrite",
    provider: "test-provider",
    model: "test-model",
    createdAt: 1,
};

const target = {
    documentId: "document-a",
    tabId: "tab-a",
    draftId: "draft-a",
    selectedText: "",
    branchPath: [],
};

const current = {
    documentId: "document-a",
    tabId: "tab-a",
    draftId: "draft-a",
};

let view: EditorView | undefined;

afterEach(() => {
    view?.destroy();
    view = undefined;
});

function createView(doc: string, readOnly = false): EditorView {
    view = new EditorView({
        state: EditorState.create({
            doc,
            extensions: [
                annotationField,
                history(),
                invertedAnnotationFieldEffects,
                EditorState.readOnly.of(readOnly),
            ],
        }),
    });
    return view;
}

describe("resolveExactEditorialRange", () => {
    it("selects the explicitly addressed occurrence of repeated text", () => {
        expect(
            resolveExactEditorialRange({
                documentText: "word word",
                targetText: "word",
                targetRange: { from: 5, to: 9 },
            }),
        ).toEqual({ ok: true, range: { from: 5, to: 9 } });
    });

    it.each([
        { from: -1, to: 3 },
        { from: 0.5, to: 4.5 },
        { from: 0, to: 0 },
        { from: 5, to: 9 },
        { from: 0, to: 99 },
    ])("rejects invalid, stale, or out-of-scope explicit range %j", (targetRange) => {
        expect(
            resolveExactEditorialRange({
                documentText: "word word",
                targetText: "word",
                targetRange,
                scope: { from: 0, to: 4 },
            }),
        ).toEqual({ ok: false, reason: "target-not-found" });
    });
    it("uses exact surrounding context to disambiguate repeated text", () => {
        expect(
            resolveExactEditorialRange({
                documentText: "First repeated phrase. Second repeated phrase.",
                targetText: "repeated",
                context: "Second repeated phrase.",
            }),
        ).toEqual({ ok: true, range: { from: 30, to: 38 } });
    });

    it("reports an ambiguous target instead of returning multiple ranges", () => {
        expect(
            resolveExactEditorialRange({
                documentText: "First repeated phrase. Second repeated phrase.",
                targetText: "repeated",
            }),
        ).toEqual({ ok: false, reason: "target-ambiguous" });
    });

    it("limits matching to the mapped request selection", () => {
        expect(
            resolveExactEditorialRange({
                documentText: "First repeated phrase. Second repeated phrase.",
                targetText: "repeated",
                scope: { from: 20, to: 46 },
            }),
        ).toEqual({ ok: true, range: { from: 30, to: 38 } });
    });
});

describe("applyEditorialAction", () => {
    it("omits repeated Original proposals while preserving distinct version labels and order", () => {
        const editor = createView("A stable sentence.");
        expect(
            applyEditorialAction({
                rootView: editor,
                target,
                current,
                allowedActions: ["revision"],
                provenance,
                payload: {
                    action: "revision",
                    targetText: "A stable sentence.",
                    versions: [
                        { label: "Original", text: "A stable sentence." },
                        { label: "Durable", text: "A durable sentence." },
                        { label: "Clear", text: "A clear sentence." },
                    ],
                    threadMessage: "Compare these adjectives.",
                },
            }).ok,
        ).toBe(true);
        const annotation = Object.values(editor.state.field(annotationField))[0];
        if (!isAnnotationOfType(annotation, "revision")) throw new Error("Missing revision");
        expect(annotation.versions.map((version) => [version.label, version.doc])).toEqual([
            ["Original", "stable"],
            ["Durable", "durable"],
            ["Clear", "clear"],
        ]);
    });

    it("omits unchanged suggestion replacements", () => {
        const editor = createView("A stable sentence.");
        expect(
            applyEditorialAction({
                rootView: editor,
                target,
                current,
                allowedActions: ["suggestion"],
                provenance,
                payload: {
                    action: "suggestion",
                    targetText: "A stable sentence.",
                    replacements: [
                        "A stable sentence.",
                        { text: "A durable sentence.", rationale: "Use this adjective." },
                    ],
                },
            }).ok,
        ).toBe(true);
        const annotation = Object.values(editor.state.field(annotationField))[0];
        if (!isAnnotationOfType(annotation, "suggestion")) throw new Error("Missing suggestion");
        expect(annotation.replacements.map((replacement) => replacement.text)).toEqual(["durable"]);
        expect(
            editor.state.doc.sliceString(
                annotation.selection.main.from,
                annotation.selection.main.to,
            ),
        ).toBe("stable");
    });
    it("leaves unchanged prose outside a local cut and preserves its persisted versions and undo", () => {
        const doc = "A long opening remains. I was really very excited to start. The ending stays.";
        const editor = createView(doc);
        const result = applyEditorialAction({
            rootView: editor,
            target,
            current,
            allowedActions: ["revision"],
            provenance,
            payload: {
                action: "revision",
                targetText: doc,
                versions: [{ label: "Cut intensifiers", text: doc.replace("really very ", "") }],
                threadMessage: "Remove the paired intensifiers.",
            },
        });
        expect(result.ok).toBe(true);
        const annotation = Object.values(editor.state.field(annotationField))[0];
        expect(editor.state.doc.toString()).toBe(doc);
        expect(doc.slice(annotation.selection.main.from, annotation.selection.main.to)).toBe(
            "really very ",
        );
        expect(isAnnotationOfType(annotation, "revision")).toBe(true);
        if (!isAnnotationOfType(annotation, "revision")) throw new Error("Missing revision");
        expect(annotation.versions.map((version) => version.doc)).toEqual(["really very ", ""]);
        expect(annotation.aiProvenance).toEqual(provenance);
        expect(annotation.versions[1].aiProvenance).toEqual(provenance);
        const saved = JSON.parse(JSON.stringify(editor.state.toJSON({ annotationField })));
        const reopened = EditorState.fromJSON(
            saved,
            { extensions: [annotationField] },
            { annotationField },
        );
        expect(reopened.field(annotationField)).toEqual(editor.state.field(annotationField));
        expect(undo(editor)).toBe(true);
        expect(Object.values(editor.state.field(annotationField))).toHaveLength(0);
        expect(editor.state.doc.toString()).toBe(doc);
        expect(redo(editor)).toBe(true);
        expect(editor.state.field(annotationField)).toEqual(reopened.field(annotationField));
    });

    it("keeps two sparse wording changes independently selectable", () => {
        const doc =
            "A long opening remains. I was really very excited to start. Much later I made a very large mistake. The ending stays.";
        const editor = createView(doc);
        for (const [source, replacement] of [
            ["I was really very excited to start", "I was excited to start"],
            ["I made a very large mistake", "I made a major mistake"],
        ]) {
            expect(
                applyEditorialAction({
                    rootView: editor,
                    target,
                    current,
                    allowedActions: ["revision"],
                    provenance,
                    payload: {
                        action: "revision",
                        targetText: source,
                        versions: [{ label: "Tighter", text: replacement }],
                        threadMessage: `Tighten ${source}.`,
                    },
                }).ok,
            ).toBe(true);
        }
        const annotations = Object.values(editor.state.field(annotationField));
        expect(
            annotations.map((annotation) =>
                doc.slice(annotation.selection.main.from, annotation.selection.main.to),
            ),
        ).toEqual(["really very ", "very large"]);
        expect(annotations.every((annotation) => isAnnotationOfType(annotation, "revision"))).toBe(
            true,
        );
    });

    it("keeps a dependent subject and verb together without unrelated surroundings", () => {
        const editor = createView("Before. He is ready. After.");
        expect(
            applyEditorialAction({
                rootView: editor,
                target,
                current,
                allowedActions: ["revision"],
                provenance,
                payload: {
                    action: "revision",
                    targetText: "Before. He is ready. After.",
                    versions: [{ label: "Plural", text: "Before. They are ready. After." }],
                    threadMessage: "Change subject and agreement together.",
                },
            }).ok,
        ).toBe(true);
        const annotation = Object.values(editor.state.field(annotationField))[0];
        expect(
            editor.state.doc.sliceString(
                annotation.selection.main.from,
                annotation.selection.main.to,
            ),
        ).toBe("He is");
        if (!isAnnotationOfType(annotation, "revision")) throw new Error("Missing revision");
        expect(annotation.versions[1].doc).toBe("They are");
    });

    it("retains a whole passage for an explicitly requested coherent rewrite", () => {
        const doc = "The opening stays. He is ready. The ending stays.";
        const editor = createView(doc);
        expect(
            applyEditorialAction({
                rootView: editor,
                target,
                current,
                allowedActions: ["revision"],
                provenance,
                payload: {
                    action: "revision",
                    targetText: doc,
                    scope: "whole-passage",
                    versions: [
                        { label: "Coherent rewrite", text: doc.replace("He is", "They are") },
                    ],
                    threadMessage: "Compare the full passage.",
                },
            }).ok,
        ).toBe(true);
        expect(Object.values(editor.state.field(annotationField))[0].selection.main).toMatchObject({
            from: 0,
            to: doc.length,
        });
    });

    it.each([
        ["I left.", "I quietly left."],
        ["left.", "She left."],
    ])("keeps source in Original when adding words to %s", (source, replacement) => {
        const editor = createView(source);
        expect(
            applyEditorialAction({
                rootView: editor,
                target,
                current,
                allowedActions: ["revision"],
                provenance,
                payload: {
                    action: "revision",
                    targetText: source,
                    versions: [{ label: "Expanded", text: replacement }],
                    threadMessage: "Add detail.",
                },
            }).ok,
        ).toBe(true);
        const annotation = Object.values(editor.state.field(annotationField))[0];
        if (!isAnnotationOfType(annotation, "revision")) throw new Error("Missing revision");
        expect(annotation.versions[0].doc.length).toBeGreaterThan(0);
        expect(
            source.slice(0, annotation.selection.main.from) +
                annotation.versions[1].doc +
                source.slice(annotation.selection.main.to),
        ).toBe(replacement);
    });

    it("does not create an annotation for unchanged alternatives", () => {
        const editor = createView("Leave this alone.");
        expect(
            applyEditorialAction({
                rootView: editor,
                target,
                current,
                allowedActions: ["revision"],
                provenance,
                payload: {
                    action: "revision",
                    targetText: "Leave this alone.",
                    versions: [{ label: "Same", text: "Leave this alone." }],
                    threadMessage: "No change.",
                },
            }),
        ).toEqual({ ok: false, reason: "unchanged-proposal" });
        expect(Object.values(editor.state.field(annotationField))).toHaveLength(0);
    });

    it("dispatches one annotation at the uniquely resolved range", () => {
        const editor = createView("First repeated phrase. Second repeated phrase.");
        const result = applyEditorialAction({
            rootView: editor,
            target,
            current,
            allowedActions: ["comment"],
            payload: {
                action: "comment",
                targetText: "repeated",
                context: "Second repeated phrase.",
                comment: "This repetition blunts the transition.",
            },
            provenance,
        });

        expect(result.ok).toBe(true);
        const created = Object.values(editor.state.field(annotationField));
        expect(created).toHaveLength(1);
        expect(created[0].selection.main).toMatchObject({ from: 30, to: 38 });
    });

    it("rejects a read-only editor before dispatch", () => {
        const editor = createView("A stable sentence.", true);
        expect(
            applyEditorialAction({
                rootView: editor,
                target,
                current,
                allowedActions: ["comment"],
                payload: {
                    action: "comment",
                    targetText: "stable",
                    comment: "Consider whether this claim needs support.",
                },
                provenance,
            }),
        ).toEqual({ ok: false, reason: "read-only" });
        expect(Object.values(editor.state.field(annotationField))).toHaveLength(0);
    });

    it("rejects a repeated open concern on the same passage", () => {
        const editor = createView("A stable sentence.");
        const request = {
            rootView: editor,
            target,
            current,
            allowedActions: ["comment" as const],
            payload: {
                action: "comment" as const,
                targetText: "stable",
                comment: "Consider whether this claim needs support.",
            },
            provenance,
        };

        expect(applyEditorialAction(request).ok).toBe(true);
        expect(applyEditorialAction(request)).toEqual({
            ok: false,
            reason: "duplicate-concern",
        });
        expect(Object.values(editor.state.field(annotationField))).toHaveLength(1);
    });

    it("reports an incompatible annotation overlap", () => {
        const editor = createView("A stable sentence.");
        const first = applyEditorialAction({
            rootView: editor,
            target,
            current,
            allowedActions: ["suggestion"],
            payload: {
                action: "suggestion",
                targetText: "stable",
                replacements: [{ text: "durable", rationale: "Use a more concrete adjective." }],
            },
            provenance,
        });
        const second = applyEditorialAction({
            rootView: editor,
            target,
            current,
            allowedActions: ["suggestion"],
            payload: {
                action: "suggestion",
                targetText: "stable",
                replacements: [
                    { text: "clear", rationale: "Match the paragraph's plain diction." },
                ],
            },
            provenance: { ...provenance, requestId: "request-b" },
        });

        expect(first.ok).toBe(true);
        expect(second).toEqual({ ok: false, reason: "annotation-conflict" });
    });

    it("rejects a capability the request did not grant", () => {
        const editor = createView("A stable sentence.");
        expect(
            applyEditorialAction({
                rootView: editor,
                target,
                current,
                allowedActions: ["comment"],
                payload: {
                    action: "revision",
                    targetText: "A stable sentence.",
                    versions: [{ label: "Alternative", text: "A durable sentence." }],
                    threadMessage: "Compare this more concrete version.",
                },
                provenance,
            }),
        ).toEqual({ ok: false, reason: "action-forbidden" });
    });

    it("rejects an exact-compression revision that misses its word target", () => {
        const editor = createView("This passage has six words total now.");
        expect(
            applyEditorialAction({
                rootView: editor,
                target,
                current,
                allowedActions: ["revision"],
                payload: {
                    action: "revision",
                    targetText: "This passage has six words total now.",
                    versions: [
                        { label: "Direct", text: "Six words are not present." },
                        { label: "Spare", text: "Still only five words here." },
                    ],
                    threadMessage: "Two compressed alternatives.",
                },
                provenance: { ...provenance, task: "exact-compression" },
                constraints: { exactWordCount: 6 },
            }),
        ).toEqual({ ok: false, reason: "exact-word-count-mismatch" });
        expect(Object.values(editor.state.field(annotationField))).toHaveLength(0);
    });

    it("accepts exact-compression alternatives only when every version meets the target", () => {
        const editor = createView("This passage has six words total now.");
        const result = applyEditorialAction({
            rootView: editor,
            target,
            current,
            allowedActions: ["revision"],
            payload: {
                action: "revision",
                targetText: "This passage has six words total now.",
                versions: [
                    { label: "Direct", text: "This passage now has six words." },
                    { label: "Spare", text: "Six words preserve this passage now." },
                ],
                threadMessage: "Two exact six-word alternatives.",
            },
            provenance: { ...provenance, task: "exact-compression" },
            constraints: { exactWordCount: 6 },
        });

        expect(result.ok).toBe(true);
        expect(Object.values(editor.state.field(annotationField))).toHaveLength(1);
    });

    it("requires exact compression to cover the full captured selection", () => {
        const documentText = "Opening words. This passage has six words total now.";
        const selectedText = "This passage has six words total now.";
        const from = documentText.indexOf(selectedText);
        const editor = createView(documentText);

        expect(
            applyEditorialAction({
                rootView: editor,
                target: {
                    ...target,
                    selectedText,
                    selectedTextRange: { from, to: from + selectedText.length },
                },
                current,
                allowedActions: ["revision"],
                payload: {
                    action: "revision",
                    targetText: "passage has six words",
                    versions: [
                        { label: "Direct", text: "Passage now has three words." },
                        { label: "Spare", text: "Three words remain right here." },
                    ],
                    threadMessage: "An incorrectly scoped compression.",
                },
                provenance: { ...provenance, task: "exact-compression" },
                constraints: { exactWordCount: 5 },
            }),
        ).toEqual({ ok: false, reason: "exact-compression-target-mismatch" });
    });
});
