---
name: quillium-ai-overhaul
description: Use when editing or designing Quillium AI prompts, schemas, evals, model harnesses, annotation behavior, college-application safeguards, voice-preserving writing assistance, or the unified one-click AI editor UX.
---

# Quillium AI Overhaul Skill

## Mission

Quillium AI should make the writer more aware, not more replaceable.

The product principle is:

> AI may help the writer see, question, diagnose, compare, and decide. It must not
> secretly become the writer.

Use this skill whenever work touches AI behavior, AI prompts, AI UI, AI output schemas,
AutoAI, writing feedback, revision suggestions, style analysis, reverse dictionary, quick
actions, document context, or high-stakes writing safety.

## Core Doctrine

AI lives in the margin, not in the prose.

Quillium AI may notice, ask, diagnose, compare, challenge, summarize reader experience,
explain tradeoffs, identify specificity gaps, protect voice, protect high-stakes writing
integrity, and create structured annotations, cards, comments, and branch suggestions.

Quillium AI must not silently modify document prose, become the hidden author, invent
personal details or evidence, flatten voice into generic polish, produce detector-evasion
or humanizer behavior, bypass institutional AI-use rules, or generate application-ready
college essay prose in protected modes.

## Product Direction

Prefer a unified editor interaction over separate user-facing modes. The default mental
model should be:

> The writer asks Quillium to look at the writing. Quillium returns useful margin notes,
> questions, and revision paths.

Design around one primary Quillium review action. Do not expose Chat, Feedback, and Revise
as competing top-level modes. Simplification means consolidating duplicate jobs, not hiding
controls writers already understand. The normal manual flow is:

1. let the writer choose the writing stage or explicitly choose transparent auto-detection;
2. let the writer select or adjust the review focuses;
3. accept an optional specific concern from the writer;
4. return a few anchored margin notes.

Writing stages are:

- Discovering: idea validation, promising material, generative questions.
- Shaping: structure, sequence, stakes, paragraph purpose, specificity.
- Refining: clarity, pacing, voice consistency, specificity, line friction.
- Proofing: grammar, punctuation, consistency, settled local wording.

AutoAI may infer stage internally to choose an appropriate pass. Manual review should keep
the stage control explicit and show the resolved stage when Auto is selected. Never infer stage from
grammar quality alone. Visible process signals, document completeness, structure,
placeholders, and revision activity are stronger evidence.

The following focuses are contract vocabulary and may be exposed as compact, progressively
disclosed controls:

- Reader View
- Voice Guard
- Specificity
- Structure
- Clarity
- Line Notes
- Grammar Only
- Policy Safety
- Challenge

Do not call the focus `Devil's Advocate`; that name belongs to a Reader Persona.

Natural-language input is optional and should refine the selected plan. Chat transcripts
are not the default output surface; conversation belongs inside a selection or annotation
thread when a writer has a specific follow-up.

## Quiet Review

AutoAI is an automatic trigger for the same Quillium editor contract, while retaining the
controls writers use to understand and constrain automation: on/off, automatic/manual,
delay, annotation forms, review depth, reviewer name, and Review now. The engine may infer
stage and allocate annotation budget within those explicit bounds. Wait for a meaningful
writing pause, review recent changes in whole-document context, and avoid duplicate notes.

## Writing Brief

Document Context is a writer-owned workspace. Preserve the useful freeform context and
context-generation flow, then offer optional structured fields for document kind, audience,
intended reader effect, requirements, and what must remain intact. Writers may also supply
custom editor instructions and saved review prompts. Treat customization as lower-priority
preferences that cannot override authorship, safety, replacement-permission, or schema rules.

## UX Invariants

- Keep the sidebar action registry horizontally scrollable and data-driven so supporting
  tools can be added without rebuilding the shell.
- Use review templates for the primary dropdown. A template groups a stage, focus bundle,
  and editorial instruction; stage and focus may remain editable under advanced settings.
- Keep API-key-dependent actions visible but disabled and clearly grayed out when
  unavailable. Keep the Settings path available for setup.
- Size collapsed and expanded sidebar states to their actual controls or panel needs. Do not
  reserve the tallest panel height for every view or leave decorative dead space below tools.
- Match the established compact, translucent Quillium controls instead of introducing a
  generic chat transcript as the primary writing workflow.
- Never animate a morphing container to or from `rounded-full`, `9999px`, or another
  effectively infinite radius. Use a finite collapsed radius equal to half the collapsed
  dimension (for example, `33.5px` for a `67px` AutoAI bubble). Infinite radii can snap at
  the end of WebKit interpolation and visibly break the morph animation.

## Reader Personas

Reader Personas are configurable AI reader identities. Preserve the distinction:

```text
Internal focus plan = what to inspect.
Reader Personas = who is reading.
Internal specialists = how the prompt/orchestrator may organize work.
Codex subagents = how Codex may split repo-development tasks.
```

Personas fan out into one model stream per enabled persona, so they cost roughly `N x`
tokens. Keep them explicit, per-surface opt-in, default off. For the unified editor, use
`personaModes.editor`, defaulting to `false`, and preserve existing `feedback` and
`revise` settings.

Persona prompts may affect perspective and tone, but must not override high-stakes safety,
no-ghostwriting, no-fabrication, replacement-permission, schema-validity, or
detector-evasion rules.

## Protected Writing

Treat college applications, scholarship essays, personal statements, contest submissions,
graded writing, legal/medical/financial self-representation, and identity-based personal
writing as protected unless explicitly classified otherwise.

Protected writing may receive grammar and typo fixes, prompt interpretation, brainstorming
questions, clarity diagnosis, reader-view feedback, structure concerns, specificity prompts,
authenticity warnings, and revision strategies the writer must execute.

Protected writing must not receive full drafts, paragraph rewrites, substantive sentence
rewrites, application-ready language, fabricated details, translated essay prose presented
as the writer's own, upgraded tone/voice/personality, or detector-evasion behavior.

## Prompt Design Rules

1. Separate stable developer rules from task input.
2. Keep user/document data in typed fields.
3. Use explicit document risk levels and policy postures.
4. Prefer verbs like notice, diagnose, ask, flag, compare, explain.
5. Avoid vague verbs like improve, polish, humanize, upgrade, make impressive.
6. Require output to be schema-valid and renderable as annotations.
7. Disallow raw prose blobs except in low-risk contexts where replacement text is
   explicitly permitted.
8. Add or update eval fixtures with prompt changes.

## Code Entry Points

- Contract: `packages/desktop/src/lib/ai/editor/editorContract.ts`
- Prompt: `packages/desktop/src/lib/ai/editor/editorPrompt.ts`
- Fixtures: `packages/desktop/src/lib/ai/editor/evalFixtures.ts`
- Persona modes: `packages/desktop/src/lib/ai/settings.svelte.ts`
- Shared review runner: `packages/desktop/src/lib/ai/editor/reviewEngine.ts`
- Quiet review: `packages/desktop/src/lib/autoai/engine.ts`
- Document Context: `packages/desktop/src/lib/ai/DocumentContext.svelte`
- Legacy streams: `packages/desktop/src/lib/ai/clientStreams.ts`
- Persona prompts: `packages/desktop/src/lib/readers/prompt.ts`
