# Quickstart Guide

Get up and running as a Quillium contributor.

## Prerequisites

- **Node.js** (for bun)
- **bun** — `npm install -g bun`
- **Rust** — [rustup.rs](https://rustup.rs/)
- **Tauri CLI** — `cargo install tauri-cli`

## Setup

```bash
# Clone
git clone https://github.com/ThatXliner/Quillium.git
cd Quillium

# Install dependencies
bun install

# Run in browser (faster iteration, no Tauri features)
bun run desktop:dev

# Run as desktop app (full features)
bun run desktop:tauri:dev
```

## Project Structure at a Glance

```
packages/desktop/src/
├── routes/           # SvelteKit pages (/, /library, /history, /authorship)
├── lib/
│   ├── editor/       # CodeMirror setup, extensions, plugins
│   │   └── plugins/annotations/  # THE CORE — comments, revisions, suggestions
│   ├── ai/           # AI sidebar modes
│   ├── collab/       # Real-time collaboration (Yjs)
│   └── db/           # Tauri command wrappers
packages/desktop/src-tauri/src/        # Rust backend (SQLite, keychain, menu)
```

## The Mental Model

```
┌─────────────────────────────────────────────────────────┐
│                    Svelte Components                     │
│  (reactive UI — reads from stores, dispatches actions)   │
└─────────────────────────────────────────────────────────┘
                            ↑ reads
                            │
┌─────────────────────────────────────────────────────────┐
│                     Svelte Stores                        │
│    ($annotations, $documentContent, $editorView...)      │
└─────────────────────────────────────────────────────────┘
                            ↑ updateListener pushes
                            │
┌─────────────────────────────────────────────────────────┐
│                   CodeMirror State                       │
│  (immutable, transaction-based — THE source of truth)    │
│      annotationField, historyField, document            │
└─────────────────────────────────────────────────────────┘
                            ↑ transactions
                            │
┌─────────────────────────────────────────────────────────┐
│                      User Input                          │
└─────────────────────────────────────────────────────────┘
```

**Key insight**: CodeMirror state is the source of truth. Svelte stores are mirrors that `updateListener` pushes to. Components read stores but dispatch transactions to CodeMirror.

## Common Tasks

### Adding a new annotation feature

1. Define types in `packages/desktop/src/lib/editor/plugins/annotations/models.ts`
2. Add StateEffect in `annotationField.ts`
3. Handle in `annotationField.update()` Phase 2
4. Add inversion in `invertedAnnotationFieldEffects`
5. Create UI component in the same directory

### Adding a new AI mode

1. Create component in `packages/desktop/src/lib/ai/`
2. Add tab in `AISidebar.svelte`
3. Add stream handler in `clientStreams.ts` if needed

### Adding a Tauri command

1. Add Rust function in `packages/desktop/src-tauri/src/lib.rs` or appropriate module
2. Register in `tauri::Builder`
3. Add TypeScript wrapper in `packages/desktop/src/lib/db/index.ts`

### Adding a keybinding

1. Editor shortcuts: add to keymap in `extensions.ts` or `annotations/index.ts`
2. App-wide: add to native menu in `lib.rs`

## Key Files to Know

| File | What it does |
|------|--------------|
| `packages/desktop/src/lib/editor/Editor.svelte` | Mounts CodeMirror, sets up all extensions |
| `packages/desktop/src/lib/editor/extensions.ts` | The extension stack |
| `packages/desktop/src/lib/editor/listeners.ts` | Persistence + store sync |
| `packages/desktop/src/lib/editor/plugins/annotations/annotationField.ts` | THE core state management |
| `packages/desktop/src/lib/stores.ts` | All Svelte stores |
| `packages/desktop/src/routes/+page.svelte` | Main editor page, modal rendering |

## Running Tests

```bash
bun run desktop:test:run              # Unit tests
bun run desktop:test:e2e              # E2E tests (headless)
bun run desktop:test:e2e:headed       # E2E with browser window
```

## Code Style

- **4-space indentation** (2 for JSON)
- **100-char line width**
- **Trailing commas and semicolons**
- Run `bun run biome` before committing

## Getting Help

- Check [Known Limitations](./known-limitations.md) before filing a bug
- Architecture questions? Start with [State Management](./state-management.md)
- File issues at https://github.com/ThatXliner/Quillium/issues

## Next Steps

1. Read [Architecture Overview](./architecture-overview.md) for the full mental model
2. Read [State Management](./state-management.md) — this is where most confusion happens
3. Pick a feature area and dive into its doc
