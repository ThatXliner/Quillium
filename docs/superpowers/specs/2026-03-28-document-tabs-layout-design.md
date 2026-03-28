# Document Tabs + Layout Design

**Date:** 2026-03-28
**Branch:** documents-tabs
**Status:** Approved

## Overview

Two changes:

1. **Document tabs** — browser-style tabs at the top of the editor, one per "version" of the current document. Feature parity with Google Docs tabs. Each tab is a new DB entity (not a draft).
2. **Layout efficiency** — when the AI sidebar is disabled, the editor area gains symmetric padding so the document+annotations group is visually centered instead of left-aligned in dead space.

---

## 1. Document Tabs

### User-facing behavior

- A horizontal tab bar appears above the document (sticky, inside the scroll container).
- Tabs are browser-style: active tab has a bottom border indicator; inactive tabs are muted.
- A `+` button at the end of the row creates a new tab.
- Clicking a tab switches the editor to that tab's content.
- Double-clicking a tab label renames it inline.
- An `×` button on each tab closes/deletes it (with confirmation). The `×` is hidden when only one tab exists — you can't close the last tab.
- Tabs are scoped to the editor only. The library shows one card per document regardless of tab count.

### Visual style

Browser-style tabs (not pill/glassmorphic). Horizontal row aligned to the 816px document column via `w-[816px] mx-auto`. Sits above `#editor-document` inside the existing `overflow-y-auto` scroller as a sticky element.

### Data model

New `tabs` table in SQLite:

```sql
CREATE TABLE tabs (
    id          TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    label       TEXT NOT NULL DEFAULT 'Tab',
    position    INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL
);
```

- Each tab gets one backing draft created automatically at tab creation time (hidden from frontend — implementation detail).
- Deleting a tab also deletes its backing draft, events, and snapshots.
- The frontend never calls `createDraft`/`listDrafts` for tab management — it uses the new tab commands only.
- This keeps tabs decoupled from the draft system so drafts can be redesigned later without touching the tab UI.

### New Tauri commands (Rust)

| Command | Description |
|---|---|
| `cmd_list_tabs(doc_id)` | Returns all tabs for a document, ordered by `position` |
| `cmd_create_tab(doc_id, label)` | Creates a tab + backing draft, returns `TabMeta` |
| `cmd_rename_tab(tab_id, label)` | Updates label |
| `cmd_delete_tab(tab_id)` | Deletes tab + backing draft + events/snapshots |
| `cmd_get_active_tab(doc_id)` | Returns the currently active tab id (persisted in a `document_state` table or similar) |
| `cmd_set_active_tab(doc_id, tab_id)` | Persists which tab is active for a document |

### TypeScript types

```ts
export type TabMeta = {
    id: string;
    documentId: string;
    label: string;
    position: number;
    createdAt: number;
    draftId: string; // backing draft, not exposed in UI
};
```

### Editor integration

- `Editor.svelte` loads tabs via `listTabs(currentDocumentId)` on mount and when `currentDocumentId` changes.
- Switching tabs calls `setActiveTab` then loads the tab's backing draft via the existing `loadDocumentState` path.
- `DocumentTabs.svelte` receives tabs + activeTabId as props, emits events for switch/create/rename/delete.

---

## 2. Layout Efficiency

### Problem

The AI sidebar is `position: fixed` — it doesn't affect document flow. When `appSettings.aiEnabled` is false, the document+annotations group sits left-aligned in a wide gray expanse.

### Fix

`+page.svelte` applies conditional padding to the editor wrapper:

- **AI enabled:** `pl-[72px]` — preserves space for the sidebar pill overlay (current behavior).
- **AI disabled:** symmetric padding that centers the ~900px doc+annotations group in the viewport. Uses `px-[max(2rem, calc((100vw - 1100px) / 2))]` or equivalent Tailwind approach.

No changes to `Editor.svelte` internals or the `Annotations` component. The annotation panel naturally gets right-side breathing room from the centering padding.

When AI is re-enabled, layout reverts to the left-biased state.

---

## Files to Change

| File | Change |
|---|---|
| `src-tauri/src/db/mod.rs` | Add `tabs` table + CRUD |
| `src-tauri/src/lib.rs` | Register new Tauri commands |
| `src/lib/db/types.ts` | Add `TabMeta` type |
| `src/lib/db/index.ts` | Add `listTabs`, `createTab`, `renameTab`, `deleteTab`, `getActiveTab`, `setActiveTab` |
| `src/lib/editor/DocumentTabs.svelte` | New tab bar component |
| `src/lib/editor/Editor.svelte` | Mount `<DocumentTabs>`, wire tab switching |
| `src/routes/+page.svelte` | Conditional padding based on `appSettings.aiEnabled` |

---

## Migration / Existing Documents

Existing documents have no tabs. On first load of a document with no tabs, the editor auto-creates a default "Tab 1" backed by that document's current active draft. This is handled in `Editor.svelte` after `listTabs` returns an empty array.

---

## Out of Scope

- Per-tab independent draft history (future issue)
- Tab reordering via drag
- Tabs in the library view
- Tab-specific settings or metadata
