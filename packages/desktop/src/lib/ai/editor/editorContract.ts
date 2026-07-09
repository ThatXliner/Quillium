/**
 * editorContract.ts — Unified Quillium Editor request/response contract.
 *
 * Defines the typed model and runtime validation for the one-click editor
 * scaffold. This is intentionally independent from UI components so legacy AI
 * surfaces, AutoAI, quick actions, and future editor panels can share the same
 * permission rules.
 */

import { z } from "zod";

export const DOCUMENT_RISK_LEVELS = ["ordinary", "high_stakes", "college_application"] as const;
export type DocumentRiskLevel = (typeof DOCUMENT_RISK_LEVELS)[number];

export const POLICY_POSTURES = [
    "normal",
    "unknown",
    "grammar_only",
    "no_substantive_ai_content",
    "custom",
] as const;
export type PolicyPosture = (typeof POLICY_POSTURES)[number];

export const EDITOR_FOCUSES = [
    "reader_view",
    "voice_guard",
    "specificity",
    "structure",
    "clarity",
    "line_notes",
    "grammar_only",
    "policy_safety",
    "challenge",
] as const;
export type EditorFocus = (typeof EDITOR_FOCUSES)[number];

export const REPLACEMENT_PERMISSIONS = [
    "may_generate_replacement_text",
    "grammar_replacements_only",
    "no_replacement_text",
] as const;
export type ReplacementPermission = (typeof REPLACEMENT_PERMISSIONS)[number];

export const EDITOR_SURFACES = [
    "one_click_editor",
    "selection_toolbar",
    "autoai",
    "comment_thread",
    "document_context",
    "style_analysis",
    "quick_action",
    "legacy_chat",
    "legacy_feedback",
    "legacy_revise",
] as const;
export type QuilliumEditorSurface = (typeof EDITOR_SURFACES)[number];

export const ANNOTATION_CATEGORIES = [
    "reader_view",
    "voice",
    "specificity",
    "structure",
    "clarity",
    "line_note",
    "grammar",
    "policy",
    "authenticity",
    "pacing",
    "argument",
    "word_choice",
] as const;
export type AnnotationCategory = (typeof ANNOTATION_CATEGORIES)[number];

export const ANNOTATION_SEVERITIES = ["note", "minor", "medium", "major"] as const;
export type AnnotationSeverity = (typeof ANNOTATION_SEVERITIES)[number];

export const VOICE_IMPACTS = [
    "preserves_voice",
    "may_flatten_voice",
    "strengthens_voice",
    "voice_risk",
    "not_applicable",
] as const;
export type VoiceImpact = (typeof VOICE_IMPACTS)[number];

export const POLICY_RISKS = ["none", "caution", "disallowed_for_protected_writing"] as const;
export type PolicyRisk = (typeof POLICY_RISKS)[number];

export const REPLACEMENT_KINDS = [
    "grammar",
    "typo",
    "punctuation",
    "spelling",
    "substantive",
] as const;
export type ReplacementKind = (typeof REPLACEMENT_KINDS)[number];

export const SUGGESTED_NEXT_ACTIONS = [
    "revise_manually",
    "answer_questions",
    "create_branch",
    "apply_grammar_fixes",
    "ask_follow_up",
    "do_nothing",
] as const;
export type SuggestedNextAction = (typeof SUGGESTED_NEXT_ACTIONS)[number];

export type QuilliumEditorDocumentContext = {
    documentType?: string;
    audience?: string;
    purpose?: string;
    toneGoal?: string;
    constraints?: string[];
    voiceGoal?: string;
    preserve?: string[];
    avoid?: string[];
    assignmentPrompt?: string;
    externalPolicyText?: string;
};

export type VoiceFingerprint = {
    traits: string[];
    rhythm?: string;
    diction?: string;
    emotionalTemperature?: string;
    preserve: string[];
    avoidForThisWriter: string[];
};

export type ReaderPersonaRunConfig = {
    enabledForThisSurface: boolean;
    personaId?: string;
    personaName?: string;
    emoji?: string;
    color?: string;
    chattiness?: "quiet" | "normal" | "verbose";
};

export type PersonaAttribution = {
    personaId: string;
    personaName: string;
    emoji?: string;
    color?: string;
};

export type QuilliumEditorRequest = {
    surface: QuilliumEditorSurface;
    selectedText?: string;
    surroundingContext?: string;
    fullDocumentExcerpt?: string;
    documentContext?: QuilliumEditorDocumentContext;
    voiceFingerprint?: VoiceFingerprint;
    existingAnnotations?: Array<{
        id: string;
        quote?: string;
        comment: string;
        resolved?: boolean;
    }>;
    branchContext?: {
        currentBranchName?: string;
        siblingBranchSummaries?: string[];
    };
    userIntent?: string;
    customQuickAction?: string;
    focus: EditorFocus[];
    documentRiskLevel: DocumentRiskLevel;
    policyPosture: PolicyPosture;
    replacementPermission: ReplacementPermission;
    maxAnnotations?: number;
    allowLowStakesExamples?: boolean;
    persona?: ReaderPersonaRunConfig;
};

