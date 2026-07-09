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

Design around one primary Quillium action. Do not expose Chat, Feedback, Revise,
AutoAI, or editorial focus as competing top-level modes. The normal flow is:

1. infer the writing stage;
2. derive a small internal review plan;
3. accept an optional specific concern from the writer;
4. return a few anchored margin notes.

Writing stages are:

- Discovering: idea validation, promising material, generative questions.
- Shaping: structure, sequence, stakes, paragraph purpose, specificity.
- Refining: clarity, pacing, voice consistency, specificity, line friction.
- Proofing: grammar, punctuation, consistency, settled local wording.

Default the stage to Auto, show the inference unobtrusively, and allow an override. Do
not infer stage from grammar quality alone. Visible process signals, document completeness,
structure, placeholders, and revision activity are stronger evidence.

The following focuses remain internal orchestration vocabulary, not a required toggle wall:

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

Natural-language input is optional and should refine the inferred plan. Chat transcripts
are not the default output surface; conversation belongs inside a selection or annotation
thread when a writer has a specific follow-up.

## Quiet Review

AutoAI is the automatic trigger for the same Quillium editor, not a separate product or
prompt contract. Keep its primary controls to on/off, Auto stage with an override, and
Review now. Cadence, annotation type, depth, and annotation budget are internal decisions.
Wait for a meaningful writing pause, review recent changes in whole-document context, and
prefer one to three nonduplicate notes.

## Writing Brief

Document Context is a writer-owned brief, not prompt engineering. Prefer a few optional,
plain-language fields: document kind, audience, intended reader effect, requirements, and
what must remain intact. Use document kind to infer protected-writing risk conservatively.
Keep unusual notes in one advanced freeform field.

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
- Writing brief: `packages/desktop/src/lib/ai/DocumentContext.svelte`
- Legacy streams: `packages/desktop/src/lib/ai/clientStreams.ts`
- Persona prompts: `packages/desktop/src/lib/readers/prompt.ts`
