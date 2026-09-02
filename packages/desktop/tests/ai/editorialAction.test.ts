import { applyEditorialAction, resolveExactEditorialRange } from "$lib/ai/editorialAction";
import { annotationField } from "$lib/editor/plugins/annotations";
import type { AiGenerationProvenance } from "$lib/editor/plugins/annotations/models";
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
            extensions: [annotationField, EditorState.readOnly.of(readOnly)],
        }),
    });
    return view;
}

describe("resolveExactEditorialRange", () => {
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
