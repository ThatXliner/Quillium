# Multi-Window Support

**Date:** 2026-04-02
**Status:** Approved

## Goal

Allow users to open multiple documents in separate OS windows. No tabs, no split-screen — just real native windows. The current single-window behavior is unchanged; new windows are opened via explicit user action only.

## Constraint

A document can only be open in one window at a time. Opening a document that's already open elsewhere focuses that window instead.

## Design

### 1. Open-window tracking (Rust)

New app state alongside `DbState`:

```rust
pub struct OpenWindows(pub Mutex<HashMap<String, String>>);
// doc_id → window_label
```

Managed in `lib.rs`, added via `app.manage(...)` in `setup`.

### 2. `cmd_open_in_new_window` command

New Tauri command:

- **Input:** `doc_id: String`
- **Flow:**
  1. Lock `OpenWindows`. If `doc_id` is already in the map, focus that window and return early.
  2. Create a `WebviewWindow` with:
     - Label: `"editor-{short_id}"` (use first 8 chars of a UUID to avoid label collisions)
     - URL: `/?doc={doc_id}`
     - Same width/height/minWidth/minHeight as the main window config (1373×1170, min 900×600)
  3. Insert `doc_id → window_label` into the map.
  4. Listen for the window's `destroy` event to remove the entry from the map.

### 3. `cmd_is_doc_open_elsewhere` command

New Tauri command:

- **Input:** `doc_id: String`, `window_label: String` (the calling window's label)
- **Output:** `Option<String>` — the label of the window that has it open, or `None`
- **Purpose:** The frontend calls this before navigating to a document in-window. If it returns `Some`, show a message and focus that window instead.

### 4. Main window registration

The main window also participates in `OpenWindows`:

- When `+page.svelte` loads a document (sets `currentDocumentId`), call a new command `cmd_register_open_doc(doc_id, window_label)` to register it.
- When navigating away to `/library`, call `cmd_deregister_open_doc(window_label)` to remove the entry.
- Window label for the main window is `"main"`.

### 5. Frontend: URL-based document loading

On the editor page (`src/routes/+page.svelte`):

- On mount, check for a `doc` query parameter.
- If present, load that document directly (skip the "last opened" / library redirect flow).
- If absent, existing behavior is unchanged.

Each window gets its own SvelteKit JS context, so all stores (`currentDocumentId`, `editorView`, `annotations`, etc.) are naturally isolated. No store changes needed.

### 6. UI entry points

Three ways to trigger "Open in New Window":

1. **Library context menu:** Add "Open in New Window" to the right-click menu on document cards. Calls `cmd_open_in_new_window`.
2. **File menu (menu bar):** Add "Open in New Window" item to the File submenu in the native app menu. Emits a `menu:open-in-new-window` event to the frontend, which then invokes the command with the currently selected/focused document (only enabled when a document is available to open).
3. **Keyboard shortcut:** Cmd+Shift+O (macOS) / Ctrl+Shift+O (Windows/Linux), wired to the same flow as the menu bar item.

### 7. Menu event routing

Current code emits menu events only to `"main"`:

```rust
if let Some(window) = app_handle.get_webview_window("main") {
```

Change to emit to the **focused window** instead. Use `app_handle.get_focused_window()` or iterate windows to find the focused one. Fallback to `"main"` if no window is focused.

### 8. Capabilities

Update `src-tauri/capabilities/default.json` and `desktop.json`:

```json
"windows": ["main", "editor-*"]
```

This grants the same permissions to dynamically created editor windows.

### 9. What stays the same

- **DB access:** `Mutex<Connection>` in app state is already shared across all windows.
- **Stores:** Naturally isolated per window (separate JS contexts).
- **Save/persistence:** Each window's `listeners.ts` saves independently. No conflicts because duplicate documents are prevented.
- **Editor, annotations, modal stack, AI sidebar:** No changes.
- **Default behavior:** Single-click in library still opens in the same window.
