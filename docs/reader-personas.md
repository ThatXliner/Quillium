# Reader personas

Reader personas run separate model requests that attach notes under each reader's
name. Enabling a reader in the Readers panel selects that reader for future
fan-out requests. It does not start a request or enable fan-out by itself.

## Reader configuration

[`readers/presets.ts`](../packages/desktop/src/lib/readers/presets.ts) owns the
`ReaderPersona` type, built-in descriptions, and defaults. A persona has a stable
ID, display name, avatar, instruction, enabled state, and chattiness. Built-ins
also have an expandable profile. Custom readers can be deleted; built-ins cannot.

The default enabled readers are Skeptical Editor, Clarity Coach, First-Time
Reader, and Emotional Reader. Flow Reader, Devil's Advocate, Expert Reader, and
Casual Skimmer start disabled. Chattiness is `quiet`, `normal`, or `verbose`.
[`buildPersonaPrompt()`](../packages/desktop/src/lib/readers/prompt.ts) sends that
instruction as a writer-selected user-role lens. It cannot expand the task's
system policy or tool permissions.

[`readers/settings.svelte.ts`](../packages/desktop/src/lib/readers/settings.svelte.ts)
saves device choices under `quillium-readers-settings`. Loading preserves saved
built-in toggles and chattiness, adds new built-ins from the current presets, and
appends custom readers.

An active [College setup](college-applications.md#effective-preferences-and-requests)
supplies the tab's reader list and separate-panel opt-ins. Readers edits then save
to that setup. Pausing or removing it restores the unchanged device defaults.

## Opt-in by layout

| Layout | Opt-in | Request behavior |
|---|---|---|
| Separate Feedback and Revise | Saved per-mode toggle, off by default | One request per enabled reader replaces the normal response. Exact compression in Revise uses the normal stream. |
| Separate Chat | No reader toggle | One conversational response. |
| One assistant | Conversation-local Readers toggle, off for a new discussion | One normal assistant response plus one request per enabled reader, with the same turn permissions. |

With no enabled readers, requests use the normal single response. One assistant
persists its toggle with the conversation's device-local tool choices in
[`assistantOptions.ts`](../packages/desktop/src/lib/ai/assistantOptions.ts).
Separate-panel opt-ins use `quillium-ai-persona-modes` unless a College setup
owns the effective preferences.

Each enabled reader adds a model request. Token use and cost depend on the
provider, context, and generated output; they are not a fixed multiplier.

## Request execution

[`runMultiPersonaStreams()`](../packages/desktop/src/lib/ai/chatFactory.ts) copies
the enabled readers and captures the writing target, selection, context,
provider settings, and permitted actions before starting parallel streams.

Each stream consumes annotation tool calls rather than displaying its
conversational text. Reader requests require a permitted annotation tool call or
an empty `noAction` when there is no useful note. When a retrieval snapshot is available, readers can use the same bounded
[read-tool loop](ai-sidebar.md#continuity-between-feedback-and-annotation-discussions)
as sidebar conversations. There is no separate prose-summary request after the
annotation work. Providers may still emit text or reasoning, so this does not
guarantee zero billed non-annotation tokens. `noAction` creates nothing.

Feedback readers can create comments. Revise readers can create comments,
suggestions, and revisions. One assistant readers receive the same permission
snapshot as the accompanying assistant turn, including contextual restrictions.
Every result passes the shared
[annotation gateway](ai-sidebar.md#tools-and-annotation-dispatch), which checks
the captured document, tab, draft, nested version, selection, and source text.
Late output cannot apply to another draft or changed target passage.

The global AI stop control cancels all reader streams through the shared abort
signal. Annotation authors and request provenance retain the reader's identity.
Separate Feedback and Revise save the request and an application-status message
in their conversation; reader notes remain annotations on the draft.
