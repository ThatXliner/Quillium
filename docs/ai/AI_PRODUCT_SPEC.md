# Quillium AI Product Spec: Unified Editor

## Summary

Evolve Quillium's AI from separate user-facing modes into one editor-in-the-margin
experience.

The writer should not need to decide first whether they want Chat, Feedback, or Revise.
They ask Quillium to look at the writing, choose the draft stage and editorial focuses they
care about, optionally name a specific concern, and receive structured margin notes.

Core UX principle:

> One editor. Many lenses. No ghostwriting.

## Current Model

The current desktop app already has useful building blocks:

- `packages/desktop/src/lib/ai/clientStreams.ts` defines Chat, Feedback, Revise,
  dictionary, context generation, and style characterization prompts.
- `packages/desktop/src/lib/ai/chatFactory.ts` routes AI tool calls into annotation
  helpers such as `createComment`, `createSuggestion`, and `createRevision`.
- `packages/desktop/src/lib/autoai/engine.ts` performs a non-streaming structured review
  and applies annotations.
- Reader Personas live in `packages/desktop/src/lib/readers/*` and are opt-in per mode
  through `personaModes`.

The unified editor should reuse those pieces but centralize prompt rules, request/response
types, replacement permissions, and protected-writing validation.

## Primary Interaction

Candidate entry points:

- selection toolbar: `Ask Editor`;
- AI sidebar primary tab: `Review with Quillium`;
- command palette: `Ask Quillium to look at this`;
- AutoAI prompt: `Review recent changes`;
- annotation thread: `Ask Editor about this comment`.

The editor can operate on:

- selected text;
- current paragraph;
- current branch;
- section;
- whole document;
- recent changes since last review;
- an annotation thread.

The primary dropdown contains review templates that group a stage, focus bundle, and
editorial instruction. Balanced review is the default; other built-ins cover idea
development, structure, voice and clarity, line editing, and proofreading. Saved custom
prompts appear in the same selector. Feedback appears in the margin, not as a chat transcript.

## Writing Stage

- `discovering`: idea validation, promising material, generative questions.
- `shaping`: structure, sequence, stakes, paragraph purpose, specificity.
- `refining`: clarity, pacing, specificity, voice consistency, line friction.
- `proofing`: grammar, punctuation, consistency, settled local wording.

Balanced review defaults to explicit Auto-detect. When Auto-detect is selected, the resolved
stage is shown. Writers can change stage and focus under Review settings, which makes the
current configuration a Custom setup. AutoAI inference uses visible process signals,
completeness, placeholders, outlines, and structure. It must not
equate intentional roughness or unusual grammar with an early draft. The model confirms or
corrects the stage in `stageAssessment`.

## Internal Focus Plan

Focus values answer what the editor should inspect. They are exposed in compact progressive
disclosure and remain the vocabulary used by the prompt contract:

- `reader_view`: what a reader understands, misunderstands, or expects next.
- `voice_guard`: what sounds like the writer, what sounds generic, and what may be
  over-polished.
- `specificity`: missing scene, action, stakes, concrete detail, dialogue, or evidence.
- `structure`: thesis, progression, paragraph purpose, pacing, transitions, and ending.
- `clarity`: confusing claims, overloaded sentences, ambiguous references, and missing
  links.
- `line_notes`: sentence-level issues, with replacement text governed by risk level.
- `grammar_only`: spelling, punctuation, grammar, and typos.
- `policy_safety`: college-application and other high-stakes AI-use constraints.
- `challenge`: candid pushback on contradictions, unsupported claims, and weak evidence.

Use `Challenge`, not `Devil's Advocate`, for the focus label. Quillium already has a
`Devil's Advocate` Reader Persona; internal focus plans and personas must stay separate.

## Risk Levels

`ordinary` examples: blog drafts, notes, low-stakes emails, fiction experiments, and
personal drafts not being submitted as original work.

`high_stakes` examples: scholarship essays, graded writing, contest submissions,
professional statements, and identity-based essays.

