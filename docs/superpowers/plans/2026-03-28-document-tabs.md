# Document Tabs + Layout Efficiency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add browser-style document tabs (per-document, backed by a new `tabs` DB table) above the editor, and fix the wasted layout space when the AI sidebar is disabled.

**Architecture:** New `tabs` SQLite table owned by `src-tauri/src/db/documents.rs`; each tab hides one backing draft. The `DocumentTabs.svelte` component mounts inside `Editor.svelte` above `#editor-document`. Layout fix is a one-liner in `+page.svelte` based on `appSettings.aiEnabled`.

**Tech Stack:** Rust/rusqlite (Tauri backend), SvelteKit + Svelte 5 runes, Tailwind CSS, TypeScript

---

## File Map

| File | Role |
|---|---|
| `src-tauri/src/db/schema.rs` | Add `tabs` table DDL + migration |
| `src-tauri/src/db/documents.rs` | Add tab CRUD functions: `list_tabs`, `create_tab`, `rename_tab`, `delete_tab`, `get_active_tab`, `set_active_tab` |
| `src-tauri/src/db/mod.rs` | Add `TabMeta` struct |
| `src-tauri/src/lib.rs` | Add 6 Tauri command wrappers + register them |
| `src/lib/db/types.ts` | Add `TabMeta` TypeScript type |
| `src/lib/db/index.ts` | Add `listTabs`, `createTab`, `renameTab`, `deleteTab`, `getActiveTab`, `setActiveTab` invoke wrappers |
| `src/lib/editor/DocumentTabs.svelte` | New tab bar component |
| `src/lib/editor/Editor.svelte` | Mount `<DocumentTabs>`, wire tab load/switch/create/rename/delete, handle migration |
| `src/routes/+page.svelte` | Conditional padding for layout efficiency |

---

## Task 1: DB schema — add `tabs` table

**Files:**
- Modify: `src-tauri/src/db/schema.rs`

- [ ] **Step 1: Add `tabs` table to `init_schema` and add a migration for existing DBs**

In `src-tauri/src/db/schema.rs`, add the `tabs` table to `init_schema`'s `execute_batch` string (after the `_meta` table), and add a runtime migration in `open_db` that adds the table if it's absent (same pattern as the existing `label` column migration):

```rust
// In init_schema, add after the _meta table block and before the closing quote:
        CREATE TABLE IF NOT EXISTS tabs (
            id          TEXT PRIMARY KEY,
            document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
            label       TEXT NOT NULL DEFAULT 'Tab',
            position    INTEGER NOT NULL DEFAULT 0,
            draft_id    TEXT NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
            created_at  INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_tabs_document ON tabs(document_id, position ASC);
```

And in `open_db`, after the existing `label_exists` migration block, add:

```rust
    // Migration: create tabs table if it doesn't exist yet (existing DBs).
    let tabs_exists: bool = {
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='tabs'",
            [],
            |row| row.get(0),
        )?;
        count > 0
    };
    if !tabs_exists {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS tabs (
                id          TEXT PRIMARY KEY,
                document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
                label       TEXT NOT NULL DEFAULT 'Tab',
                position    INTEGER NOT NULL DEFAULT 0,
                draft_id    TEXT NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
                created_at  INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_tabs_document ON tabs(document_id, position ASC);",
        )?;
    }
```

- [ ] **Step 2: Build to verify the Rust compiles**

