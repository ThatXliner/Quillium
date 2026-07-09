# Settings

## App Settings (`settings.svelte.ts`)

User preferences in a Svelte 5 `$state` proxy (`appSettings`) persisted to localStorage under `"quillium-app-settings"`. Changes apply immediately via `applySettings()` and save via `persistSettings()`.

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
| `aiEnabled` | boolean | `false` | AI features active |
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

Separate from app settings. Stored in localStorage under `"quillium-ai-settings"`:

| Setting | Type | Description |
|---------|------|-------------|
| `provider` | enum | OpenAI, OpenAI-compatible, Anthropic, Google, DeepSeek |
| `model` | string | Model ID within provider |
| `baseURL` | string | OpenAI-compatible endpoint URL |

API keys stored in OS keychain, not localStorage.

The same module also owns:

| State | Storage | Purpose |
|-------|---------|---------|
| `documentContext.freeform` | localStorage | Writer-provided context injected into AI calls |
| `personaModes` | localStorage | Per-mode reader-persona opt-in for Feedback/Revise/unified editor |
| `aiProcessing` | memory | Sidebar glow / stop-all coordination |

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
