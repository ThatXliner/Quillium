# Quillium Review Surface

The AI sidebar exposes one primary action: ask Quillium to review the current selection or
draft. Chat, Feedback, and Revise are no longer competing top-level modes. The model returns
a structured response and the useful work appears as anchored margin annotations.

## Primary Flow

1. The primary dropdown selects a review template: Balanced review, Develop ideas,
   Structure & flow, Voice & clarity, Line edit, Proofread, or a saved custom template.
2. Each built-in template selects a writing stage, focus bundle, and editorial instruction.
3. The writer can adjust stage and focus under Review settings, which changes the selector
   to Custom setup.
4. An optional writer instruction can narrow the plan, such as “grammar only” or “look at
   the structure.”
5. `reviewEngine.ts` runs `generateObject()` against `QuilliumEditorResponseSchema`.
6. The response is validated against replacement permissions and applied as comments or
   suggestions.
7. The sidebar shows only a short completion summary; feedback lives in the manuscript.

Balanced review is the default template and uses transparent stage detection. The stage
choices remain Auto-detect, Discovering, Shaping, Refining, and Proofing under Review
settings. If the writer chooses Auto-detect, the resolved stage is shown.

## Secondary Screens

The sidebar uses a data-driven horizontal action strip that remains scrollable even while it
is short. It contains:

- **Quillium** (`EditorReview.svelte`): review templates, stage, focus, safeguards, and review.
- **Document Context** (`DocumentContext.svelte`): generated/freeform context, document kind,
  audience, intended reader effect, requirements, material to preserve, and custom editor
  instructions.
- **Reader perspectives** (`Readers.svelte`): configure optional Reader Personas.
- **Settings**: provider, model, API key, and custom AI templates.

These are supporting workspaces around one editorial contract, not duplicate Chat,
Feedback, and Revise modes.

Quillium remains visible but disabled and grayed out when no API key is configured; the
Settings gear remains available for setup. The collapsed rail is sized to its four controls,
and expanded panels use panel-specific heights rather than reserving the tallest possible
shell for every screen.

## Structured Runner

`src/lib/ai/editor/reviewEngine.ts` is shared by manual review and quiet AutoAI review. It:

- uses the unified system and user prompt builders;
- validates the response with the editor contract;
- rejects disallowed replacement text;
- verifies that target quotes exist in the live document;
- creates suggestions when replacement text is permitted;
- otherwise creates comments with observations, questions, and writer-executed strategies.

Reader Personas run the same structured request in parallel when `personaModes.editor` is
enabled. Persona prompts remain lower priority than safety and schema rules.

## Events And Shortcuts

- `Mod-Shift-1/2/3`: open Quillium, Document Context, or Reader Perspectives.
- `ai-open-chat`: compatibility event that now opens Quillium.
- `ai-open-settings`: opens provider/model settings.
- `ai_editor_requested`: records writer-selected stage/focus, risk, policy, and persona count.
- `ai_editor_template_changed`: records a built-in, saved, or custom review template.
- `ai_editor_stage_changed`: records a writing-stage selection.

## Legacy Components

`Chat.svelte`, `Feedback.svelte`, `Revise.svelte`, and their streams remain in the codebase
for annotation-thread and compatibility paths, but they are not primary navigation.