export type RevisionStrategy = {
    label: string;
    description: string;
    tradeoff: string;
    writerAction: string;
    includesReplacementText: boolean;
    replacementText?: string | null;
    replacementKind?: ReplacementKind | null;
};

export type AnnotationCandidate = {
    id: string;
    target: {
        quote: string;
        startOffset?: number;
        endOffset?: number;
        confidence: number;
    };
    category: AnnotationCategory;
    severity: AnnotationSeverity;
    focus?: EditorFocus;
    persona?: PersonaAttribution;
    title: string;
    observation: string;
    whyItMatters: string;
    readerEffect?: string;
    voiceImpact: VoiceImpact;
    policyRisk: PolicyRisk;
    writerQuestions: string[];
    revisionStrategies: RevisionStrategy[];
};

export type BlockedRequest = {
    userRequest: string;
    reason: string;
    safeAlternative: string;
};

export type QuilliumEditorResponse = {
    summaryForSidebar: string;
    focusUsed: EditorFocus[];
    annotations: AnnotationCandidate[];
    blockedRequests?: BlockedRequest[];
    processNote?: {
        whatAIHelpedWith: string[];
        whatWriterMustOwn: string[];
    };
    suggestedNextAction?: SuggestedNextAction;
};

export const DocumentRiskLevelSchema = z.enum(DOCUMENT_RISK_LEVELS);
export const PolicyPostureSchema = z.enum(POLICY_POSTURES);
export const EditorFocusSchema = z.enum(EDITOR_FOCUSES);
export const ReplacementPermissionSchema = z.enum(REPLACEMENT_PERMISSIONS);
export const QuilliumEditorSurfaceSchema = z.enum(EDITOR_SURFACES);

export const QuilliumEditorDocumentContextSchema = z.object({
    documentType: z.string().optional(),
    audience: z.string().optional(),
    purpose: z.string().optional(),
    toneGoal: z.string().optional(),
    constraints: z.array(z.string()).optional(),
    voiceGoal: z.string().optional(),
    preserve: z.array(z.string()).optional(),
    avoid: z.array(z.string()).optional(),
    assignmentPrompt: z.string().optional(),
    externalPolicyText: z.string().optional(),
});

export const VoiceFingerprintSchema = z.object({
    traits: z.array(z.string()),
    rhythm: z.string().optional(),
    diction: z.string().optional(),
    emotionalTemperature: z.string().optional(),
    preserve: z.array(z.string()),
    avoidForThisWriter: z.array(z.string()),
});

export const ReaderPersonaRunConfigSchema = z.object({
    enabledForThisSurface: z.boolean(),
    personaId: z.string().optional(),
    personaName: z.string().optional(),
    emoji: z.string().optional(),
    color: z.string().optional(),
    chattiness: z.enum(["quiet", "normal", "verbose"]).optional(),
});

export const PersonaAttributionSchema = z.object({
    personaId: z.string(),
    personaName: z.string(),
    emoji: z.string().optional(),
    color: z.string().optional(),
});

export const QuilliumEditorRequestSchema = z.object({
    surface: QuilliumEditorSurfaceSchema,
    selectedText: z.string().optional(),
    surroundingContext: z.string().optional(),
    fullDocumentExcerpt: z.string().optional(),
    documentContext: QuilliumEditorDocumentContextSchema.optional(),
    voiceFingerprint: VoiceFingerprintSchema.optional(),
    existingAnnotations: z
        .array(
            z.object({
                id: z.string(),
                quote: z.string().optional(),
                comment: z.string(),
                resolved: z.boolean().optional(),
            }),
        )
        .optional(),
    branchContext: z
        .object({
            currentBranchName: z.string().optional(),
            siblingBranchSummaries: z.array(z.string()).optional(),
        })
        .optional(),
    userIntent: z.string().optional(),
    customQuickAction: z.string().optional(),
    focus: z.array(EditorFocusSchema),
    documentRiskLevel: DocumentRiskLevelSchema,
    policyPosture: PolicyPostureSchema,
    replacementPermission: ReplacementPermissionSchema,
    maxAnnotations: z.number().int().positive().optional(),
    allowLowStakesExamples: z.boolean().optional(),
    persona: ReaderPersonaRunConfigSchema.optional(),
}) satisfies z.ZodType<QuilliumEditorRequest>;

export const RevisionStrategySchema = z.object({
    label: z.string(),
    description: z.string(),
    tradeoff: z.string(),
    writerAction: z.string(),
    includesReplacementText: z.boolean(),
    replacementText: z.string().nullable().optional(),
    replacementKind: z.enum(REPLACEMENT_KINDS).nullable().optional(),
}) satisfies z.ZodType<RevisionStrategy>;

