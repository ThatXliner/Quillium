# Multi-Window Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to open documents in separate OS windows via explicit "Open in New Window" actions.

**Architecture:** New `OpenWindows` state in Rust tracks which documents are open in which windows. A new Tauri command creates `WebviewWindow` instances with a `?doc=` query param. The frontend reads this param to load the correct document. Each window gets its own SvelteKit JS context so stores are naturally isolated.

**Tech Stack:** Tauri 2 (Rust), SvelteKit, TypeScript

**Spec:** `docs/superpowers/specs/2026-04-02-multi-window-design.md`

---

### Task 1: Add `OpenWindows` state and `cmd_open_in_new_window` command

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/Cargo.toml` (no change needed — `uuid` already a dependency)

- [ ] **Step 1: Add the `OpenWindows` state struct and manage it in setup**

In `src-tauri/src/lib.rs`, add after the `DbState` struct (line 23):

```rust
pub struct OpenWindows(pub std::sync::Arc<Mutex<std::collections::HashMap<String, String>>>);
```

In the `setup` closure, after `app.manage(DbState(...))` (line 338), add:

```rust
app.manage(OpenWindows(std::sync::Arc::new(Mutex::new(std::collections::HashMap::new()))));
```

Add `std::collections::HashMap` to imports.

- [ ] **Step 2: Add the `cmd_open_in_new_window` command**

Add this command in `src-tauri/src/lib.rs` after the `cmd_reset_db` function (after line 281):

```rust
#[tauri::command]
fn cmd_open_in_new_window(
    app: tauri::AppHandle,
    open_windows: tauri::State<OpenWindows>,
    doc_id: String,
) -> Result<(), String> {
    let mut map = open_windows.0.lock().map_err(|e| e.to_string())?;

    // If the document is already open in another window, focus it.
    if let Some(label) = map.get(&doc_id) {
        if let Some(win) = app.get_webview_window(label) {
            win.set_focus().map_err(|e| e.to_string())?;
            return Ok(());
        }
        // Window no longer exists — clean up stale entry.
        map.remove(&doc_id);
    }

    let short_id = uuid::Uuid::new_v4().to_string()[..8].to_string();
    let label = format!("editor-{short_id}");
    let url = format!("/?doc={doc_id}");

    let window = tauri::WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::App(url.into()))
        .title("Quillium")
        .inner_size(1373.0, 1170.0)
        .min_inner_size(900.0, 600.0)
        .build()
        .map_err(|e| e.to_string())?;

    map.insert(doc_id.clone(), label.clone());

    // Clean up when the window is closed.
    let arc_clone = open_windows.0.clone();
    let doc_id_clone = doc_id.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::Destroyed = event {
            if let Ok(mut m) = arc_clone.lock() {
                m.remove(&doc_id_clone);
            }
        }
    });

    Ok(())
}
```

- [ ] **Step 3: Add `cmd_register_open_doc` and `cmd_deregister_open_doc` commands**

These let the frontend register/deregister the main window's current document. Add after `cmd_open_in_new_window`:

```rust
#[tauri::command]
fn cmd_register_open_doc(
    open_windows: tauri::State<OpenWindows>,
    doc_id: String,
    window_label: String,
) -> Result<(), String> {
    let mut map = open_windows.0.lock().map_err(|e| e.to_string())?;
    map.insert(doc_id, window_label);
    Ok(())
}

#[tauri::command]
fn cmd_deregister_open_doc(
    open_windows: tauri::State<OpenWindows>,
    window_label: String,
) -> Result<(), String> {
    let mut map = open_windows.0.lock().map_err(|e| e.to_string())?;
    map.retain(|_, v| v != &window_label);
    Ok(())
}