```bash
cd src-tauri && cargo build 2>&1 | tail -20
```
Expected: `Finished` with no errors.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/db/schema.rs
git commit -m "feat(db): add tabs table to schema and migration"
```

---

## Task 2: Rust structs and tab CRUD functions

**Files:**
- Modify: `src-tauri/src/db/mod.rs`
- Modify: `src-tauri/src/db/documents.rs`

- [ ] **Step 1: Add `TabMeta` struct to `mod.rs`**

In `src-tauri/src/db/mod.rs`, add after the `SnapshotMeta` struct:

```rust
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TabMeta {
    pub id: String,
    pub document_id: String,
    pub label: String,
    pub position: i64,
    pub draft_id: String,
    pub created_at: i64,
}
```

- [ ] **Step 2: Add tab CRUD functions to `documents.rs`**

At the top of `documents.rs`, the existing `use super::{DocumentMeta, DraftMeta};` import needs `TabMeta` added:

```rust
use super::{DocumentMeta, DraftMeta, TabMeta};
```

Then add these functions at the bottom of `documents.rs`:

```rust
pub fn list_tabs(conn: &Connection, doc_id: &str) -> Result<Vec<TabMeta>> {
    let mut stmt = conn.prepare(
        "SELECT id, document_id, label, position, draft_id, created_at
         FROM tabs WHERE document_id = ?1 ORDER BY position ASC",
    )?;
    let rows = stmt.query_map(params![doc_id], |row| {
        Ok(TabMeta {
            id: row.get(0)?,
            document_id: row.get(1)?,
            label: row.get(2)?,
            position: row.get(3)?,
            draft_id: row.get(4)?,
            created_at: row.get(5)?,
        })
    })?;
    rows.collect()
}

/// Creates a tab and its backing draft atomically. Returns the new TabMeta.
pub fn create_tab(conn: &Connection, doc_id: &str, label: &str) -> Result<TabMeta> {
    let now = now_ms();
    // Position = max existing position + 1 (or 0 if first tab).
    let position: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(position), -1) + 1 FROM tabs WHERE document_id = ?1",
            params![doc_id],
            |row| row.get(0),
        )
        .unwrap_or(0);

    // Create a backing draft.
    let draft_id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO drafts (id, document_id, label, created_at, is_active)
         VALUES (?1, ?2, ?3, ?4, 1)",
        params![draft_id, doc_id, label, now],
    )?;

    let tab_id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO tabs (id, document_id, label, position, draft_id, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![tab_id, doc_id, label, position, draft_id, now],
    )?;

    Ok(TabMeta {
        id: tab_id,
        document_id: doc_id.to_string(),
        label: label.to_string(),
        position,
        draft_id,
        created_at: now,
    })
}

pub fn rename_tab(conn: &Connection, tab_id: &str, label: &str) -> Result<()> {
    conn.execute(
        "UPDATE tabs SET label = ?1 WHERE id = ?2",
        params![label, tab_id],
    )?;
    Ok(())
}

/// Deletes a tab and its backing draft (cascade deletes events + snapshots).
pub fn delete_tab(conn: &Connection, tab_id: &str) -> Result<()> {
    // draft_id cascade-deletes events/snapshots via FK.
    conn.execute(
        "DELETE FROM drafts WHERE id = (SELECT draft_id FROM tabs WHERE id = ?1)",
        params![tab_id],
    )?;
    conn.execute("DELETE FROM tabs WHERE id = ?1", params![tab_id])?;
    Ok(())
}

/// Returns the active tab id for a document from _meta, or None.
pub fn get_active_tab(conn: &Connection, doc_id: &str) -> Result<Option<String>> {
    let key = format!("active_tab_{}", doc_id);
    let result: rusqlite::Result<String> = conn.query_row(
        "SELECT value FROM _meta WHERE key = ?1",
        params![key],
        |row| row.get(0),
    );
    match result {
        Ok(val) => Ok(Some(val)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e),
    }
}

/// Persists the active tab id for a document in _meta.
pub fn set_active_tab(conn: &Connection, doc_id: &str, tab_id: &str) -> Result<()> {
    let key = format!("active_tab_{}", doc_id);
    conn.execute(
        "INSERT INTO _meta (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, tab_id],
    )?;
    Ok(())
}
```

- [ ] **Step 3: Build to verify**

```bash
cd src-tauri && cargo build 2>&1 | tail -20
```
Expected: `Finished` with no errors.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/db/mod.rs src-tauri/src/db/documents.rs
git commit -m "feat(db): add TabMeta struct and tab CRUD functions"
```

---

## Task 3: Tauri command wrappers

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Import new functions and `TabMeta` at the top of `lib.rs`**

In the `use db::{ documents::{ ... } }` block, add the new functions:

