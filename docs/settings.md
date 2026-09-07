# Settings

## App Settings (`settings.svelte.ts`)

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

| Setting | Type | Default | Controls |
|---------|------|---------|----------|
| `selectTextInNestedEditor` | boolean | `true` | Auto-select in nested editor |
| `showNestedEditor` | boolean | `true` | Show inline nested editor |
| `atomicRevisions` | boolean | `true` | Block direct revision editing |
| `editorMode` | enum | `"markdown"` | Plain or markdown mode |
| `docFontFamily` | string | `"Georgia, serif"` | Editor body font |
| `docFontSize` | number | `18` | Editor body font size |
| `uiFontFamily` | string | `"system-ui, ..."` | UI chrome font |
| `customQuickActions` | array | `[]` | User-defined AI quick actions |
| `titleVisibility` | enum | `"hover"` | Title display mode |
| `titleHoverDelay` | number | `350` | ms before title appears |
| `titleLingerDuration` | number | `3000` | ms title stays visible |
| `uiZoom` | number | `1` | `document.documentElement.zoom` |
| `analyticsEnabled` | boolean | `true` | PostHog opt-in/out |
| `aiEnabled` | boolean | `false` | AI features active; local sidebar panels remain available |
| `showShortcutHints` | boolean | `true` | Keyboard hints in panel |
| `showWordCount` | boolean | `true` | Word count in status bar |
| `wordCountDisplayMode` | enum | `"both"` | Words, chars, or both |
| `autoVersionOnRevisionCreate` | boolean | `true` | Auto-add version when creating revision |
| `showAiSuggestions` | boolean | `true` | Show AI suggestions in annotations |
| `collapseContextSummary` | boolean | `false` | Move AI context summary into header info popover |
| `checkForUpdates` | boolean | `true` | Auto-check for app updates |
| `grammarCheckEnabled` | boolean | `true` | Harper grammar checking |
| `grammarDialect` | enum | `"american"` | American, British, or Australian |
| `annotationPanelWidth` | number | `280` | Width of annotation sidebar |
| `annotationLayout` | enum | `"visual-split"` | Annotation placement when AI sidebar is hidden |

## Why localStorage Instead of SQLite

App settings are presentation preferences, not document data:
- Need to be available before Tauri backend loads
- Fonts and zoom affect initial render
- Per-device rather than per-document
- localStorage is synchronous; SQLite requires async `invoke()`

**Exception:** API keys go through OS keychain (security).

## Font System (`settings/fonts.ts`)

`FONTS` is the single source of truth for font metadata:
- CSS families
- Categories
- Picker groups
- "Our Pick" status
- Samples
- Guide descriptions

Both `SettingsModal.svelte` and `FontGuideModal.svelte` derive from this array.

Two runtime-resolved entries (system sans-serif, system monospace) are injected at mount via `document.fonts.check()`.

## Settings UI

### SettingsModal.svelte

Opens as a `<dialog>`:
- Changes apply live but aren't persisted until Save
- Closing without saving: shake + red ring animation, reverts to last saved
- Font picker with preview
- Zoom slider
- Toggle switches for behavior settings

### FontGuideModal.svelte

Sub-modal with:
- Font descriptions by category
- Sample text preview
- "Our Pick" recommendations

## AI Settings (`ai/settings.svelte.ts`)

AI connection state is separate from general app settings. Non-secret values
use individual localStorage keys:

| Runtime field | Storage key | Description |
|---------------|-------------|-------------|
| `aiSettings.provider` | `quillium-ai-provider` | OpenAI API, ChatGPT OAuth, OpenAI-compatible, Anthropic, Google, or DeepSeek |
| `aiSettings.model` | `quillium-ai-model` | Curated or custom provider model ID; defaults to `gpt-5.6-sol` |
| `aiSettings.baseURL` | `quillium-ai-base-url` | OpenAI-compatible endpoint URL |
| `editorialPreferences` | `quillium-ai-editorial-preferences` | Stance, feedback density, and voice latitude |
| `documentContext.freeform` | SQLite `document_ai_profiles` | Document-scoped writer brief injected into AI requests; the legacy `quillium-document-context` key is imported once |
| `documentContext.decisions` | SQLite `document_editorial_decisions` | Explicit document-scoped editorial choices injected as writer-confirmed context |
| `personaModes` | `quillium-ai-persona-modes` | Per-mode reader-persona opt-in for Feedback and Revise |

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
state. See [AI Features and Request Pipeline](./ai-sidebar.md) for the full flow.

## AutoAI Settings (`autoai/settings.svelte.ts`)

See [AutoAI](./autoai.md) documentation.

## Reader Personas Settings (`readers/settings.svelte.ts`)

See [Reader Personas](./reader-personas.md) documentation.

## CSS Custom Properties

Settings apply via CSS custom properties on `document.documentElement`:

| Property | Source |
|----------|--------|
| `--doc-font-family` | `docFontFamily` |
| `--doc-font-size` | `docFontSize` |
| `--ui-font-family` | `uiFontFamily` |

## Native Menu Integration

`Mod-,` opens settings modal. The `settingsOpen` store is shared between:
- Native menu handler
- StatusBar gear button
- `Cmd+,` keydown listener
