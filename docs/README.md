# Quillium Architecture Documentation

Quillium is a modern writing application built with Tauri + SvelteKit + TypeScript. This documentation covers the internal architecture for contributors.

**New here?** Start with the [Quickstart Guide](./quickstart.md).

## Quick Orientation

- **Main routes**: `/` (editor), `/library` (document grid), `/history`
  (version browser), `/authorship` (provenance playback)
- **Two state worlds**: CodeMirror (immutable, transaction-based) and Svelte stores (reactive, manually synced)
- **Always use `isAnnotationOfType(annotation, "revision")`** — never compare `_type` directly

## Recommended Reading Order

### Essential (read first)
1. [Quickstart](./quickstart.md) — Setup, running, making your first change
2. [Monorepo Guide](./monorepo.md) — Package layout, commands, deploy roots, shared package rules
3. [Architecture Overview](./architecture-overview.md) — Mental model of the system
4. [State Management](./state-management.md) — The dual-state system is the #1 source of confusion

### Core Systems (read based on what you're touching)
5. [Annotations](./annotations.md) — If touching comments, suggestions, or revisions
6. [Nested Editors](./nested-editors.md) — If touching revision modals or inline editors
7. [Persistence](./persistence.md) — If touching save/load or crash recovery

### Feature Areas (reference as needed)
- [Tabs & Drafts](./tabs-and-drafts.md) — Document tabs, draft trees, forking, locks
- [Collaboration](./collaboration.md) — Yjs sync, real-time collab
- [AutoAI](./autoai.md) — Background AI review system
- [AI Features and Request Pipeline](./ai-sidebar.md) — End-to-end context, provider, streaming, tools, and cancellation flow
- [Auth](./auth.md) — Supabase Auth, account UI, guest collaborators
- [Provenance](./provenance.md) — Authorship report and playback

### Reference (look up when needed)
- [Architecture Decision Records](./adr/README.md) — Durable architectural choices and their rationale
- [File Structure](./file-structure.md) — "Where is X?"
- [Visual Regression and CI](./visual-regression.md) — Required checks, artifacts, and baseline policy
- [Keybindings](./keybindings.md) — All shortcuts
- [PostHog Events](./posthog-events.md) — Analytics catalog
- [Known Limitations](./known-limitations.md) — Current gaps

## Documentation Index

| Document | Description |
|----------|-------------|
| [Architecture Decision Records](./adr/README.md) | Durable architectural choices and their rationale |
| [Monorepo Guide](./monorepo.md) | Package layout, workspace commands, deployment boundaries |
| [Architecture Overview](./architecture-overview.md) | Core technologies, layers, data flow |
| [File Structure](./file-structure.md) | Complete source tree with descriptions |
| [Visual Regression and CI](./visual-regression.md) | Required checks, failure artifacts, and baseline update policy |
| [State Management](./state-management.md) | CodeMirror ↔ Svelte sync, transactions vs effects |
| [Annotations](./annotations.md) | Data model, annotationField, three-phase update, undo/redo |
| [Nested Editors](./nested-editors.md) | Controller lifecycle, parent sync, infinite nesting |
| [View Plugins](./view-plugins.md) | Decorations, atomic ranges, collapsed resolver, nudge |
| [Persistence](./persistence.md) | Event log, snapshots, crash safety matrix, schema migrations |
| [Tabs & Drafts](./tabs-and-drafts.md) | Document tabs, draft trees, iterate/branch, locks |
| [Collaboration](./collaboration.md) | Yjs sync, relay architecture, awareness, owner/joiner flows |
| [Auth](./auth.md) | Supabase Auth, account UI, anonymous guest sessions |
| [Provenance](./provenance.md) | Authorship report, provenance classification, playback/export |
| [AutoAI](./autoai.md) | Review engine, widget UI, face state machine |
| [Reader Personas](./reader-personas.md) | Multi-persona parallel feedback system |
| [AI Features and Request Pipeline](./ai-sidebar.md) | End-to-end AI flow, providers, models, context, streaming, tools, and other AI surfaces |
| [Settings](./settings.md) | App preferences, fonts, localStorage vs SQLite |
| [Library](./library.md) | Document management, trash, navigation |
| [Search](./search.md) | FTS5 + semantic search, schema migrations |
| [Version History](./version-history.md) | Snapshots, restore, storage management |
| [Error Handling](./error-handling.md) | Error guard, crash recovery, banners |
| [Native Integration](./native-integration.md) | Tauri menu, keychain, auto-updater, PDF export |
| [Keybindings](./keybindings.md) | All keyboard shortcuts |
| [PostHog Events](./posthog-events.md) | Analytics event catalog |
| [Known Limitations](./known-limitations.md) | Current gaps and technical debt |

## Core Technologies

| Layer | Technology | Why |
|-------|------------|-----|
| Frontend framework | SvelteKit + TypeScript | Reactivity, SSG mode for Tauri |
| Editor engine | CodeMirror 6 | Full state management, extensible plugins |
| Desktop runtime | Tauri (Rust) | Cross-platform packaging, native file I/O |
| Styling | Tailwind CSS v4 | Utility-first, co-located styles |
| State management | CodeMirror StateFields + Svelte stores | Hybrid: editor state in CM, UI state in Svelte |
| AI integration | Vercel AI SDK | Provider-agnostic, streaming |
| Linting/formatting | Biome | 4-space indent, 100-char line width |

## Development Commands

```bash
bun run desktop:dev  # Desktop development server
bun run desktop:build # Desktop production build
bun run check:all    # Type checking
bun run biome        # Lint and format
bun run test:all     # Run tests
bun run desktop:tauri:dev # Tauri development mode
```

See the root `README.md`, `AGENTS.md`, and [Monorepo Guide](./monorepo.md) for the
complete command reference.
