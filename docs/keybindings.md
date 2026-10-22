# Keybindings

Quillium-specific shortcuts. `Mod` means Command on macOS and Control on other
platforms. CodeMirror also supplies its standard editing shortcuts. Context and
feature availability determine which commands can run.

## Annotation shortcuts

The comment chord is matched from the physical `KeyC` webview event at highest precedence, then
calls `createCommentFromSelection()` with CodeMirror's active view. This avoids layout-dependent
key-name normalization while preserving the correct root, inline, or modal editor context. The
remaining annotation shortcuts use the high-precedence CodeMirror keymap.

| Key | Command chain |
|-----|---------------|
| `Backspace` | `nudgeBoundary("backward")` → `deleteAdjacentRevision("backward")` → default |
| `Delete` | `nudgeBoundary("forward")` → `deleteAdjacentRevision("forward")` → default |
| `Mod-Shift-C` | `createCommentFromSelection()` → nested redirect or `createCommentCommand` |
| `Mod-Alt-K` | `redirectToNestedEditor("revision")` → `createRevisionCommand` |

Each handler returns `false` to fall through if it doesn't apply. `redirectToNestedEditor` returns `true` (swallows keypress) only when cursor is inside an active revision.

## Editor shortcuts

| Key | Action |
|-----|--------|
| `Mod-Z` | Undo |
| `Mod-Shift-Z` / `Mod-Y` | Redo (including Command-Y on macOS) |
| `Mod-Shift-S` | Name this version |
| `Mod-D` | Open dictionary popover (single word selected) |
| `Mod-B` | Toggle bold (markdown) |
| `Mod-I` | Toggle italic (markdown) |
| `Mod-U` | Toggle underline (HTML) |
| `Mod-Shift-R` | Trigger manual AutoAI review |

Undo and redo also work while a writing-surface button or annotation modal control
has focus, including immediately after deleting a version or collapsing a revision.
They use the root editor's installed history handler, including Live Room history.
Text fields (such as version labels and comment drafts) keep their native undo.

Draft and tab deletions also support session keyboard undo/redo. Newer text edits
undo first; browser `historyUndo` and `historyRedo` input events use the same boundary.
The Undo toast and shortcut share one restore entry. See
[tabs and drafts](tabs-and-drafts.md#keyboard-undo-and-redo) for scope.

## Native app menu accelerators

| Key | Action |
|-----|--------|
| `Mod-,` | Toggle settings modal |
| `Mod-O` | Navigate to library |
| `Mod-Shift-O` | Open selected document in new window (library) |
| `Mod-Shift-H` | Navigate to version history |
| `Mod-Shift-A` | Navigate to authorship report (`authorship-provenance` feature flag) |
| `Mod-T` | Create a tab in the open document |
| `Mod-Shift-F` | Toggle focus mode (`novel-november` feature flag) |

`Command-Option-M` is not bound because macOS reserves it for Minimize All. `Command-Shift-M` is
not bound because macOS uses it for the Open man Page in Terminal text Service. Right-clicking
selected prose opens a native menu with Cut, Copy, Paste, Select All, Add Comment, and Add Revision.

## Revision modal shortcuts

| Key | Action |
|-----|--------|
| `Ctrl-[` | Previous version |
| `Ctrl-]` | Next version |
| `Mod-Enter` | Create new version |
| `Escape` | Close modal |

The modal-level handler skips events already handled by CodeMirror and events
from editors or text inputs. Nested editors install their own version shortcuts.
See [revisionModalKeyguard.ts](../packages/desktop/src/lib/editor/plugins/annotations/revisionModalKeyguard.ts).

## Nested editor shortcuts

| Key | Action |
|-----|--------|
| `Mod-Z` | Delegates to parent `undo()` |
| `Mod-Shift-Z` / `Mod-Y` | Delegates to parent `redo()` |
| `Mod-Shift-C` | Emit `nested-annotation-create` for comment |
| `Mod-Alt-K` | Emit `nested-annotation-create` for revision |

## AI sidebar panels

[Sidebar.svelte](../packages/desktop/src/lib/sidebar/Sidebar.svelte) handles these
chords when the panel is available and no dialog is open. Panel contributions in
[builtInPanels.ts](../packages/desktop/src/lib/sidebar/builtInPanels.ts) own the
mapping. Number keys alone do not switch sidebar panels.

| Key | Tab |
|-----|-----|
| `Mod-Shift-1` | Chat |
| `Mod-Shift-2` | Feedback (Separate panels layout) |
| `Mod-Shift-3` | Revise (Separate panels layout) |
| `Mod-Shift-4` | Context |
| `Mod-Shift-5` | Readers |
| `Mod-Shift-6` | Settings |

## Thread shortcuts

| Key | Action |
|-----|--------|
| `Mod-/` | Focus reply textarea (emits `annotation-focus-reply`) |

## Annotation controls

`Mod-Enter` submits a comment or reply while its text field has focus. Escape
cancels that input. `Mod-E` opens the active revision's editor. Version selection
uses `Ctrl-[` and `Ctrl-]`, or the version buttons; bare number keys are not a
version-switch shortcut.

## Focus mode

With the `novel-november` feature flag enabled, `Mod-Shift-F` or `F11` toggles
focus mode. Escape exits it.

## Shortcut hints

When `appSettings.showShortcutHints` is `true`, the annotation panel shows keyboard hints for available actions.

The native menu definitions are in
[src-tauri/src/lib.rs](../packages/desktop/src-tauri/src/lib.rs). Keep this list
aligned with those accelerators, the annotation keymaps, and each component's
keyboard handler; there is no user shortcut editor.
