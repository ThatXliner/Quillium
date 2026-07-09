# Quillium Review Surface

The AI sidebar exposes one primary action: ask Quillium to review the current selection or
draft. Chat, Feedback, and Revise are no longer competing top-level modes. The model returns
a structured response and the useful work appears as anchored margin annotations.

## Primary Flow

1. `EditorReview.svelte` uses the writing stage selected by the writer.
2. The writer can adjust a compact set of editorial focus controls.
3. An optional writer instruction can narrow the plan, such as “grammar only” or “look at
   the structure.”
4. `reviewEngine.ts` runs `generateObject()` against `QuilliumEditorResponseSchema`.
5. The response is validated against replacement permissions and applied as comments or
   suggestions.
6. The sidebar shows only a short completion summary; feedback lives in the manuscript.

The visible stage choices are Auto-detect, Discovering, Shaping, Refining, and Proofing.
Refining is the default for manual review. If the writer chooses Auto-detect, the resolved
stage is shown; AutoAI also infers a stage when it runs in the background.

## Secondary Screens

The sidebar uses a data-driven horizontal action strip that remains scrollable even while it
is short. It contains:

- **Quillium** (`EditorReview.svelte`): stage, focus, saved prompts, safeguards, and review.
- **Document Context** (`DocumentContext.svelte`): generated/freeform context, document kind,
  audience, intended reader effect, requirements, material to preserve, and custom editor
  instructions.
- **Reader perspectives** (`Readers.svelte`): configure optional Reader Personas.
- **Settings**: provider, model, API key, and custom quick actions.

These are supporting workspaces around one editorial contract, not duplicate Chat,
Feedback, and Revise modes.

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
- `ai_editor_stage_changed`: records a writing-stage selection.

## Legacy Components

`Chat.svelte`, `Feedback.svelte`, `Revise.svelte`, and their streams remain in the codebase
for annotation-thread and compatibility paths, but they are not primary navigation.