`college_application` is the most restrictive mode. It allows grammar, prompt
interpretation, brainstorming questions, reader-view feedback, specificity prompts,
structure concerns, voice warnings, and process notes. It disallows drafts, paragraph
rewrites, substantive sentence rewrites, application-ready prose, invented details,
translated essay prose, tone replacement, and detector evasion.

## Policy Posture

Risk level describes the document. Policy posture describes external rules.

- `normal`: ordinary rules apply.
- `unknown`: be conservative.
- `grammar_only`: only grammar/spelling/punctuation/typo fixes.
- `no_substantive_ai_content`: feedback/questions only; no substantive AI language.
- `custom`: user has entered institution-specific policy text.

When policy posture is unknown for a college application, behave conservatively.

## Output Model

The unified editor should return structured objects, not prose blobs:

- sidebar summary;
- focus areas used;
- annotation candidates;
- process note;
- blocked requests;
- suggested next action.

Each annotation should contain:

- target quote or range;
- category;
- severity;
- observation;
- why it matters;
- reader effect;
- voice impact;
- policy risk;
- writer questions;
- revision strategies;
- replacement text only when allowed.

The TypeScript/Zod scaffold lives in
`packages/desktop/src/lib/ai/editor/editorContract.ts`.

## Replacement Permissions

Compute an explicit permission:

- `may_generate_replacement_text`;
- `grammar_replacements_only`;
- `no_replacement_text`.

Rules:

- `grammar_only` policy posture means grammar replacements only.
- `no_substantive_ai_content` means no replacement text.
- `college_application` means grammar replacements only.
- `high_stakes` means grammar replacements only for grammar-only focus, otherwise no
  replacement text.
- saved templates cannot override protected-mode restrictions.

## Reader Personas

Reader Personas answer: who is reading?

The default editor flow should not run personas. If the unified editor supports personas,
it must be an explicit advanced opt-in through `personaModes.editor`, defaulting to
`false`. Each persona receives the same editor request, focus plan, risk level,
policy posture, replacement permission, and schema constraints. Persona prompts may change
perspective but cannot override protected-writing safety or schema validity.

See `docs/ai/READER_PERSONAS_INTEGRATION.md`.

## Quiet Review

AutoAI is the automatic trigger for the same structured editor. It waits for a meaningful
pause and reviews recent changes in whole-document context. Writers control on/off,
continuous/manual mode, delay, annotation forms, review depth, reviewer name, and Review
now. The selected depth sets the annotation budget; the engine still avoids duplicate notes.

## Writing Brief

Document Context is a writer-owned workspace:

- document kind;
- audience;
- intended reader effect;
- requirements;
- material to preserve;
- generated or freeform context;
- optional custom editor instructions.

Document kind informs protected-writing risk. Custom instructions and saved review prompts
are preferences, not replacements for the stable system prompt, and cannot override safety,
authorship, replacement permissions, or schema constraints.

## Implementation

1. Docs and contracts: philosophy, product spec, prompt contract, eval plan, skill,
   repo guidance.
2. Types and validation: request/response types, permission computation,
   high-stakes replacement validation, fixtures.
3. Prompt harness: shared unified editor prompt builder and compatibility guidance for
   legacy Chat/Feedback/Revise.
4. UX: one Quillium review entry point, template dropdown, editable stage and focus, optional
   instruction, and an extensible context/persona/settings strip.
5. Quiet Review: shared structured runner, meaningful-pause orchestration, recent-change
   context, and explicit automation controls.

## Open Decisions

- Should protected mode also inspect assignment-prompt text, beyond document kind?
- Should custom school policies be pasted into document context?
- Should branch creation be the default action for substantive revision suggestions?
- Should specialist passes be one model call or multiple calls?

Recommendation: start with one orchestrator call, structured outputs, and validation.
Only split into true multi-call agents after evals show that a single call cannot produce
reliable enough results.
