# Settings

## App preferences

Read preferences through `appSettings`. Commit absolute values with
`updateSettings({ uiZoom: appSettings.uiZoom + 0.1 })`; the module validates,
applies appearance, and saves to `"quillium-app-settings"` in localStorage.
Callers cannot assign top-level settings directly. Updates merge the latest stored
preferences so an older window does not overwrite an unrelated change.

`previewSettings(draft)` applies appearance without changing committed settings or
storage. The Settings modal uses it for live preview and Cancel, and calls
`updateSettings(draft)` on Save. Panel resize gestures likewise keep a local width
until release, then commit once.

`getPersistUndoHistoryForNewDocuments()` deliberately reads shared storage when a
document is created. Each Tauri window has its own settings state, so this query
must see another window's latest undo policy even before a local settings update.
Missing, malformed, or unavailable storage defaults to session-only undo.

The `AppSettings` type and `DEFAULTS` in
[`settings.svelte.ts`](../packages/desktop/src/lib/settings.svelte.ts) are the
complete setting reference. They cover editor behavior, appearance, sidebar
layout, draft and outline visibility, Web Preview updates, undo persistence,
analytics, grammar checking, and writing reminders.

AI starts disabled. When enabled, separate Chat, Feedback, and Revise panels are
the default. One assistant is an explicit layout choice. Disabling AI hides all
built-in AI panels, including local Context, Readers, and College configuration.
The host can keep contributions without an AI prerequisite available.

## Storage and appearance

App preferences are per-device and use localStorage so fonts and zoom can apply
before the native backend loads. Document data belongs in SQLite. Provider
secrets belong in the OS keychain.

Settings apply `--doc-font-family`, `--doc-font-size`, and `--ui-font-family` to
`document.documentElement`, along with the document zoom value. The Settings
modal previews a draft locally and commits on Save. Cancel restores the saved
appearance.

[`settings/fonts.ts`](../packages/desktop/src/lib/settings/fonts.ts) owns font
metadata and picker groups. The settings picker and font guide derive from it.
[`fontOptions.ts`](../packages/desktop/src/lib/settings/fontOptions.ts) resolves
system-font labels at runtime.

`Mod-,`, the native Settings menu item, and the status-bar gear open the same
modal through `settingsOpen`.

## AI preferences and credentials

AI connection state is separate from app preferences. Its owning module is
[`ai/settings.svelte.ts`](../packages/desktop/src/lib/ai/settings.svelte.ts).
Storage is divided by scope:

| Runtime field | Storage key | Description |
|---------------|-------------|-------------|
| `aiSettings.provider` | `quillium-ai-provider` | OpenAI API, ChatGPT OAuth, OpenAI-compatible, Anthropic, Google, or DeepSeek |
| `aiSettings.model` | `quillium-ai-model` | Curated or custom provider model ID |
| `aiSettings.baseURL` | `quillium-ai-base-url` | OpenAI-compatible endpoint URL |
| `editorialPreferences` | `quillium-ai-editorial-preferences` | Stance, feedback density, and voice latitude |
| `documentContext.freeform` | SQLite `document_ai_profiles` | Document-scoped writer brief injected into AI requests; the legacy `quillium-document-context` key is imported once |
| `documentContext.decisions` | SQLite `document_editorial_decisions` | Explicit document-scoped editorial choices injected as writer-confirmed context |
| `personaModes` | `quillium-ai-persona-modes` | Device-default reader opt-ins for separate Feedback and Revise |

`aiSettings.apiKey` is memory-only. Provider API keys are lazy-loaded from the
OS keychain when an AI feature is first used, avoiding a keychain permission
prompt during ordinary startup. `quillium-has-api-key` is only a non-secret
presence hint used to prevent UI flicker before the key loads.

ChatGPT OAuth sessions are stored in the same OS keychain under the
`openai-oauth` provider name. `quillium-has-openai-oauth` is a non-secret
connection-status hint; it does not contain tokens. The optional key for a local
OpenAI-compatible endpoint is held in memory and is not persisted.

The same module also owns:

| State | Storage | Purpose |
|-------|---------|---------|
| `aiConnectionState` | localStorage presence hint + keychain session | ChatGPT connection status |
| `aiProcessing` | memory | Derived sidebar processing indicator |
| active AI task set | memory | Keeps processing active until overlapping operations finish |
| shared abort controller | memory | Cancels non-chat, AutoAI, characterization, and persona requests |

`stopAllAi()` aborts the shared controller, tells mounted chat instances to
stop, cancels pending AutoAI work through the event bus, and resets processing
state. See [the AI request pipeline](ai-sidebar.md) for the full flow.

## Feature-owned preferences

[AutoAI](autoai.md) and [reader personas](reader-personas.md) have separate
settings stores. An active [College setup](college-applications.md) owns its tab's
editorial preferences and reader choices without overwriting device defaults.

The One assistant layout keeps conversation-local tool permissions, response length,
and the Readers toggle in `quillium-assistant:<conversation-id>` on this device.
The first unsent composer uses a document/draft-scoped pending key. These options
are separate from the layout opt-in and existing editorial preferences. Each sent
turn also records its tool permissions and response length for edit/retry.