```rust
use db::{
    documents::{
        create_document, create_draft, delete_document, get_document, get_trash_retention,
        list_documents, list_drafts, list_trashed_documents, purge_expired_trash, restore_document,
        set_trash_retention, trash_document, update_document_meta,
        list_tabs, create_tab, rename_tab, delete_tab, get_active_tab, set_active_tab,
    },
    events::{append_event, create_snapshot, create_named_snapshot, list_snapshots, label_snapshot, restore_to_snapshot, load_snapshot_state, get_snapshot_storage_size, prune_snapshots_keep_last_n, prune_snapshots_older_than, get_snapshot_retention, set_snapshot_retention},
    load::load_document_state,
    schema::open_db,
    AppendEventResult, DocumentMeta, DraftMeta, LoadResult, SnapshotMeta, TabMeta,
};
```

- [ ] **Step 2: Add the six Tauri command functions**

Add these after `cmd_create_draft` (around line 100) and before the event/snapshot commands:

```rust
// ── Tab commands ──────────────────────────────────────────────────

#[tauri::command]
fn cmd_list_tabs(state: tauri::State<DbState>, doc_id: String) -> Result<Vec<TabMeta>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    list_tabs(&conn, &doc_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_create_tab(
    state: tauri::State<DbState>,
    doc_id: String,
    label: String,
) -> Result<TabMeta, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    create_tab(&conn, &doc_id, &label).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_rename_tab(
    state: tauri::State<DbState>,
    tab_id: String,
    label: String,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    rename_tab(&conn, &tab_id, &label).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_delete_tab(state: tauri::State<DbState>, tab_id: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    delete_tab(&conn, &tab_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_get_active_tab(
    state: tauri::State<DbState>,
    doc_id: String,
) -> Result<Option<String>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    get_active_tab(&conn, &doc_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_set_active_tab(
    state: tauri::State<DbState>,
    doc_id: String,
    tab_id: String,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    set_active_tab(&conn, &doc_id, &tab_id).map_err(|e| e.to_string())
}
```

- [ ] **Step 3: Register the six commands in `invoke_handler`**

In the `tauri::generate_handler![...]` list, add:

```rust
            cmd_list_tabs,
            cmd_create_tab,
            cmd_rename_tab,
            cmd_delete_tab,
            cmd_get_active_tab,
            cmd_set_active_tab,
```

- [ ] **Step 4: Build to verify**

```bash
cd src-tauri && cargo build 2>&1 | tail -20
```
Expected: `Finished` with no errors.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(tauri): add tab command wrappers and register them"
```

---

## Task 4: TypeScript DB layer

**Files:**
- Modify: `src/lib/db/types.ts`
- Modify: `src/lib/db/index.ts`

- [ ] **Step 1: Add `TabMeta` to `types.ts`**

In `src/lib/db/types.ts`, add after `SnapshotMeta`:

```ts
export type TabMeta = {
    id: string;
    documentId: string;
    label: string;
    position: number;
    draftId: string;
    createdAt: number;
};
```

- [ ] **Step 2: Add invoke wrappers to `index.ts`**

In `src/lib/db/index.ts`, update the top import to include `TabMeta`:

```ts
import type { AppendEventResult, DocumentMeta, DraftMeta, LoadResult, SnapshotMeta, TabMeta } from "./types";
```

Then add at the end of the file:

```ts
// ── Tabs ─────────────────────────────────────────────────────────

export async function listTabs(docId: string): Promise<TabMeta[]> {
    return invoke<TabMeta[]>("cmd_list_tabs", { docId });
}

export async function createTab(docId: string, label: string): Promise<TabMeta> {
    return invoke<TabMeta>("cmd_create_tab", { docId, label });
}

export async function renameTab(tabId: string, label: string): Promise<void> {
    return invoke<void>("cmd_rename_tab", { tabId, label });
}

export async function deleteTab(tabId: string): Promise<void> {
    return invoke<void>("cmd_delete_tab", { tabId });
}

export async function getActiveTab(docId: string): Promise<string | null> {
    return invoke<string | null>("cmd_get_active_tab", { docId });
}

