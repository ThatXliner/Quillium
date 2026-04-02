# Document-Private Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure analytics never leaks document contents by default, with a user setting to opt out for bug reporting.

**Architecture:** New `privateDocumentAnalytics` boolean in `AppSettings` (default `true`). A `capture()` wrapper in `posthog.ts` redacts sensitive event properties when enabled. PostHog session recording masks `.cm-content` when enabled. Settings toggle in SettingsModal, gated behind analytics being on.

**Tech Stack:** SvelteKit, PostHog JS SDK, Vitest

**Spec:** `docs/superpowers/specs/2026-04-01-document-private-analytics-design.md`

---

### Task 1: Add `privateDocumentAnalytics` setting

**Files:**
- Modify: `src/lib/settings.svelte.ts:16-54`

- [ ] **Step 1: Add the setting to `AppSettings` type**

In `src/lib/settings.svelte.ts`, add `privateDocumentAnalytics` to the type and defaults:

```typescript
// In the AppSettings type (after line 28):
    analyticsEnabled: boolean;
    privateDocumentAnalytics: boolean;  // <-- add this line

// In the DEFAULTS object (after line 48):
    analyticsEnabled: true,
    privateDocumentAnalytics: true,  // <-- add this line
```

- [ ] **Step 2: Verify types compile**

Run: `bun run check`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/settings.svelte.ts
git commit -m "feat: add privateDocumentAnalytics setting (default true)"
```

---

### Task 2: Add capture wrapper and session replay masking to `posthog.ts`

**Files:**
- Modify: `src/lib/posthog.ts`
- Create: `src/lib/posthog.test.ts`

- [ ] **Step 1: Write the test for the capture wrapper**

Create `src/lib/posthog.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock posthog-js before importing our module
const mockCapture = vi.fn();
const mockSetConfig = vi.fn();
vi.mock("posthog-js", () => ({
    default: {
        init: vi.fn(),
        register: vi.fn(),
        opt_out_capturing: vi.fn(),
        opt_in_capturing: vi.fn(),
        capture: mockCapture,
        set_config: mockSetConfig,
    },
}));
vi.mock("$app/environment", () => ({ dev: true }));
vi.mock("$env/static/public", () => ({
    PUBLIC_POSTHOG_KEY: "",
    PUBLIC_POSTHOG_HOST: "",
}));

// Mock settings — start with private analytics ON
const mockSettings = { privateDocumentAnalytics: true, analyticsEnabled: true };
vi.mock("$lib/settings.svelte", () => ({
    appSettings: mockSettings,
}));

import { capture, REDACTED_KEYS, syncPrivateAnalytics } from "$lib/posthog";

describe("capture", () => {
    beforeEach(() => {
        mockCapture.mockClear();
        mockSettings.privateDocumentAnalytics = true;
    });

    it("strips redacted keys when privateDocumentAnalytics is true", () => {
        capture("dictionary_synonym_replaced", { synonym: "happy", extra: 42 });
        expect(mockCapture).toHaveBeenCalledWith("dictionary_synonym_replaced", { extra: 42 });
    });

    it("passes all properties when privateDocumentAnalytics is false", () => {
        mockSettings.privateDocumentAnalytics = false;
        capture("dictionary_synonym_replaced", { synonym: "happy", extra: 42 });
        expect(mockCapture).toHaveBeenCalledWith("dictionary_synonym_replaced", {
            synonym: "happy",
            extra: 42,
        });
    });

    it("does not mutate the original props object", () => {
        const props = { synonym: "happy", extra: 42 };
        capture("dictionary_synonym_replaced", props);
        expect(props).toEqual({ synonym: "happy", extra: 42 });
    });

    it("works with no properties", () => {
        capture("some_event");
        expect(mockCapture).toHaveBeenCalledWith("some_event", undefined);
    });

    it("passes through events with no redacted keys untouched", () => {
        capture("document_created", { count: 1 });
        expect(mockCapture).toHaveBeenCalledWith("document_created", { count: 1 });
    });
});

