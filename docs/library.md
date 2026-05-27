# Library and Document Management

## Data Model

SQLite schema with `documents` + `drafts`:
- Each document has metadata: title, word count, preview text, tags, timestamps, `deletedAt` (soft-delete)
- Each document has one or more drafts (default one, created automatically)
- Document state (text + annotations) lives in `events` + `snapshots` tables, keyed by draft

## Auto-Derived Document Title

New documents start titled "Untitled". On each save, `listeners.ts` checks if title is still "Untitled" and derives one from the first line when:
- User presses Enter (creating second line), OR
- First line contains at least 4 words

Title set to `firstLine.slice(0, 40)`. Once derived, it won't auto-update again.

If AI is enabled, users can click "Suggest" in the status bar for an AI-generated title (also capped at 40 chars).

## Library Page

`routes/library/+page.svelte` — two tabs: Library and Trash.

### Layout

- Document cards in a grid
- Search bar
- Preview panel sidebar
- `ContinuePill` — shortcut to most recently edited document

### Operations

| Operation | Description |
|-----------|-------------|
| Create | New document with seed content |
| Open | Navigate to editor |
| Rename | Via preview panel |
| Trash | Soft-delete |
| Restore | Restore from trash |
| Permanent delete | After confirmation |

### Trash Retention

Configurable auto-empty period via:
- `getTrashRetention` — Rust command
- `setTrashRetention` — Rust command

## Document Tags (`library/tags.ts`)

Document tagging system for organization. Tags stored in `documents.tags` column as JSON array.

## Navigation (`navigation.ts`)

Two functions:

| Function | Direction | Attribute |
|----------|-----------|-----------|
| `goToLibrary()` | Left slide | `data-direction="left"` |
| `goToEditor()` | Right slide | `data-direction="right"` |

Both set `data-direction` on `<html>` before calling SvelteKit's `goto()`. CSS transitions use this for slide animation.

## Library Components

| Component | Purpose |
|-----------|---------|
| `DocumentCard.svelte` | Single card in grid |
| `DocumentGrid.svelte` | Grid layout |
| `EmptyState.svelte` | Empty library placeholder |
| `LibraryTopBar.svelte` | Header + actions |
| `PreviewPanel.svelte` | Document preview sidebar |
| `ContinuePill.svelte` | "Continue writing" shortcut |

## Tauri Commands

| Command | Purpose |
|---------|---------|
| `list_documents` | Get all documents |
| `create_document` | Create new document |
| `update_document_meta` | Update title, tags |
| `trash_document` | Soft-delete |
| `restore_document` | Restore from trash |
| `delete_document` | Permanent delete |
| `get_trash_retention` | Get auto-empty period |
| `set_trash_retention` | Set auto-empty period |
