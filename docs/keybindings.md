# Keybindings

All keyboard shortcuts in Quillium.

## Annotation Keymap (Prec.high)

Intercepts before default CodeMirror bindings:

| Key | Command Chain |
|-----|---------------|
| `Backspace` | `nudgeBoundary("backward")` → `deleteAdjacentRevision("backward")` → default |
| `Delete` | `nudgeBoundary("forward")` → `deleteAdjacentRevision("forward")` → default |
| `Mod-Alt-M` | `redirectToNestedEditor("comment")` → `createCommentCommand` |
| `Mod-Alt-K` | `redirectToNestedEditor("revision")` → `createRevisionCommand` |

Each handler returns `false` to fall through if it doesn't apply. `redirectToNestedEditor` returns `true` (swallows keypress) only when cursor is inside an active revision.

## Editor Shortcuts

| Key | Action |
|-----|--------|
| `Mod-D` | Open dictionary popover (single word selected) |
| `Mod-B` | Toggle bold (markdown) |
| `Mod-I` | Toggle italic (markdown) |
| `Mod-U` | Toggle underline (HTML) |
| `Mod-Shift-R` | Trigger manual AutoAI review |

## Native App Menu Accelerators

| Key | Action |
|-----|--------|
| `Mod-,` | Toggle settings modal |
| `Mod-O` | Navigate to library |
| `Mod-Shift-O` | Open selected document in new window (library) |
| `Mod-Shift-H` | Navigate to version history |
| `Mod-Shift-A` | Navigate to authorship report |
| `Mod-Shift-E` | Export plain text |
| `Mod-Alt-M` | Add a comment to the selected prose |
| `Mod-Shift-F` | Toggle focus mode (`novel-november` feature flag) |

The Edit menu exposes **Add Comment** with the same shortcut. Right-clicking inside selected
prose also shows **Add Comment**, so comment creation does not depend on key-event delivery.

## Revision Modal Shortcuts

| Key | Action |
|-----|--------|
| `Ctrl-[` | Previous version |
| `Ctrl-]` | Next version |
| `Mod-Enter` | Create new version |
| `Escape` | Close modal |

Guarded by `revisionModalKeyguard` — skipped if CodeMirror editor or input has focus.

## Nested Editor Shortcuts

| Key | Action |
|-----|--------|
| `Mod-Z` | Delegates to parent `undo()` |
| `Mod-Shift-Z` / `Mod-Y` | Delegates to parent `redo()` |
| `Mod-Alt-M` | Emit `nested-annotation-create` for comment |
| `Mod-Alt-K` | Emit `nested-annotation-create` for revision |

## AI Sidebar Tab Keys

| Key | Tab |
|-----|-----|
| `1` | Chat |
| `2` | Feedback |
| `3` | Revise |
| `4` | Context |
| `5` | Readers |
| `6` | Settings |

## Thread Shortcuts

| Key | Action |
|-----|--------|
| `Cmd-/` | Focus reply textarea (emits `annotation-focus-reply`) |

## Comment/Suggestion Card Shortcuts

| Key | Action |
|-----|--------|
| `Cmd-Enter` | Submit / Apply |
| `Escape` | Cancel / Close |

## Revision Card Shortcuts

| Key | Action |
|-----|--------|
| `Cmd-Enter` | Create new version |
| Number keys `1-9` | Switch to version N |

## Global Shortcuts

| Key | Action |
|-----|--------|
| `Cmd-,` | Open settings |
| `Cmd-O` | Open library |
| `Cmd-Shift-H` | Open version history |
| `Cmd-Shift-A` | Open authorship report |
| `Cmd-Shift-F` / `F11` | Toggle focus mode (`novel-november` feature flag) |
| `Escape` | Exit focus mode |

## Shortcut Hints

When `appSettings.showShortcutHints` is `true`, the annotation panel shows keyboard hints for available actions.