#[tauri::command]
fn cmd_is_doc_open_elsewhere(
    open_windows: tauri::State<OpenWindows>,
    app: tauri::AppHandle,
    doc_id: String,
    window_label: String,
) -> Result<bool, String> {
    let map = open_windows.0.lock().map_err(|e| e.to_string())?;
    match map.get(&doc_id) {
        Some(label) if label != &window_label => {
            // Focus the window that has it open.
            if let Some(win) = app.get_webview_window(label) {
                let _ = win.set_focus();
            }
            Ok(true)
        }
        _ => Ok(false),
    }
}
```

- [ ] **Step 4: Register all new commands in the invoke handler**

In the `.invoke_handler(tauri::generate_handler![...])` block (line 411), add:

```rust
cmd_open_in_new_window,
cmd_register_open_doc,
cmd_deregister_open_doc,
cmd_is_doc_open_elsewhere,
```

- [ ] **Step 5: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: Compiles with no errors.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: add OpenWindows state and multi-window Tauri commands"
```

---

### Task 2: Update capabilities for dynamic windows

**Files:**
- Modify: `src-tauri/capabilities/default.json`
- Modify: `src-tauri/capabilities/desktop.json`

- [ ] **Step 1: Update default.json**

Change `"windows": ["main"]` to:

```json
"windows": ["main", "editor-*"]
```

- [ ] **Step 2: Update desktop.json**

Change `"windows": ["main"]` to:

```json
"windows": ["main", "editor-*"]
```

- [ ] **Step 3: Commit**

```bash
git add src-tauri/capabilities/default.json src-tauri/capabilities/desktop.json
git commit -m "feat: grant capabilities to dynamic editor windows"
```

---

### Task 3: Add frontend invoke wrappers

**Files:**
- Modify: `src/lib/db/index.ts`

- [ ] **Step 1: Add the new invoke wrappers**

At the end of `src/lib/db/index.ts`, add:

```typescript
// ── Multi-window ─────────────────────────────────────────────────

export async function openInNewWindow(docId: string): Promise<void> {
    return invoke<void>("cmd_open_in_new_window", { docId });
}

export async function registerOpenDoc(docId: string, windowLabel: string): Promise<void> {
    return invoke<void>("cmd_register_open_doc", { docId, windowLabel });
}

export async function deregisterOpenDoc(windowLabel: string): Promise<void> {
    return invoke<void>("cmd_deregister_open_doc", { windowLabel });
}

export async function isDocOpenElsewhere(docId: string, windowLabel: string): Promise<boolean> {
    return invoke<boolean>("cmd_is_doc_open_elsewhere", { docId, windowLabel });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/db/index.ts
git commit -m "feat: add multi-window invoke wrappers"
```

---

### Task 4: Frontend reads `?doc=` query param on editor page

**Files:**
- Modify: `src/routes/+page.svelte`
- Modify: `src/lib/editor/Editor.svelte`

- [ ] **Step 1: Pass doc query param from +page.svelte to Editor**

In `src/routes/+page.svelte`, add an import at the top of the `<script>` block:

```typescript
import { page } from "$app/state";
```

Then in the script, derive the doc param:

```typescript
const initialDocId = page.url.searchParams.get("doc");
```

On mount (or before Editor mounts), if `initialDocId` is set, write it to the store so Editor picks it up:

```typescript
if (initialDocId) {
    $currentDocumentId = initialDocId;
}
```

