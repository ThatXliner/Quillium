# Document Tabs — Test Coverage Design

**Date:** 2026-03-28
**Branch:** documents-tabs
**Scope:** Add full test coverage for the DocumentTabs feature across three layers.

---

## Overview

The DocumentTabs feature (tab bar, tab CRUD, active-tab persistence) shipped without dedicated tests. This spec covers adding:

1. Tab mock handlers to `QuilliumPage` (shared E2E mock)
2. Vitest unit tests for `DocumentTabs.svelte` UI logic
3. Playwright E2E tests for the full tab CRUD lifecycle

---

## Section 1: QuilliumPage Mock Patch

**File:** `tests/e2e/QuilliumPage.ts`

Add an `initialTabs` field to `TauriMockOptions` (optional, defaults to one tab). The mock maintains an in-memory `tabs` array and `activeTabId` variable.

Default seed (when `initialTabs` not provided):
```ts
[{ id: "tab-test-1", documentId: "doc-test-1", label: "Tab 1", draftId: "draft-test-1", position: 0, createdAt: 0 }]
```
`activeTabId` defaults to `"tab-test-1"`.

New handlers added to the `invoke` mock:
- `cmd_list_tabs` → return `tabs` filtered by `docId`
- `cmd_get_active_tab` → return `activeTabId`
- `cmd_set_active_tab(docId, tabId)` → set `activeTabId = tabId`, return null
- `cmd_create_tab(docId, label)` → push new `TabMeta` (auto-increment position), return the new tab
- `cmd_rename_tab(tabId, label)` → update matching tab's label in place, return null
- `cmd_delete_tab(tabId)` → remove matching tab, return null

---

## Section 2: Vitest Unit Tests

**File:** `tests/documentTabs.test.ts`

Mount `DocumentTabs` in isolation using `@testing-library/svelte`. All Tauri IPC is irrelevant — props are passed directly.

Test cases:
1. Renders all tab labels
2. `ontabselect` called with correct `tabId` on click
3. Close button absent when `tabs.length === 1`
4. Close button present when `tabs.length > 1`
5. `ontabdelete` called with correct `tabId` when × clicked
6. Double-click enters rename mode (input element appears)
7. Enter key commits rename, calls `ontabrename(tabId, trimmedValue)`
8. Escape cancels rename — input disappears, `ontabrename` not called
9. Empty string rename falls back to `"Tab"` before calling `ontabrename`
10. Blur commits rename (same as Enter)
11. `ontabcreate` called when + button clicked

---

## Section 3: E2E Tests

**File:** `tests/e2e/documentTabs.pw.ts`

Uses `QuilliumPage` with the patched mock. Each test calls `qp.init()`.

Test cases:
1. **Tab bar renders** — default tab label visible in `[role=tablist]`
2. **Create tab** — click `+`, second tab appears; `cmd_create_tab` was invoked
3. **Switch tab** — with 2 tabs, click the non-active tab; `cmd_set_active_tab` was invoked
4. **Rename tab** — double-click tab label, type new name, press Enter; label updates in DOM
5. **Delete tab** — with 2 tabs, click × on one; tab disappears; `cmd_delete_tab` invoked
6. **No close button with 1 tab** — close button absent when only 1 tab remains

---

## What Is Not Tested

- Rust/SQLite tab CRUD (covered by Rust unit tests in `src-tauri`)
- Tab ordering / drag-reorder (not implemented)
- Tab persistence across page reloads (covered implicitly by E2E test #1 — mock returns tabs on load)
