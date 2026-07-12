# Architecture Overview

This file is a summary. Full documentation is in [`docs/`](./docs/).

## Quick Orientation

- **Main routes**: `/` (editor), `/library` (document grid), `/history`
  (version browser), `/authorship` (provenance playback)
- **Document hierarchy**: document → tabs (top bar) → draft tree per tab (left panel); events/snapshots are draft-scoped
- **Two state worlds**: CodeMirror (immutable, transaction-based) and Svelte stores (reactive, manually synced)
- **Always use `isAnnotationOfType(annotation, "revision")`** — never compare `_type` directly

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

## Documentation

| Document | Description |
|----------|-------------|
| [README](./docs/README.md) | Documentation index |
| [Quickstart](./docs/quickstart.md) | Setup, running, and first-change guide |
| [Architecture Overview](./docs/architecture-overview.md) | Core technologies, layers, data flow |
| [File Structure](./docs/file-structure.md) | Complete source tree |
| [State Management](./docs/state-management.md) | CodeMirror ↔ Svelte sync |
| [Annotations](./docs/annotations.md) | Data model, annotationField, undo/redo |
| [Nested Editors](./docs/nested-editors.md) | Controller lifecycle, parent sync |
| [View Plugins](./docs/view-plugins.md) | Decorations, atomic ranges, resolver |
| [Persistence](./docs/persistence.md) | Event log, snapshots, crash safety, schema migrations |
| [Tabs & Drafts](./docs/tabs-and-drafts.md) | Document tabs, draft trees, forking, locks |
| [Collaboration](./docs/collaboration.md) | Yjs sync, relay, awareness |
| [Monorepo Guide](./docs/monorepo.md#shared-editor-surface-architecture) | Shared editor surface layers |
| [Auth](./docs/auth.md) | Supabase Auth, account UI, guest collaborator sessions |
| [Provenance](./docs/provenance.md) | Authorship report, edit provenance, playback/export |
| [AutoAI](./docs/autoai.md) | Review engine, widget, face FSM |
| [Reader Personas](./docs/reader-personas.md) | Multi-persona feedback |
| [AI Sidebar](./docs/ai-sidebar.md) | Chat, Feedback, Revise, Dictionary |
| [Settings](./docs/settings.md) | App preferences, fonts |
| [Library](./docs/library.md) | Document management, trash |
| [Search](./docs/search.md) | FTS5 + semantic search, schema migrations |
| [Version History](./docs/version-history.md) | Snapshots, restore |
| [Error Handling](./docs/error-handling.md) | Crash recovery, banners |
| [Native Integration](./docs/native-integration.md) | Tauri menu, keychain, updater, PDF |
| [Keybindings](./docs/keybindings.md) | All shortcuts |
| [PostHog Events](./docs/posthog-events.md) | Analytics catalog |
| [Known Limitations](./docs/known-limitations.md) | Current gaps |
