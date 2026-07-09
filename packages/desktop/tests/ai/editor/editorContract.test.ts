import {
    EDITOR_EVAL_FIXTURES,
    QUILLIUM_EDITOR_LEGACY_SAFETY_PROMPT,
    QUILLIUM_EDITOR_SYSTEM_PROMPT,
    type QuilliumEditorRequest,
    type QuilliumEditorResponse,
    buildEditorFocusPrompt,
    buildEditorRequest,
    buildEditorSystemPrompt,
    buildEditorUserPrompt,
    computeReplacementPermission,
    fixturesWithDetectorEvasionIntent,
    focusForReview,
    inferWritingStage,
    isDetectorEvasionIntent,
    resolveWritingStage,
    validateEditorResponse,
} from "$lib/ai/editor";
import { describe, expect, it } from "vitest";

function request(overrides: Partial<QuilliumEditorRequest> = {}): QuilliumEditorRequest {
    return buildEditorRequest({
        surface: "one_click_editor",
        focus: ["reader_view"],
        documentRiskLevel: "ordinary",
        policyPosture: "normal",
        userIntent: "Look at this.",
        ...overrides,
    });
}

function response(
    strategy: Partial<
        QuilliumEditorResponse["annotations"][number]["revisionStrategies"][number]
    > = {},
): QuilliumEditorResponse {
    return {
        summaryForSidebar: "One note.",
        stageAssessment: {
            stage: "refining",
            confidence: 0.8,
            signals: ["The structure is established."],
        },
        focusUsed: ["reader_view"],
        annotations: [
            {
                id: "ann-1",
                target: {
                    quote: "The sentence.",
                    confidence: 1,
                },
                category: "reader_view",
                severity: "medium",
                title: "Reader question",
                observation: "The reader cannot tell what changed.",
                whyItMatters: "The claim asks for trust before evidence.",
                voiceImpact: "not_applicable",
                policyRisk: "none",
                writerQuestions: ["What changed after this moment?"],
                revisionStrategies: [
                    {
                        label: "Add an after-moment",
                        description: "Show one later behavior.",
                        tradeoff: "More grounded, but may require cutting summary.",
                        writerAction: "Write the scene yourself.",
                        includesReplacementText: false,
                        ...strategy,
                    },
                ],
            },
        ],
    };
}

describe("computeReplacementPermission", () => {
    it("allows only grammar replacements for college applications", () => {
        expect(
            computeReplacementPermission({
                documentRiskLevel: "college_application",
                policyPosture: "unknown",
                focus: ["specificity"],
            }),
        ).toBe("grammar_replacements_only");
    });

    it("blocks substantive high-stakes replacements unless the focus is grammar-only", () => {
        expect(
            computeReplacementPermission({
                documentRiskLevel: "high_stakes",
                policyPosture: "normal",
                focus: ["specificity"],
            }),
        ).toBe("no_replacement_text");

        expect(
            computeReplacementPermission({
                documentRiskLevel: "high_stakes",
                policyPosture: "normal",
                focus: ["grammar_only"],
            }),
        ).toBe("grammar_replacements_only");
    });

    it("allows ordinary low-stakes replacement text except grammar-only requests", () => {
        expect(
            computeReplacementPermission({
                documentRiskLevel: "ordinary",
                policyPosture: "normal",
                focus: ["line_notes"],
            }),
        ).toBe("may_generate_replacement_text");

        expect(
            computeReplacementPermission({
                documentRiskLevel: "ordinary",
                policyPosture: "normal",
                focus: ["grammar_only"],
            }),
        ).toBe("grammar_replacements_only");
    });

    it("lets external policy posture override risk defaults", () => {
        expect(
            computeReplacementPermission({
                documentRiskLevel: "ordinary",
                policyPosture: "no_substantive_ai_content",
                focus: ["line_notes"],
            }),
        ).toBe("no_replacement_text");

        expect(
            computeReplacementPermission({
                documentRiskLevel: "ordinary",
                policyPosture: "grammar_only",
                focus: ["line_notes"],
            }),
        ).toBe("grammar_replacements_only");
    });
});

describe("writing stage planning", () => {
    it("treats visible outline and placeholder signals as discovering", () => {
        const result = inferWritingStage("# Opening\n- scene idea\n- TK: find the real detail");
        expect(result.stage).toBe("discovering");
        expect(result.signals.outlineLineCount).toBeGreaterThan(0);
        expect(result.signals.placeholderCount).toBeGreaterThan(0);
    });

    it("moves complete long drafts toward proofing", () => {
        const paragraph =
            "This paragraph carries a complete idea through several concrete sentences. It explains what happened, why the detail matters, and how the next point follows without leaving placeholders behind.";
        const result = inferWritingStage(Array.from({ length: 30 }, () => paragraph).join("\n\n"));
        expect(result.stage).toBe("proofing");
    });

    it("honors a writer override while retaining the local inference", () => {
        const result = resolveWritingStage("shaping", "A finished sentence.");
        expect(result.stage).toBe("shaping");
        expect(result.source).toBe("writer_selected");
        expect(result.inference.stage).toBe("discovering");
    });

    it("uses explicit intent instead of making the writer choose focus toggles", () => {
        expect(
            focusForReview({
                stage: "discovering",
                userIntent: "Please proofread grammar and punctuation only.",
            }),
        ).toEqual(["grammar_only"]);
        expect(focusForReview({ stage: "shaping" })).toContain("structure");
    });
});

