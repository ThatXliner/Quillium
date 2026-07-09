# Reader Personas Integration

## Purpose

Quillium already has Reader Personas. Do not confuse them with:

1. Editor focus toggles: what the AI should inspect.
2. Internal specialist passes: implementation details inside the prompt or orchestrator.
3. Codex subagents: development-time workers used to inspect or modify the repo.

Reader Personas are a product feature: configurable AI readers that provide feedback from
distinct reader identities.

## Core Distinction

```text
Editor focus = what to look for.
Reader persona = who is looking.
Runtime specialist = how the system may implement the work.
Codex subagent = how Codex may split repository-development work.
```

Examples:

- `Voice Guard` is a focus.
- `First-Time Reader` is a persona.
- `Policy Gate` is an internal specialist concept.
- A Codex subagent is not a Quillium product feature.

## Existing Feature To Preserve

| File | Purpose |
|------|---------|
| `packages/desktop/src/lib/readers/presets.ts` | `ReaderPersona` type, `DEFAULT_PERSONAS` |
| `packages/desktop/src/lib/readers/settings.svelte.ts` | Persona list store, localStorage persistence |
| `packages/desktop/src/lib/readers/prompt.ts` | `buildPersonaPrompt()` |
| `packages/desktop/src/lib/readers/colors.ts` | Avatar tint helpers |
| `packages/desktop/src/lib/ai/Readers.svelte` | Configuration panel UI |
| `packages/desktop/src/lib/ai/Feedback.svelte` | Feedback persona opt-in |
| `packages/desktop/src/lib/ai/Revise.svelte` | Revise persona opt-in |
| `packages/desktop/src/lib/ai/chatFactory.ts` | `runMultiPersonaStreams()` |
| `packages/desktop/src/lib/ai/AISidebar.svelte` | Readers tab integration |

Do not delete, rename, replace, or flatten this feature without a backwards-compatible
migration plan.

## Cost And Opt-In Rule

Personas fan out one request into one AI stream per enabled persona, so they cost roughly
`N x` the tokens of a normal request.

Therefore:

1. Persona execution must stay explicit and opt-in.
2. Default persona modes must remain off.
3. Do not silently enable personas as part of the one-click editor.
4. The one-click editor uses `personaModes.editor`, defaulting to `false`.
5. The UI should make the cost/parallel-reader behavior understandable.

## Per-Mode Opt-In

Current additive model:

```ts
personaModes: {
    feedback: boolean;
    revise: boolean;
    editor: boolean;
}
```

Stored under:

```text
quillium-ai-persona-modes
```

Defaults:

```ts
{
    feedback: false,
    revise: false,
    editor: false,
}
```

Existing saved `feedback` and `revise` values must survive the migration.

## Unified Editor Interaction

Personas off:

```text
User -> Unified Editor -> one AI stream -> structured annotations
```

Personas on:

```text
User -> Unified Editor -> runMultiPersonaStreams-compatible fanout
                    -> Persona 1 -> attributed annotations
                    -> Persona 2 -> attributed annotations
                    -> Persona N -> attributed annotations
```

Each persona receives the same:

- scope;
- selected text;
- document context;
- document risk level;
- policy posture;
- replacement permission;
- focus toggles;
- schema/output contract.

Every persona must still obey global prompt contract rules: high-stakes safety,
replacement-text permissions, schema validity, no fabrication, no ghostwriting, and no
detector evasion.

## Annotation Attribution

Unified editor annotations should preserve persona attribution when present:

```ts
persona?: {
    personaId: string;
    personaName: string;
    emoji?: string;
    color?: string;
}
```

If personas are off, `persona` is omitted.

## Avoid Naming Collisions

Do not create a focus called `devils_advocate`. The built-in `Devil's Advocate` Reader
Persona already owns that concept at the persona layer.

Recommended focus label:

```text
Challenge
```

Recommended enum:

```ts
"challenge"
```

The `Challenge` focus means "look for unsupported claims, contradictions, weak evidence,
or assumptions." The `Devil's Advocate` persona means "a specific configured reader
identity whose comments are attributed to that persona."

## Prompt-Building Order

1. Stable Quillium developer/system rules.
2. Protected-writing and replacement-permission rules.
3. Unified editor focus instructions.
4. Persona prompt, if personas are enabled for this run.
5. Document context and voice fingerprint.
6. User request and selected text.
7. Schema/output contract.

Persona prompts must not override earlier safety/system rules.