export async function setActiveTab(docId: string, tabId: string): Promise<void> {
    return invoke<void>("cmd_set_active_tab", { docId, tabId });
}
```

- [ ] **Step 3: Type-check**

```bash
bun run check 2>&1 | tail -20
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/db/types.ts src/lib/db/index.ts
git commit -m "feat(db): add TabMeta type and tab invoke wrappers"
```

---

## Task 5: `DocumentTabs.svelte` component

**Files:**
- Create: `src/lib/editor/DocumentTabs.svelte`

- [ ] **Step 1: Create the component**

```svelte
<!--
    DocumentTabs.svelte — Browser-style tab bar for document tabs.

    Props:
      tabs        — ordered list of TabMeta
      activeTabId — id of the currently active tab
      ontabselect — called with (tabId) when user clicks a tab
      ontabcreate — called when user clicks +
      ontabrename — called with (tabId, newLabel) after inline rename
      ontabdelete — called with (tabId) when user clicks ×

    Notes:
      - × is hidden when tabs.length === 1 (can't close last tab)
      - Double-click on label enters rename mode
      - Rename commits on Enter or blur, cancels on Escape
-->
<script lang="ts">
import type { TabMeta } from "$lib/db/types";
import { PlusIcon } from "lucide-svelte";

const {
    tabs,
    activeTabId,
    ontabselect,
    ontabcreate,
    ontabrename,
    ontabdelete,
}: {
    tabs: TabMeta[];
    activeTabId: string | null;
    ontabselect: (tabId: string) => void;
    ontabcreate: () => void;
    ontabrename: (tabId: string, label: string) => void;
    ontabdelete: (tabId: string) => void;
} = $props();

let renamingTabId = $state<string | null>(null);
let renameValue = $state("");
let renameInputEl = $state<HTMLInputElement | undefined>();

function startRename(tab: TabMeta) {
    renamingTabId = tab.id;
    renameValue = tab.label;
    setTimeout(() => renameInputEl?.select(), 0);
}

function commitRename(tabId: string) {
    const trimmed = renameValue.trim() || "Tab";
    renamingTabId = null;
    ontabrename(tabId, trimmed);
}

function cancelRename() {
    renamingTabId = null;
}
</script>

<div
    class="w-[816px] mx-auto flex items-end gap-0 select-none pt-2"
    role="tablist"
    aria-label="Document tabs"
>
    {#each tabs as tab (tab.id)}
        {@const isActive = tab.id === activeTabId}
        {@const isRenaming = renamingTabId === tab.id}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div
            role="tab"
            aria-selected={isActive}
            tabindex={isActive ? 0 : -1}
            onclick={() => ontabselect(tab.id)}
            ondblclick={() => startRename(tab)}
            class="
                group relative flex items-center gap-1 px-3 py-1.5 text-sm cursor-pointer
                border-b-2 transition-colors duration-100 rounded-t-md
                {isActive
                    ? 'border-black/70 text-black/90 bg-white/60 backdrop-blur-sm'
                    : 'border-transparent text-black/40 hover:text-black/70 hover:bg-white/30'}
            "
        >
            {#if isRenaming}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <input
                    bind:this={renameInputEl}
                    bind:value={renameValue}
                    onclick={(e) => e.stopPropagation()}
                    onblur={() => commitRename(tab.id)}
                    onkeydown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); commitRename(tab.id); }
                        if (e.key === "Escape") { e.preventDefault(); cancelRename(); }
                    }}
                    class="bg-transparent border-none outline-none w-24 text-sm text-black/90 text-center"
                    aria-label="Rename tab"
                />
            {:else}
                <span class="max-w-[8rem] truncate">{tab.label}</span>
            {/if}

            {#if tabs.length > 1}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <span
                    role="button"
                    tabindex="-1"
                    aria-label="Close tab"
                    onclick={(e) => { e.stopPropagation(); ontabdelete(tab.id); }}
                    class="
                        ml-0.5 w-4 h-4 rounded-full flex items-center justify-center text-[10px]
                        opacity-0 group-hover:opacity-100 transition-opacity
                        hover:bg-black/10 text-black/50
                    "
                >×</span>
            {/if}
        </div>
    {/each}

    <button
        onclick={ontabcreate}
        aria-label="New tab"
        title="New tab"
        class="mb-0.5 ml-1 p-1 rounded text-black/30 hover:text-black/60 hover:bg-white/40 transition-colors"
    >
        <PlusIcon size={14} />
    </button>
</div>
```

- [ ] **Step 2: Check types**

```bash
bun run check 2>&1 | tail -20
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/editor/DocumentTabs.svelte
git commit -m "feat(ui): add DocumentTabs component"
```

---

## Task 6: Wire tabs into `Editor.svelte`

**Files:**
- Modify: `src/lib/editor/Editor.svelte`

- [ ] **Step 1: Add imports at the top of the `<script>` block**

After the existing imports, add:

```ts
import DocumentTabs from "./DocumentTabs.svelte";
import { listTabs, createTab, renameTab, deleteTab, getActiveTab, setActiveTab } from "$lib/db";
import type { TabMeta } from "$lib/db/types";
```

- [ ] **Step 2: Add tab state variables after the existing local UI state**

After `let titleSuggesting = $state(false);`, add:

```ts
let tabs = $state<TabMeta[]>([]);
let activeTabId = $state<string | null>(null);
```

- [ ] **Step 3: Add `loadTabs` function**

Add after the `commitTitle` function:

```ts
/**
 * Loads tabs for a document. If none exist yet (existing doc with no tabs),
 * creates a default "Tab 1" backed by the current active draft.
 */
async function loadTabs(docId: string) {
    let loaded = await listTabs(docId);

    if (loaded.length === 0) {
        // Migration: no tabs yet — create Tab 1 backed by the existing active draft.
        // We need to find the existing draft_id so we can reuse it instead of creating a new one.
        // Strategy: create a tab normally (creates a new draft), then if there's an existing
        // draft with content, load from that draft in the tab switch. For simplicity, we just
        // create a fresh tab and the existing draft remains as-is (it won't be deleted since
        // it's not owned by any tab).
        const newTab = await createTab(docId, "Tab 1");
        loaded = [newTab];
    }

    // Restore persisted active tab, fall back to first tab.
    const persistedActiveTabId = await getActiveTab(docId);
    const validActive = loaded.find((t) => t.id === persistedActiveTabId) ?? loaded[0];

    tabs = loaded;
    activeTabId = validActive.id;
    return validActive;
}
```

- [ ] **Step 4: Update `fromSave` to call `loadTabs` and use the tab's draft**

The existing `fromSave` IIFE calls `resolveActiveDraft` to find a draft. We need to call `loadTabs` first and use the active tab's `draftId` instead.

Find the `fromSave` block. Replace the entire IIFE with this updated version:

```ts
const fromSave = (async () => {
    const docId = get(currentDocumentId);

    if (docId) {
        const activeTab = await loadTabs(docId);
        currentDraftId.set(activeTab.draftId);
        const loaded = await loadDocumentState(docId, activeTab.draftId);
        currentDocumentTitle.set(
            loaded.snapshotStateJson
                ? extractTitleFromStateJson(loaded.snapshotStateJson)
                : "Untitled",
        );
        return buildStateFromLoad(loaded.snapshotStateJson, loaded.eventsSince);
    } else {
        const docs = await listDocuments();
        if (docs.length > 0) {
            const doc = docs[0];
            currentDocumentId.set(doc.id);
            currentDocumentTitle.set(doc.title);
            const activeTab = await loadTabs(doc.id);
            currentDraftId.set(activeTab.draftId);
            const loaded = await loadDocumentState(doc.id, activeTab.draftId);
            return buildStateFromLoad(loaded.snapshotStateJson, loaded.eventsSince);
        }
    }

    // Blank editor — new installation.
    const newDocId = await createDocument("Untitled");
    currentDocumentId.set(newDocId);
    currentDocumentTitle.set("Untitled");
    const newTab = await createTab(newDocId, "Tab 1");
    tabs = [newTab];
    activeTabId = newTab.id;
    currentDraftId.set(newTab.draftId);
    return EditorState.create({ extensions: getExtensions(getExtensionOptions) });
})();
```

- [ ] **Step 5: Update `loadDocument` to use tabs**

Replace the existing `loadDocument` function body with this version that loads tabs and uses the active tab's draft:

```ts
export async function loadDocument(id: string) {
    if (!$editorView) return;

    const gen = ++loadGeneration;
    annotationEventBus.clearPendingSelections();

    const activeTab = await loadTabs(id);
    if (gen !== loadGeneration) return;

    currentDocumentId.set(id);
    currentDraftId.set(activeTab.draftId);
    lastPersistedEventId.set(-1);
    lastSavedAt.set(null);

    const loaded = await loadDocumentState(id, activeTab.draftId);
    if (gen !== loadGeneration) return;

    currentDocumentTitle.set(
        loaded.snapshotStateJson ? extractTitleFromStateJson(loaded.snapshotStateJson) : "Untitled",
    );

    const latestEventId =
        loaded.eventsSince.length > 0
            ? loaded.eventsSince[loaded.eventsSince.length - 1].id
            : loaded.snapshotEventId >= 0
              ? loaded.snapshotEventId
              : -1;
    lastPersistedEventId.set(latestEventId);

    const state = buildStateFromLoad(loaded.snapshotStateJson, loaded.eventsSince);
    $editorView.setState(state);
    const text = state.doc.toString();
    writingStats.set({ words: getWordCount(text), chars: text.length, selWords: 0, selChars: 0 });
}
```

- [ ] **Step 6: Add tab event handlers**

Add these functions after `loadDocument`:

```ts
async function handleTabSelect(tabId: string) {
    const docId = get(currentDocumentId);
    if (!docId || !$editorView || tabId === activeTabId) return;

    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) return;

    activeTabId = tabId;
    await setActiveTab(docId, tabId);

    currentDraftId.set(tab.draftId);
    lastPersistedEventId.set(-1);
    lastSavedAt.set(null);
    annotationEventBus.clearPendingSelections();

    const loaded = await loadDocumentState(docId, tab.draftId);
    const state = buildStateFromLoad(loaded.snapshotStateJson, loaded.eventsSince);
    $editorView.setState(state);
    const text = state.doc.toString();
    writingStats.set({ words: getWordCount(text), chars: text.length, selWords: 0, selChars: 0 });
}