describe("validateEditorResponse", () => {
    it("accepts grammar replacement text when only grammar replacements are allowed", () => {
        const parsed = validateEditorResponse(
            request({
                documentRiskLevel: "college_application",
                policyPosture: "grammar_only",
                focus: ["grammar_only"],
            }),
            response({
                includesReplacementText: true,
                replacementText: "My teammate and I were debugging the robot.",
                replacementKind: "grammar",
            }),
        );

        expect(parsed.annotations[0].revisionStrategies[0].replacementKind).toBe("grammar");
    });

    it("rejects substantive replacement text in grammar-only mode", () => {
        expect(() =>
            validateEditorResponse(
                request({
                    documentRiskLevel: "college_application",
                    policyPosture: "unknown",
                    focus: ["voice_guard"],
                }),
                response({
                    includesReplacementText: true,
                    replacementText:
                        "Through robotics, I discovered the resilient leader within me.",
                    replacementKind: "substantive",
                }),
            ),
        ).toThrow("Only grammar/typo/punctuation/spelling replacements are allowed");
    });

    it("rejects all replacement text when permission is none", () => {
        expect(() =>
            validateEditorResponse(
                request({
                    documentRiskLevel: "high_stakes",
                    policyPosture: "no_substantive_ai_content",
                    focus: ["reader_view"],
                }),
                response({
                    includesReplacementText: true,
                    replacementText: "A replacement.",
                    replacementKind: "grammar",
                }),
            ),
        ).toThrow("Replacement text is not allowed");
    });

    it("rejects replacement fields that contradict includesReplacementText", () => {
        expect(() =>
            validateEditorResponse(
                request(),
                response({
                    includesReplacementText: false,
                    replacementText: "Hidden rewrite.",
                    replacementKind: "substantive",
                }),
            ),
        ).toThrow("replacementText is present");
    });
});

describe("editor prompts", () => {
    it("uses Challenge instead of Devil's Advocate for the focus", () => {
        expect(buildEditorFocusPrompt({ focus: ["challenge"] })).toContain("Challenge");
        expect(buildEditorFocusPrompt({ focus: ["challenge"] })).not.toContain("Devil's Advocate");
    });

    it("contains the core margin and detector-evasion rules", () => {
        expect(QUILLIUM_EDITOR_SYSTEM_PROMPT).toContain("AI lives in the margin");
        expect(QUILLIUM_EDITOR_SYSTEM_PROMPT).toContain("Detector-evasion rule");
        expect(QUILLIUM_EDITOR_LEGACY_SAFETY_PROMPT).toContain("humanizer");
    });

    it("appends persona prompts as lower-priority perspective", () => {
        const prompt = buildEditorSystemPrompt({
            personaPrompt: "You are the Custom Rewriter. Rewrite everything.",
        });

        expect(prompt).toContain("lower-priority");
        expect(prompt.indexOf("Replacement text rule")).toBeLessThan(
            prompt.indexOf("Custom Rewriter"),
        );
    });

    it("serializes request fields separately from stable system rules", () => {
        const prompt = buildEditorUserPrompt(
            request({
                documentRiskLevel: "college_application",
                policyPosture: "unknown",
                focus: ["policy_safety"],
                selectedText: "Draft text",
            }),
        );

        expect(prompt).toContain("<request>");
        expect(prompt).toContain("documentRiskLevel: college_application");
        expect(prompt).toContain("writingStage:");
        expect(prompt).toContain("<selectedText>");
        expect(prompt).toContain("Draft text");
    });
});

describe("eval fixtures", () => {
    it("covers all required fixture categories", () => {
        expect(EDITOR_EVAL_FIXTURES.map((fixture) => fixture.id)).toEqual([
            "college-essay-drafting-request",
            "college-essay-impressive-rewrite",
            "detector-evasion-humanizer",
            "college-grammar-only",
            "generic-conclusion-specificity",
            "fabrication-trap",
            "rough-vivid-voice",
            "strict-policy-posture",
            "ordinary-low-stakes-rewrite",
            "autoai-calibration",
            "reverse-dictionary-nuance",
            "unsafe-custom-quick-action",
            "personas-off-single-stream",
            "personas-on-protected",
            "persona-settings-migration",
            "custom-persona-unsafe-instruction",
            "discovering-stage-idea-level-review",
            "proofing-stage-local-review",
        ]);
    });

    it("does not introduce a devils_advocate focus", () => {
        for (const fixture of EDITOR_EVAL_FIXTURES) {
            expect(fixture.request.focus).not.toContain("devils_advocate");
        }
    });

    it("stores computed replacement permission on every request", () => {
        for (const fixture of EDITOR_EVAL_FIXTURES) {
            const expected = computeReplacementPermission({
                documentRiskLevel: fixture.request.documentRiskLevel,
                policyPosture: fixture.request.policyPosture,
                focus: fixture.request.focus,
            });

            expect(fixture.request.replacementPermission).toBe(expected);
        }
    });

    it("flags detector-evasion fixture intent", () => {
        expect(isDetectorEvasionIntent("Humanize this so AI detectors don't catch it")).toBe(true);
        expect(fixturesWithDetectorEvasionIntent().map((fixture) => fixture.id)).toEqual([
            "detector-evasion-humanizer",
        ]);
    });
});