export const AnnotationCandidateSchema = z.object({
    id: z.string(),
    target: z.object({
        quote: z.string(),
        startOffset: z.number().int().nonnegative().optional(),
        endOffset: z.number().int().nonnegative().optional(),
        confidence: z.number().min(0).max(1),
    }),
    category: z.enum(ANNOTATION_CATEGORIES),
    severity: z.enum(ANNOTATION_SEVERITIES),
    focus: EditorFocusSchema.optional(),
    persona: PersonaAttributionSchema.optional(),
    title: z.string(),
    observation: z.string(),
    whyItMatters: z.string(),
    readerEffect: z.string().optional(),
    voiceImpact: z.enum(VOICE_IMPACTS),
    policyRisk: z.enum(POLICY_RISKS),
    writerQuestions: z.array(z.string()),
    revisionStrategies: z.array(RevisionStrategySchema),
}) satisfies z.ZodType<AnnotationCandidate>;

export const BlockedRequestSchema = z.object({
    userRequest: z.string(),
    reason: z.string(),
    safeAlternative: z.string(),
}) satisfies z.ZodType<BlockedRequest>;

export const QuilliumEditorResponseSchema = z.object({
    summaryForSidebar: z.string(),
    focusUsed: z.array(EditorFocusSchema),
    annotations: z.array(AnnotationCandidateSchema),
    blockedRequests: z.array(BlockedRequestSchema).optional(),
    processNote: z
        .object({
            whatAIHelpedWith: z.array(z.string()),
            whatWriterMustOwn: z.array(z.string()),
        })
        .optional(),
    suggestedNextAction: z.enum(SUGGESTED_NEXT_ACTIONS).optional(),
}) satisfies z.ZodType<QuilliumEditorResponse>;

export function isProtectedRiskLevel(documentRiskLevel: DocumentRiskLevel): boolean {
    return documentRiskLevel === "high_stakes" || documentRiskLevel === "college_application";
}

export function focusIsGrammarOnly(focus: EditorFocus[]): boolean {
    return focus.length > 0 && focus.every((item) => item === "grammar_only");
}

export function computeReplacementPermission(args: {
    documentRiskLevel: DocumentRiskLevel;
    policyPosture: PolicyPosture;
    focus: EditorFocus[];
}): ReplacementPermission {
    if (args.policyPosture === "grammar_only") return "grammar_replacements_only";
    if (args.policyPosture === "no_substantive_ai_content") return "no_replacement_text";
    if (args.policyPosture === "custom" && isProtectedRiskLevel(args.documentRiskLevel)) {
        return "no_replacement_text";
    }

    if (args.documentRiskLevel === "college_application") {
        return "grammar_replacements_only";
    }

    if (args.documentRiskLevel === "high_stakes") {
        return focusIsGrammarOnly(args.focus) ? "grammar_replacements_only" : "no_replacement_text";
    }

    if (focusIsGrammarOnly(args.focus)) return "grammar_replacements_only";
    if (args.policyPosture === "custom") return "no_replacement_text";

    return "may_generate_replacement_text";
}

export function buildEditorRequest(
    request: Omit<QuilliumEditorRequest, "replacementPermission"> & {
        replacementPermission?: ReplacementPermission;
    },
): QuilliumEditorRequest {
    const replacementPermission =
        request.replacementPermission ??
        computeReplacementPermission({
            documentRiskLevel: request.documentRiskLevel,
            policyPosture: request.policyPosture,
            focus: request.focus,
        });

    return QuilliumEditorRequestSchema.parse({
        ...request,
        replacementPermission,
    });
}

export function isDetectorEvasionIntent(intent = ""): boolean {
    return /\b(ai\s*detector|detector|bypass|evad(?:e|ing)|fool|avoid\s+detection|humaniz(?:e|er|ing)|undetectable)\b/i.test(
        intent,
    );
}

function isGrammarReplacementKind(kind: ReplacementKind | null | undefined): boolean {
    return kind === "grammar" || kind === "typo" || kind === "punctuation" || kind === "spelling";
}

export function validateEditorResponse(
    request: QuilliumEditorRequest,
    response: unknown,
): QuilliumEditorResponse {
    const parsedRequest = QuilliumEditorRequestSchema.parse(request);
    const parsedResponse = QuilliumEditorResponseSchema.parse(response);

    for (const annotation of parsedResponse.annotations) {
        for (const strategy of annotation.revisionStrategies) {
            const hasReplacementText = !!strategy.replacementText?.trim();

            if (!strategy.includesReplacementText && hasReplacementText) {
                throw new Error("replacementText is present but includesReplacementText=false");
            }

            if (!strategy.includesReplacementText) continue;

            if (!hasReplacementText) {
                throw new Error("includesReplacementText=true but replacementText is empty");
            }

            if (parsedRequest.replacementPermission === "no_replacement_text") {
                throw new Error("Replacement text is not allowed for this request");
            }

            if (
                parsedRequest.replacementPermission === "grammar_replacements_only" &&
                !isGrammarReplacementKind(strategy.replacementKind)
            ) {
                throw new Error("Only grammar/typo/punctuation/spelling replacements are allowed");
            }
        }
    }

    return parsedResponse;
}