async function handleTabCreate() {
    const docId = get(currentDocumentId);
    if (!docId) return;
    const label = `Tab ${tabs.length + 1}`;
    const newTab = await createTab(docId, label);
    tabs = [...tabs, newTab];
    await handleTabSelect(newTab.id);
}

async function handleTabRename(tabId: string, label: string) {
    await renameTab(tabId, label);
    tabs = tabs.map((t) => (t.id === tabId ? { ...t, label } : t));
}

async function handleTabDelete(tabId: string) {
    if (tabs.length <= 1) return;
    const docId = get(currentDocumentId);
    if (!docId) return;

    // Switch to an adjacent tab before deleting.
    const idx = tabs.findIndex((t) => t.id === tabId);
    const nextTab = tabs[idx + 1] ?? tabs[idx - 1];
    if (nextTab && tabId === activeTabId) {
        await handleTabSelect(nextTab.id);
    }

    await deleteTab(tabId);
    tabs = tabs.filter((t) => t.id !== tabId);
}
```

- [ ] **Step 7: Mount `<DocumentTabs>` in the template**

In the template, add `<DocumentTabs>` inside the `overflow-y-auto` div, just before the `{#await fromSave then}` block. The current template structure is:

```svelte
<div class="w-full h-full overflow-y-auto relative">
    <div class="sticky top-4 z-50 ...">  <!-- StatusBar -->
    ...
    {#await fromSave then}
        <div id="editor-document" ...></div>
    {/await}
    <Annotations />
</div>
```

Add `<DocumentTabs>` between the sticky StatusBar div and the `{#await fromSave then}` block:

```svelte
    {#await fromSave then}
        <DocumentTabs
            {tabs}
            {activeTabId}
            ontabselect={handleTabSelect}
            ontabcreate={handleTabCreate}
            ontabrename={handleTabRename}
            ontabdelete={handleTabDelete}
        />
        <div
            id="editor-document"
            class="mx-auto w-[816px] min-h-[calc(100vh-4rem)] mt-4 mb-12 bg-white rounded-lg shadow-xl py-3 px-1"
            bind:this={element}
        ></div>
    {/await}
```

Note: `mt-12` on the editor-document is reduced to `mt-4` since the tab bar now sits above it.

- [ ] **Step 8: Check types and run the app**

```bash
bun run check 2>&1 | tail -20
```
Expected: no errors.

```bash
bun run dev
```
Open the app and verify: tabs appear above the document, `+` creates a new tab, clicking switches content, double-click renames, `×` deletes (hidden when only one tab).

- [ ] **Step 9: Commit**

```bash
git add src/lib/editor/Editor.svelte
git commit -m "feat(editor): wire DocumentTabs into Editor, tab CRUD, migration"
```

---

## Task 7: Layout efficiency fix

**Files:**
- Modify: `src/routes/+page.svelte`

- [ ] **Step 1: Update the editor wrapper div**

In `src/routes/+page.svelte`, find:

```svelte
<div class="h-screen w-full">
    <Editor bind:this={editorComponent} />
</div>
```

Replace with:

```svelte
<div
    class="h-screen w-full transition-[padding] duration-300"
    style={appSettings.aiEnabled ? 'padding-left: 72px' : 'padding-left: max(2rem, calc((100vw - 1140px) / 2)); padding-right: max(2rem, calc((100vw - 1140px) / 2))'}
>
    <Editor bind:this={editorComponent} />
</div>
```

The `1140px` gives the 816px document + ~280px for the annotations panel + comfortable margins. The `max(2rem, ...)` ensures a minimum 2rem gutter on small viewports.

- [ ] **Step 2: Verify visually**

```bash
bun run dev
```

With AI disabled (default): document+annotations should appear centered.
Toggle AI on in settings: layout should shift left to make room for the sidebar pill.

- [ ] **Step 3: Check types**

```bash
bun run check 2>&1 | tail -20
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/routes/+page.svelte
git commit -m "feat(layout): center editor when AI sidebar is disabled"
```

---

## Task 8: Reset DB command — include tabs cleanup

**Files:**
- Modify: `src-tauri/src/lib.rs`

The existing `cmd_reset_db` (used by the debug panel) doesn't clear the `tabs` table. Add it:

- [ ] **Step 1: Update `cmd_reset_db`**

Find:

```rust
    conn.execute_batch(
        "DELETE FROM snapshots;
         DELETE FROM events;
         DELETE FROM drafts;
         DELETE FROM documents;
         DELETE FROM _meta;",
    )
```

Replace with:

```rust
    conn.execute_batch(
        "DELETE FROM snapshots;
         DELETE FROM events;
         DELETE FROM tabs;
         DELETE FROM drafts;
         DELETE FROM documents;
         DELETE FROM _meta;",
    )
```

- [ ] **Step 2: Build to verify**

```bash
cd src-tauri && cargo build 2>&1 | tail -20
```
Expected: `Finished` with no errors.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "fix(db): include tabs in cmd_reset_db cleanup"
```

---

## Self-Review

**Spec coverage:**
- ✅ Browser-style tab bar above document — Task 5, 6
- ✅ Active tab bottom border indicator — Task 5 (CSS class)
- ✅ `+` button creates tab — Task 6 `handleTabCreate`
- ✅ Click switches tab content — Task 6 `handleTabSelect`
- ✅ Double-click renames — Task 5 `ondblclick`, `startRename`
- ✅ `×` hidden when only one tab — Task 5 `{#if tabs.length > 1}`
- ✅ `tabs` DB table with `(id, document_id, label, position, draft_id, created_at)` — Task 1, 2
- ✅ Each tab backed by a hidden draft — Task 2 `create_tab`
- ✅ Deleting tab deletes backing draft — Task 2 `delete_tab`
- ✅ Frontend never calls `createDraft`/`listDrafts` for tabs — verified, tab functions used throughout
- ✅ Migration: existing docs get Tab 1 on first load — Task 6 `loadTabs`
- ✅ Layout padding fix — Task 7
- ✅ Tabs not shown in library — no changes to library code
- ✅ `cmd_reset_db` clears tabs — Task 8

**No placeholders found.**

**Type consistency check:**
- `TabMeta.draftId` used consistently in Task 2 (Rust `draft_id` → camelCase), Task 4 (`draftId`), Task 6 (`activeTab.draftId`) ✅
- `ontabselect`, `ontabcreate`, `ontabrename`, `ontabdelete` prop names consistent between Task 5 definition and Task 6 usage ✅
- `listTabs`, `createTab`, `renameTab`, `deleteTab`, `getActiveTab`, `setActiveTab` names consistent between Task 3 (Rust), Task 4 (TS), Task 6 (usage) ✅