describe("syncPrivateAnalytics", () => {
    beforeEach(() => {
        mockSetConfig.mockClear();
    });

    it("sets maskTextSelector when enabled", () => {
        syncPrivateAnalytics(true);
        expect(mockSetConfig).toHaveBeenCalledWith({
            session_recording: { maskTextSelector: ".cm-content" },
        });
    });

    it("clears maskTextSelector when disabled", () => {
        syncPrivateAnalytics(false);
        expect(mockSetConfig).toHaveBeenCalledWith({
            session_recording: { maskTextSelector: undefined },
        });
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:run src/lib/posthog.test.ts`
Expected: FAIL — `capture`, `REDACTED_KEYS`, and `syncPrivateAnalytics` don't exist yet.

- [ ] **Step 3: Implement the capture wrapper and sync function**

In `src/lib/posthog.ts`, make these changes:

After the existing imports (line 4), the file already imports `appSettings`. No new imports needed.

Replace the current `posthog.init(...)` block (lines 9-15) to add session recording masking:

```typescript
if (!dev && PUBLIC_POSTHOG_KEY && PUBLIC_POSTHOG_HOST) {
    posthog.init(PUBLIC_POSTHOG_KEY, {
        api_host: PUBLIC_POSTHOG_HOST,
        ui_host: "https://us.posthog.com",
        defaults: "2026-01-30",
        capture_exceptions: true,
        session_recording: appSettings.privateDocumentAnalytics
            ? { maskTextSelector: ".cm-content" }
            : {},
    });
```

Add the capture wrapper and sync function before the `export default posthog` line (before line 48):

```typescript
/**
 * Keys that contain document content and should be redacted
 * when privateDocumentAnalytics is enabled.
 */
export const REDACTED_KEYS: ReadonlySet<string> = new Set(["synonym", "word"]);

/**
 * Privacy-aware capture wrapper. Strips document-content properties
 * when the user has privateDocumentAnalytics enabled.
 */
export function capture(event: string, props?: Record<string, unknown>) {
    if (!props || !appSettings.privateDocumentAnalytics) {
        posthog.capture(event, props);
        return;
    }
    const hasRedacted = Object.keys(props).some((k) => REDACTED_KEYS.has(k));
    if (!hasRedacted) {
        posthog.capture(event, props);
        return;
    }
    const cleaned = { ...props };
    for (const key of REDACTED_KEYS) {
        delete cleaned[key];
    }
    posthog.capture(event, cleaned);
}

/**
 * Update session recording text masking at runtime.
 * Call after changing `appSettings.privateDocumentAnalytics`.
 */
export function syncPrivateAnalytics(enabled: boolean) {
    posthog.set_config({
        session_recording: { maskTextSelector: enabled ? ".cm-content" : undefined },
    });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test:run src/lib/posthog.test.ts`
Expected: PASS

- [ ] **Step 5: Run type check**

Run: `bun run check`
Expected: No type errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/posthog.ts src/lib/posthog.test.ts
git commit -m "feat: add privacy-aware capture wrapper and session replay masking"
```

---

### Task 3: Update DictionaryPopover to use capture wrapper

**Files:**
- Modify: `src/lib/editor/DictionaryPopover.svelte:19,161,168,191`

- [ ] **Step 1: Change the import**

In `src/lib/editor/DictionaryPopover.svelte`, change line 19 from:

```typescript
import posthog from "$lib/posthog";
```

to:

```typescript
import { capture } from "$lib/posthog";
```

- [ ] **Step 2: Replace the three capture calls**

Replace the three `posthog.capture` calls that send document-content properties:

Line 161 — change:
```typescript
    posthog.capture("dictionary_synonym_replaced", { synonym });
```
to:
```typescript
    capture("dictionary_synonym_replaced", { synonym });
```

Line 168 — change:
```typescript
    posthog.capture("dictionary_chip_lookup", { word: w });
```
to:
```typescript
    capture("dictionary_chip_lookup", { word: w });
```

Line 191 — change:
```typescript
    posthog.capture("dictionary_open_in_chat", {
```
to:
```typescript
    capture("dictionary_open_in_chat", {
```

- [ ] **Step 3: Run type check**

Run: `bun run check`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/editor/DictionaryPopover.svelte
git commit -m "feat: use privacy-aware capture in DictionaryPopover"
```

---

### Task 4: Add settings toggle in SettingsModal

**Files:**
- Modify: `src/lib/settings/SettingsModal.svelte:30,179-200,829-831`

- [ ] **Step 1: Add the import**

In `src/lib/settings/SettingsModal.svelte`, change line 30 from:

```typescript
import { syncAnalyticsOptOut } from "$lib/posthog";
```

to:

```typescript
import { syncAnalyticsOptOut, syncPrivateAnalytics } from "$lib/posthog";
```

- [ ] **Step 2: Update the save function**

In the `save()` function, after the `analyticsChanged` block (after line 185), add:

```typescript
    const privateAnalyticsChanged =
        appSettings.privateDocumentAnalytics !== draft.privateDocumentAnalytics;
```

Move this line to before `Object.assign(appSettings, draft);` (so it reads the old value). Then after the existing `syncAnalyticsOptOut` block, add:

```typescript
    if (privateAnalyticsChanged) {
        syncPrivateAnalytics(draft.privateDocumentAnalytics);
    }
```

The full `save()` function should look like:

```typescript
function save() {
    const analyticsChanged = appSettings.analyticsEnabled !== draft.analyticsEnabled;
    const privateAnalyticsChanged =
        appSettings.privateDocumentAnalytics !== draft.privateDocumentAnalytics;
    Object.assign(appSettings, draft);
    persistSettings();
    if (analyticsChanged) {
        syncAnalyticsOptOut(draft.analyticsEnabled);
    }
    if (privateAnalyticsChanged) {
        syncPrivateAnalytics(draft.privateDocumentAnalytics);
    }
    posthog.capture("settings_saved", {
        ai_enabled: draft.aiEnabled,
        select_text_in_nested_editor: draft.selectTextInNestedEditor,
        show_nested_editor: draft.showNestedEditor,
        atomic_revisions: draft.atomicRevisions,
        doc_font_family: draft.docFontFamily,
        doc_font_size: draft.docFontSize,
        ui_font_family: draft.uiFontFamily,
        title_visibility: draft.titleVisibility,
        title_hover_delay: draft.titleHoverDelay,
        title_linger_duration: draft.titleLingerDuration,
        ui_zoom: draft.uiZoom,
        custom_quick_actions_count: draft.customQuickActions.length,
        auto_version_on_revision_create: draft.autoVersionOnRevisionCreate,
        private_document_analytics: draft.privateDocumentAnalytics,
    });
    onclose();
}
```

- [ ] **Step 3: Add the toggle UI**

After the analytics toggle closing `</div>` (line 829) and before the `<div class="section-divider"></div>` (line 831), insert the new toggle. It should only be visible when analytics are enabled:

```svelte
            <!-- Document-private analytics toggle (only relevant when analytics are on) -->
            {#if draft.analyticsEnabled}
            <div class="setting-row">
                <div class="setting-meta">
                    <div class="setting-title">Document-private analytics</div>
                    <div class="setting-desc">Keeps your document contents hidden from analytics. Disable temporarily to share document details when making a bug report.</div>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                {#if !draft.privateDocumentAnalytics}
                    <button
                        type="button"
                        onclick={() => { draft.privateDocumentAnalytics = true; handleChange(); }}
                        class="text-[11px] text-blue-500 hover:text-blue-600 transition-colors cursor-pointer"
                    >Reset</button>
                {/if}
                <button
                    role="switch"
                    aria-checked={draft.privateDocumentAnalytics}
                    aria-label="Toggle document-private analytics"
                    class="relative shrink-0 w-9 h-5 rounded-full transition-colors duration-200
                        {draft.privateDocumentAnalytics ? 'bg-blue-500' : 'bg-black/[0.15]'}"
                    onclick={() => {
                        draft.privateDocumentAnalytics = !draft.privateDocumentAnalytics;
                        handleChange();
                    }}
                >
                    <span
                        class="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm
                            transition-transform duration-200
                            {draft.privateDocumentAnalytics ? 'translate-x-4' : 'translate-x-0'}"
                    ></span>
                </button>
                </div>
            </div>
            {/if}
```

- [ ] **Step 4: Run type check**

Run: `bun run check`
Expected: No type errors.

- [ ] **Step 5: Manual smoke test**

Run: `bun run dev`

1. Open Settings.
2. Verify "Document-private analytics" toggle appears below "Usage analytics" and defaults to on (blue).
3. Toggle "Usage analytics" off — verify the document-private toggle disappears.
4. Toggle "Usage analytics" back on — verify document-private toggle reappears.
5. Toggle document-private off — verify "Reset" button appears.
6. Save and reopen — verify the setting persisted.

- [ ] **Step 6: Commit**

```bash
git add src/lib/settings/SettingsModal.svelte
git commit -m "feat: add document-private analytics toggle to settings"
```

---

### Task 5: Lint and final verification

**Files:** All modified files

- [ ] **Step 1: Run formatter and linter**

Run: `bun run biome`
Expected: No errors. Fix any formatting issues.

- [ ] **Step 2: Run all tests**

Run: `bun run test:run`
Expected: All tests pass, including the new `posthog.test.ts`.

- [ ] **Step 3: Run type check**

Run: `bun run check`
Expected: No type errors.

- [ ] **Step 4: Commit any lint fixes**

```bash
git add -A
git commit -m "chore: lint fixes for document-private analytics"
```

(Skip this commit if there were no lint issues.)
