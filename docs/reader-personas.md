# Reader Personas

Reader personas are configurable AI "readers" that provide feedback from distinct perspectives. When personas are turned **on** for a mode, all enabled personas run in parallel — each producing annotations attributed to that persona's name.

Because personas fan a single request out into one AI stream **per enabled persona**, they cost roughly N× the tokens of a normal request. For that reason they are an explicit, **per-mode opt-in that defaults to OFF** — see [Per-Mode Opt-In](#per-mode-opt-in) below.

## Files

| File | Purpose |
|------|---------|
| `presets.ts` | `ReaderPersona` type, `DEFAULT_PERSONAS` |
| `settings.svelte.ts` | Persona list store, localStorage persistence |
| `prompt.ts` | `buildPersonaPrompt()` |
| `colors.ts` | `lightTint()` / `mediumTint()` for avatars |
| `Readers.svelte` | Configuration panel UI |

## Data Model

```typescript
type ReaderPersona = {
    id: string;          // UUID for custom, slug for builtin
    name: string;        // Display name
    emoji: string;       // Avatar emoji
    color: string;       // Hex color for accent
    description: string; // Short tagline
    profile?: {          // Rich profile for builtins
        about: string;
        goodFor: string[];
        example: string;
    };
    instruction: string; // AI prompt (not shown to users)
    builtin: boolean;
    enabled: boolean;
    chattiness: "quiet" | "normal" | "verbose";
};
```

## Builtin Personas

| Persona | Focus | Default |
|---------|-------|---------|
| Skeptical Editor 🔍 | Logical gaps, weak claims | Enabled |
| Clarity Coach 💡 | Jargon, ambiguity, readability | Enabled |
| First-Time Reader 👶 | Missing context, assumed knowledge | Enabled |
| Emotional Reader 💜 | Tone, voice, emotional resonance | Enabled |
| Flow Reader 🌊 | Pacing, transitions, momentum | Disabled |
| Devil's Advocate 😈 | Challenging assumptions | Disabled |
| Expert Reader 🎓 | Depth, accuracy, rigor | Disabled |
| Casual Skimmer ⚡ | Scannability, key points | Disabled |

## Chattiness

Each persona has a 3-level chattiness setting:

| Level | Behavior |
|-------|----------|
| `quiet` | Only significant issues; nothing if solid |
| `normal` | Issues worth writer's attention |
| `verbose` | Thorough about meaningful patterns; skips minor preferences |

The directive is sent as a writer-selected reader lens in a user-role message via
`buildPersonaPrompt()`. The shared system policy keeps the task's action permissions fixed.

## Settings Persistence

Stored in localStorage under `"quillium-readers-settings"`. On load, saved state merges with `DEFAULT_PERSONAS`:
- User toggles and chattiness preserved
- New builtins added if preset list grows
- Custom personas appended after builtins

## Multi-Persona Execution

```mermaid
sequenceDiagram
    participant User
    participant Feedback as Feedback.svelte
    participant Factory as chatFactory.ts
    participant AI as AI Provider

    User->>Feedback: Click feedback button
    Feedback->>Factory: sendWithPersonas()
    Factory->>Factory: getEnabledPersonas()
    Factory->>Factory: Snapshot document ID and AI context
    
    par Parallel execution
        Factory->>AI: Persona 1 stream
        Factory->>AI: Persona 2 stream
        Factory->>AI: Persona N stream
    end
    
    AI-->>Factory: Streamed tool calls
    Factory->>Factory: Confirm document is still active
    Factory->>Factory: Attribute annotations to persona name
```

When feedback is triggered:
1. The panel checks the **per-mode opt-in** (`personaModes[mode]`). If the mode is OFF, it uses a single plain stream and stops here.
2. If ON, it reads `getEnabledPersonas()`; if any exist, it calls `runMultiPersonaStreams()`
3. The factory snapshots the document, tab, draft, nested revision-version path,
   selection and mapped range, open annotations, active annotation, writer brief,
   saved decisions, editorial preferences, and provider settings once.
4. Each persona runs **in parallel** (`Promise.all`) with the shared abort signal.
5. Each stream sends `buildPersonaPrompt(persona)` as a writer-selected lens before
   the context packet.
6. Tool-call handlers attribute annotations to the persona's name.
7. A tool call must match the captured editor identity, selection, and task
   permissions. Late output cannot land in another draft, revision branch, or
   changed target passage.

If the mode is OFF, or it is ON but no personas are enabled, it falls back to standard single-stream.

Persona streams consume tool-call chunks directly instead of rendering each
persona's conversational text in the panel. Feedback personas can create
comments; Revise personas can create comments, suggestions, and revisions.
The global AI stop control cancels every persona stream through the shared abort
signal.

## Per-Mode Opt-In

Personas are gated by a per-mode toggle so the cost is opt-in and explicit (issue #259).

| Where | Detail |
|-------|--------|
| State | `personaModes: { feedback: boolean; revise: boolean }` in `src/lib/ai/settings.svelte.ts` |
| Default | Both `false` (plain single-stream by default) |
| Persistence | localStorage key `"quillium-ai-persona-modes"` |
| Setter | `setPersonasForMode(mode, enabled)` — persists + updates the rune |
| UI | A switch in the **Feedback** and **Revise** tab headers; each mode remembers its own choice |

The per-persona toggles in the Readers tab still select *which* personas run, but they only take effect once the mode toggle is ON. Chat mode does not use personas.

## UI (Readers.svelte)

Tab 5 in AI sidebar. Rose theme accent.

Layout:
- **Enabled personas** at top
- **Disabled personas** below divider (dimmed 55%)
- Each card: emoji avatar, name, description, chattiness dots (1–3), toggle
- Clicking builtin card expands: about text, "Good for" tags, example quote
- **Custom reader form** at bottom: name, emoji, color swatch, instruction textarea
- Custom personas deletable; builtins are not

## Integration Points

- **Feedback.svelte / Revise.svelte**: Gate sends on `personaModes[mode]`, then route through the persona check; render the per-mode toggle
- **ai/settings.svelte.ts**: Owns `personaModes` and `setPersonasForMode()`
- **chatFactory.ts**: `runMultiPersonaStreams()` handles parallel execution
- **context.ts / annotationContext.ts**: Build the same budgeted, annotation-aware
  context used by ordinary Feedback and Revise requests
- **settings.svelte.ts**: Supplies the shared abort signal and global stop behavior
- **AI sidebar**: Tab index 5 in `AISidebar.svelte`
