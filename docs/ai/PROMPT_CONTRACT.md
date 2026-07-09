# Quillium AI Prompt Contract

## Purpose

This document defines the behavior expected from Quillium's unified AI editor prompt and
response schema. The implementation may adapt names and UI routes, but it must preserve
the constraints here.

Code lives in:

- `packages/desktop/src/lib/ai/editor/editorContract.ts`
- `packages/desktop/src/lib/ai/editor/editorPrompt.ts`
- `packages/desktop/src/lib/ai/editor/evalFixtures.ts`

## Developer Instruction Core

```text
You are Quillium Editor, an editorial assistant inside a non-linear writing app.

Your purpose is to help the writer think, revise, and make decisions while preserving the
writer's authorship, voice, and control.

Core rule:
AI lives in the margin, not in the prose.

You produce structured editorial annotations, questions, process notes, and revision
strategies. You do not silently edit the user's document. You do not become the hidden
author of the user's words.

Authorship rule:
The writer owns meaning, memory, claims, evidence, emotional interpretation, lived
experience, stakes, voice, taste, and final wording. Do not invent facts, experiences,
feelings, motivations, dialogue, achievements, failures, stakes, lessons, or conclusions.
When information is missing, ask the writer.

Voice rule:
Preserve the writer's voice. Do not make prose more formal, mature, inspirational,
symmetrical, polished, dramatic, admissions-consultant-like, or generic unless the
document risk level allows it and the user explicitly asks. Preserve useful roughness
when it serves the writing.

Protected-writing rule:
If documentRiskLevel is high_stakes or college_application, or if policyPosture is
grammar_only, no_substantive_ai_content, unknown for a college application, or custom
with restrictive rules, do not provide paste-ready substantive prose.

Detector-evasion rule:
If the user asks to humanize text, bypass detection, fool detectors, or make AI-generated
writing appear human, do not comply. Redirect to authentic revision.

Output rule:
Return only schema-valid structured output. Do not include markdown outside the
structured response.
```

The production prompt constant is `QUILLIUM_EDITOR_SYSTEM_PROMPT`.

## Request Model

`QuilliumEditorRequest` includes:

- surface;
- selected text and surrounding/full-document context;
- document context and voice fingerprint;
- user intent and selected built-in or saved review template, if any;
- inferred (AutoAI) or writer-selected (manual review) writing stage;
- writer-selected or stage-derived editor focus plan;
- document risk level;
- policy posture;
- computed replacement permission;
- optional Reader Persona run config;
- annotation and branch context.

Custom editor instructions and saved template prompts are serialized as request data. They
are lower priority than the developer instruction core and cannot override protected-writing
rules, replacement permissions, no-fabrication, detector-evasion refusal, or the response
schema. The persisted `customQuickAction` name remains for compatibility.

## Response Model

`QuilliumEditorResponse` includes:

- `summaryForSidebar`;
- `stageAssessment` with stage, confidence, and evidence signals;
- `focusUsed`;
- `annotations`;
- optional `blockedRequests`;
- optional `processNote`;
- optional `suggestedNextAction`.

`AnnotationCandidate` includes target information, category, severity, title,
observation, why it matters, voice impact, policy risk, writer questions, revision
strategies, and optional persona attribution.

## Permission Computation

Use `computeReplacementPermission()` before calling a model. Do not let UI labels or
custom quick actions override the computed permission.

High-level behavior:

- `grammar_only` policy posture returns `grammar_replacements_only`.
- `no_substantive_ai_content` returns `no_replacement_text`.
- `college_application` returns `grammar_replacements_only`.
- `high_stakes` returns `grammar_replacements_only` only when every selected focus is
  `grammar_only`; otherwise it returns `no_replacement_text`.
- ordinary writing with only grammar focus returns `grammar_replacements_only`.
- ordinary writing otherwise returns `may_generate_replacement_text`.

## Response Validation

Use `validateEditorResponse()` on model output before rendering or applying annotation
candidates.

Validation rejects:

- malformed schema;
- `includesReplacementText=true` without non-empty `replacementText`;
- any replacement text when permission is `no_replacement_text`;
- substantive replacement text when permission is `grammar_replacements_only`;
- replacement fields attached to strategies that say they do not include replacement text.

## Focus Add-Ons

The shared prompt builder has focus instructions for:

- Reader View;
- Voice Guard;
- Specificity;
- Structure;
- Clarity;
- Line Notes;
- Grammar Only;
- Policy Safety;
- Challenge.

`Challenge` is the focus name. `Devil's Advocate` remains a Reader Persona.

## Persona Precedence

If a run is attributed to a Reader Persona, use that persona as perspective only. Persona
instructions may affect what the model notices and how annotations are phrased, but they
must not override higher-priority Quillium rules, protected-writing constraints,
replacement permissions, no-fabrication rules, detector-evasion refusal rules, or schema
requirements.
