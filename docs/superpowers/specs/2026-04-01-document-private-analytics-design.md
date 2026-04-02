# Document-Private Analytics

**Date:** 2026-04-01
**Status:** Approved

## Problem

For the public beta, analytics must not leak document contents. Currently, a few PostHog events send string properties containing words from the user's document, and session replay (if enabled server-side) can capture the full editor text. Users should have document privacy by default, with an opt-out for bug-reporting scenarios.

## New Setting

| Field | Type | Default |
|---|---|---|
| `privateDocumentAnalytics` | `boolean` | `true` |

- **Label:** "Document-private analytics"
- **Description:** "Keeps your document contents hidden from analytics. Disable temporarily if you need to share document details when making a bug report."
- Placed in SettingsModal directly below the existing "Usage analytics" toggle.

## What It Controls

### 1. Event Property Redaction

When `privateDocumentAnalytics` is `true`, the following properties are stripped (the event itself is still sent, just without the text value):

| Event | Property redacted |
|---|---|
| `dictionary_synonym_replaced` | `synonym` |
| `dictionary_chip_lookup` | `word` |
| `dictionary_open_in_chat` | `word` |

All other events already send only counts, booleans, or enum values and are unaffected.

### 2. Session Replay Text Masking

When `privateDocumentAnalytics` is `true`, PostHog session recording masks text inside the CodeMirror editor so replays show placeholder characters instead of document content.

Implementation: set `session_recording.maskTextSelector` in the PostHog init config to target `.cm-content` (the CodeMirror content area). This masks the editor text in recordings while leaving UI chrome (buttons, labels, menus) visible for debugging.

When `false`, no masking — full editor text is visible in replays.

Since PostHog init runs once at startup, and the setting could change mid-session, we also call `posthog.set_config()` in the save handler to update masking dynamically.

### 3. Exception Sanitization

Not included in this scope. Stack traces almost never contain document text directly — errors reference code locations, not user content. If this becomes an issue later, it can be addressed separately.

## Implementation

### `src/lib/settings.svelte.ts`

Add `privateDocumentAnalytics: boolean` to `AppSettings` type and `DEFAULTS` (default `true`).

### `src/lib/posthog.ts`

1. Update `posthog.init()` to conditionally set `session_recording.maskTextSelector: ".cm-content"` based on `appSettings.privateDocumentAnalytics`.

2. Export a `capture(event, props)` wrapper that:
   - Checks `appSettings.privateDocumentAnalytics`
   - If `true`, deletes known sensitive keys (`synonym`, `word`) from a shallow copy of `props`
   - Calls `posthog.capture(event, cleanedProps)`

3. Export a `syncPrivateAnalytics(enabled)` function that calls `posthog.set_config()` to update `session_recording.maskTextSelector` at runtime.

### Call sites

Replace `posthog.capture(...)` with the new `capture(...)` wrapper at the three dictionary call sites:
- `src/lib/editor/DictionaryPopover.svelte` (3 calls)

Other call sites don't send document-content properties and can remain as `posthog.capture(...)` directly.

### `src/lib/settings/SettingsModal.svelte`

1. Add toggle for `privateDocumentAnalytics` below the "Usage analytics" row, with the same switch pattern.
2. In the `save()` function, detect changes and call `syncPrivateAnalytics()`.
3. Add the new setting to the `settings_saved` capture properties.
4. Only show this toggle when `draft.analyticsEnabled` is `true` (irrelevant if analytics are off entirely).

## Files Changed

1. `src/lib/settings.svelte.ts` — add setting
2. `src/lib/posthog.ts` — add capture wrapper, mask config, sync function
3. `src/lib/editor/DictionaryPopover.svelte` — use capture wrapper (3 sites)
4. `src/lib/settings/SettingsModal.svelte` — add toggle, save logic