This should go before the Editor component mounts. Add it in the `<script>` section after the imports (not in `onMount`, since it needs to be set before Editor's `fromSave` runs). Since `+page.svelte` already imports `currentDocumentId` indirectly through other imports, add a direct import if needed:

```typescript
import { currentDocumentId } from "$lib/stores";
```

(It's already imported via the destructuring on line 27.)

The store write should be placed after the variable declarations but before any `onMount`:

```typescript
// If opened as a secondary window with a specific document, set it immediately
// so Editor.svelte's fromSave picks it up.
const initialDocId = page.url.searchParams.get("doc");
if (initialDocId) {
    $currentDocumentId = initialDocId;
}
```

Place this around line 51, after the `$state` declarations and before `showTutorialOnFirstVisit`.

- [ ] **Step 2: Verify existing Editor.svelte handles it**

No changes needed in Editor.svelte — the `fromSave` function (line 232) already checks `get(currentDocumentId)` and loads that document if set. The `?doc=` param flows through because we set the store before mount.

- [ ] **Step 3: Commit**

```bash
git add src/routes/+page.svelte
git commit -m "feat: read doc query param for multi-window document loading"
```

---

### Task 5: Register/deregister documents in OpenWindows from the frontend

**Files:**
- Modify: `src/lib/editor/Editor.svelte`
- Modify: `src/lib/navigation.ts`

- [ ] **Step 1: Get the current window label**

In `src/lib/editor/Editor.svelte`, add an import:

```typescript
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
```

- [ ] **Step 2: Register on document load, deregister on switch**

In the `fromSave` async IIFE (around line 232), after `currentDocumentId` is resolved and set, register it. The cleanest place is to add registration calls inside the `currentDocumentId.subscribe` block (line 361) and in `fromSave` itself.

Add a helper at the top of the `<script>`:

```typescript
import { registerOpenDoc, deregisterOpenDoc } from "$lib/db";

const windowLabel = getCurrentWebviewWindow().label;
```

Then modify the `currentDocumentId.subscribe` callback (line 361):

```typescript
const unsubscribe = currentDocumentId.subscribe((id) => {
    if (!initialised) {
        initialised = true;
        // Register the initial document.
        if (id) registerOpenDoc(id, windowLabel).catch(console.error);
        return;
    }
    // Deregister previous, register new.
    deregisterOpenDoc(windowLabel).catch(console.error);
    if (id) {
        registerOpenDoc(id, windowLabel).catch(console.error);
        fromSave.then(() => loadDocument(id));
    }
});
```

In the cleanup function (line 371), deregister:

```typescript
return () => {
    unsubscribe();
    deregisterOpenDoc(windowLabel).catch(console.error);
};
```

- [ ] **Step 3: Deregister when navigating to library**

In `src/lib/navigation.ts`, add:

```typescript
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { deregisterOpenDoc } from "$lib/db";
```

Update `goToLibrary`:

```typescript
export function goToLibrary(): Promise<void> {
    document.documentElement.setAttribute("data-direction", "left");
    posthog.capture("navigated_to_library");
    deregisterOpenDoc(getCurrentWebviewWindow().label).catch(console.error);
    return goto("/library");
}
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/editor/Editor.svelte src/lib/navigation.ts
git commit -m "feat: register/deregister open documents for multi-window tracking"
```

---

### Task 6: Guard against opening duplicate documents in-window

**Files:**
- Modify: `src/routes/library/+page.svelte`

- [ ] **Step 1: Add duplicate check to `handleOpen`**

In `src/routes/library/+page.svelte`, import the new function:

```typescript
import { isDocOpenElsewhere } from "$lib/db";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
```

Modify `handleOpen` (line 117):

```typescript
async function handleOpen(id: string) {
    // Check if the document is already open in another window.
    const elsewhere = await isDocOpenElsewhere(id, getCurrentWebviewWindow().label);
    if (elsewhere) {
        toast.info("This document is already open in another window.");
        return;
    }
    posthog.capture("document_opened");
    $currentDocumentId = id;
    const doc = documents.find((d) => d.id === id);
    if (doc) $currentDocumentTitle = doc.title;
    goToEditor();
}
```

Add `toast` import if not already present (the library page doesn't currently import it):

```typescript
import { toast } from "svelte-sonner";
```

And add a `<Toaster />` component in the template, or verify one is already rendered. Since the library page doesn't have one, add it at the end of the template before the closing tag:

```svelte
<Toaster position="bottom-center" />
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/library/+page.svelte
git commit -m "feat: guard against opening duplicate documents across windows"
```

---

### Task 7: Add "Open in New Window" to library context menu

**Files:**
- Modify: `src/lib/library/DocumentCard.svelte`
- Modify: `src/lib/library/DocumentGrid.svelte`
- Modify: `src/routes/library/+page.svelte`

- [ ] **Step 1: Add `onOpenInNewWindow` prop to DocumentCard**

In `src/lib/library/DocumentCard.svelte`, add to the `Props` interface (line 9):

```typescript
onOpenInNewWindow: () => void;
```

Add to the destructuring (line 21):

```typescript
const {
    doc,
    selected,
    viewMode,
    trashMode,
    onSelect,
    onOpen,
    onOpenInNewWindow,
    onTrash,
    onRestore,
    onDeletePermanent,
}: Props = $props();
```

- [ ] **Step 2: Add context menu to DocumentCard**

Add a `contextmenu` handler to both the grid-view div (line 69) and list-view div (line 142). For the grid view div:

```svelte
oncontextmenu={(e) => {
    if (!trashMode) {
        e.preventDefault();
        onOpenInNewWindow();
    }
}}
```

Wait — a bare `oncontextmenu` that always fires "open in new window" is too aggressive. We need a proper context menu. But to keep this minimal, let's use a simple approach: add an "Open in New Window" button alongside the existing action buttons, and wire context menu to a small dropdown.

Actually, the simplest approach that matches macOS conventions: add a `contextmenu` event that shows a minimal custom context menu. But building a custom context menu component adds complexity. The simplest viable approach:

Add an "Open in New Window" icon button next to the trash button in the hover overlay (non-trash mode). In `DocumentCard.svelte`, in the non-trash action buttons section (line 130-138 for grid, line 203-210 for list):

For grid view, replace the single trash button (lines 131-137) with:

```svelte
{:else}
    <div class="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
            onclick={(e) => { e.stopPropagation(); onOpenInNewWindow(); }}
            title="Open in new window"
            class="w-7 h-7 rounded-full bg-white/90 border border-gray-200 text-black/40 hover:text-blue-500 hover:border-blue-200 flex items-center justify-center shadow-sm"
        >
            <ExternalLink size={12} />
        </button>
        <button
            onclick={(e) => { e.stopPropagation(); onTrash(); }}
            title="Move to trash"
            class="w-7 h-7 rounded-full bg-white/90 border border-gray-200 text-black/40 hover:text-red-400 hover:border-red-200 flex items-center justify-center shadow-sm"
        >
            <Trash2 size={12} />
        </button>
    </div>
{/if}
```

For list view, replace the single trash button (lines 203-209) with:

```svelte
{:else}
    <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
            onclick={(e) => { e.stopPropagation(); onOpenInNewWindow(); }}
            title="Open in new window"
            class="w-7 h-7 rounded-full bg-white border border-gray-200 text-black/30 hover:text-blue-500 hover:border-blue-200 flex items-center justify-center shadow-sm"
        >
            <ExternalLink size={12} />
        </button>
        <button
            onclick={(e) => { e.stopPropagation(); onTrash(); }}
            title="Move to trash"
            class="w-7 h-7 rounded-full bg-white border border-gray-200 text-black/30 hover:text-red-400 hover:border-red-200 flex items-center justify-center shadow-sm"
        >
            <Trash2 size={12} />
        </button>
    </div>
{/if}
```

Add the icon import at the top:

```typescript
import { Trash2, RotateCcw, X, ExternalLink } from "lucide-svelte";
```

- [ ] **Step 3: Thread `onOpenInNewWindow` through DocumentGrid**

In `src/lib/library/DocumentGrid.svelte`, add to the `Props` interface:

```typescript
onOpenInNewWindow: (id: string) => void;
```

Add to the destructuring and pass through to both `DocumentCard` instances:

```svelte
onOpenInNewWindow={() => onOpenInNewWindow(doc.id)}
```

- [ ] **Step 4: Wire up in library page**

In `src/routes/library/+page.svelte`, add:

```typescript
import { openInNewWindow } from "$lib/db";
```

Add a handler function:

```typescript
function handleOpenInNewWindow(id: string) {
    posthog.capture("document_opened_new_window");
    openInNewWindow(id);
}
```

Pass it to `DocumentGrid`:

```svelte
onOpenInNewWindow={handleOpenInNewWindow}
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/library/DocumentCard.svelte src/lib/library/DocumentGrid.svelte src/routes/library/+page.svelte
git commit -m "feat: add Open in New Window button to library document cards"
```

---

### Task 8: Add "Open in New Window" to the native File menu

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/routes/library/+page.svelte`

- [ ] **Step 1: Add menu item in Rust**

In `src-tauri/src/lib.rs`, in the `file_menu` builder (line 359), add the new item after the "Library" item:

```rust
let file_menu = SubmenuBuilder::new(app, "File")
    .item(
        &MenuItemBuilder::with_id("library", "Library")
            .accelerator("CmdOrCtrl+O")
            .build(app)?,
    )
    .item(
        &MenuItemBuilder::with_id("open-in-new-window", "Open in New Window")
            .accelerator("CmdOrCtrl+Shift+O")
            .build(app)?,
    )
    .build()?;
```

- [ ] **Step 2: Route the menu event**

In the `on_menu_event` handler (line 397), add `"open-in-new-window"` to the match:

```rust
"settings" | "history" | "library" | "open-in-new-window" => {
```

And update the emit logic to send to the focused window (or fall back to main):

```rust
app.on_menu_event(move |app_handle, event| {
    let id = event.id().as_ref();
    match id {
        "settings" | "history" | "library" | "open-in-new-window" => {
            // Emit to the focused window, falling back to main.
            let target = app_handle
                .webview_windows()
                .values()
                .find(|w| w.is_focused().unwrap_or(false))
                .or_else(|| app_handle.get_webview_window("main"));
            if let Some(window) = target {
                let _ = window.emit(&format!("menu:{id}"), ());
            }
        }
        _ => {}
    }
});
```

- [ ] **Step 3: Listen for the menu event in the library page**

In `src/routes/library/+page.svelte`, in the `onMount` block (line 366), add a listener:

```typescript
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

// (inside onMount)
let unlisten: UnlistenFn;
onMount(async () => {
    posthog.capture("library_viewed");
    load();
    unlisten = await listen("menu:open-in-new-window", () => {
        if (selectedIds.size === 1) {
            handleOpenInNewWindow([...selectedIds][0]);
        }
    });
});

import { onDestroy } from "svelte";
onDestroy(() => unlisten?.());
```

Also listen on the editor page (`src/routes/+page.svelte`) — when on the editor page, "Open in New Window" should open the *current* document in a new window... but that doesn't make sense since it's already open. So the menu item is only meaningful on the library page or could be disabled on the editor page. For simplicity, only handle it on the library page. On the editor page, the event is simply ignored (no listener).

- [ ] **Step 4: Add Cmd+Shift+O keyboard shortcut on library page**

In the library page's `handleKeydown` function, add:

```typescript
// Cmd/Ctrl+Shift+O — open selected document in new window
if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "o" && selectedIds.size === 1 && !trashMode) {
    e.preventDefault();
    handleOpenInNewWindow([...selectedIds][0]);
    return;
}
```

Add this early in `handleKeydown` (around line 241, before other key checks).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/lib.rs src/routes/library/+page.svelte
git commit -m "feat: add Open in New Window to File menu with Cmd+Shift+O shortcut"
```

---

### Task 9: Smoke test and verify

- [ ] **Step 1: Build and run**

Run: `bun run tauri dev`
Expected: App launches with no errors.

- [ ] **Step 2: Test basic flow**

1. Create two documents from the library.
2. Open one document normally (double-click) — verify it opens in the same window.
3. Navigate back to library.
4. Hover over a document card — verify the new "Open in New Window" icon button appears.
5. Click the "Open in New Window" button — verify a new OS window opens with that document.
6. In the new window, verify the document loads correctly with full editing capability.

- [ ] **Step 3: Test duplicate guard**

1. With a document open in a second window, go to the library in the main window.
2. Try to double-click the same document — verify a toast appears saying it's already open, and the other window gets focused.
3. Try "Open in New Window" on the same document — verify the existing window gets focused (no new window created).

- [ ] **Step 4: Test window close cleanup**

1. Open a document in a new window.
2. Close the new window.
3. Open the same document again (either in-window or new window) — verify it works (the tracking map was cleaned up).

- [ ] **Step 5: Test menu bar**

1. On the library page, select a document.
2. Use File → Open in New Window — verify it works.
3. Use Cmd+Shift+O — verify it works.

- [ ] **Step 6: Commit any fixes from testing**

```bash
git add -A
git commit -m "fix: address issues found during multi-window smoke testing"
```
