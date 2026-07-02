# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

Quillium is a modern writing application built with Tauri + SvelteKit + TypeScript. It's an innovative text editor focused on non-linear editing, AI-powered writing assistance, and collaborative features like comments/annotations and revisions. Supports multiple documents via a library view, automatic AI review (AutoAI), and a guided tutorial for new users.

## Development Commands

```bash
# Desktop development server
bun run desktop:dev

# Desktop build for production
bun run desktop:build

# Preview desktop production build
bun run desktop:preview

# Type checking
bun run desktop:check
bun run landing:check
bun run share:check
bun run check:all

# Type checking (watch mode)
bun run --cwd packages/desktop check:watch

# Linting and formatting (uses Biome)
bun run format    # Format code
bun run lint      # Lint code
bun run biome     # Run both format and lint

# Testing (uses Vitest — must use `bun run test`, NOT `bun test`)
bun run desktop:test          # Watch mode
bun run desktop:test:run      # Single run
bun run --cwd packages/desktop test:run tests/lib/editor/plugins/annotations/annotations.fuzz.test.ts  # Single file

# End-to-end tests (Playwright)
bun run desktop:test:e2e              # Headless
bun run desktop:test:e2e:headed       # With browser window

# Tauri commands
bun run desktop:tauri:dev        # Run Tauri development mode
bun run desktop:tauri:build      # Build Tauri application

# Landing and relay
bun run landing:dev
bun run relay:dev

# Utility scripts
bun run desktop:bump                            # Patch version bump
bun run desktop:bump:minor                      # Minor version bump
bun run desktop:bump:major                      # Major version bump
bun run desktop:screenshots                      # Generate screenshots
bun run desktop:icons                            # Generate app icons
```

## Architecture

See `ARCHITECTURE.md` for the full deep dive. It covers:
- Tech stack and file structure (§ Core Technologies, § File Structure)
- State management mental model — CodeMirror ↔ Svelte sync (§ State Management Mental Model)
- The annotation system: data model, annotationField three-phase update, undo/redo inversion (§ The Annotation System)
- Nested editors: NestedEditorController, translateAndDispatch, inline vs. modal, infinite nesting (§ Nested Editors)
- ViewPlugins: annotationDecorations, revisionAtomicRanges, collapsedRevisionResolver, boundaryInsertNudge (§ ViewPlugins and Extensions)
- Persistence: event log, snapshots, crash-safety matrix (§ Persistence)
- AutoAI: engine, settings, widget (§ AutoAI)
- Reader Personas: multi-persona parallel feedback, builtin/custom personas, chattiness (§ Reader Personas)
- Dictionary & thesaurus popover (§ Dictionary & Thesaurus)
- Settings: app preferences, font system, why localStorage vs SQLite (§ Settings)
- Error guard and crash recovery: suspicious change detection, backups, restore (§ Error guard and crash recovery)
- Library and document management: data model, navigation, trash (§ Library and document management)
- Comment modals, revision modal keyguard, keychain, PostHog, auto-updater
- Native app menu: submenus, accelerators, Tauri→frontend event bridge (§ Native App Menu)
- Document export: txt, json, md, txt+json formats (§ Document Export)
- Common flows: creating comments/revisions, version switching, nested editing, undo (§ Common Flows)
- Keybindings (§ Keybindings)
- PostHog event catalog (§ PostHog Events)
- Known limitations (§ Known Limitations)

### Quick Orientation

**Always use `isAnnotationOfType(annotation, "revision")` — never compare `_type` directly.**

This repository is a single-folder Bun workspace monorepo. Package roots are
`packages/desktop`, `packages/landing`, `packages/relay`, and `packages/share`.
Run dependency installs and cross-package scripts from the repository root; see
`docs/monorepo.md` before changing workspace, deploy, env, or shared-package wiring.

Desktop routes: `/` (editor) and `/library` (document grid). Page transitions via `packages/desktop/src/lib/navigation.ts`.

Documents contain tabs (top bar); each draft-type tab holds a tree of drafts (left panel). Events and snapshots are draft-scoped. See `docs/tabs-and-drafts.md`.

All systems are documented in ARCHITECTURE.md.

## Code Style
- 4-space indentation (2-space for JSON)
- 100-character line width
- Trailing commas and semicolons required
- Import organization enabled

---

## Design

See `BRANDING.md` for the full brand bible: color system, typography, spacing, depth, motion, component patterns, voice/copy guidelines, anti-patterns, and design tokens. See `DESIGN.md` for the conceptual model (how revisions, nested editors, undo, and annotations are intended to work from the user's perspective).

## Project

**Quillium Omni**

A dogfoodable prototype of Quillium Omni — the paid sync and real-time collaboration service for Quillium. Two Quillium instances can connect to a relay server and see each other's edits in real-time. Built on Supabase Auth + a Node.js WebSocket relay.

**Core Value:** Two Quillium instances can connect and see each other's edits in real-time.

### Constraints

- **Auth**: Supabase Auth (email/password) — decided over license keys for collab identity
- **Relay location**: Lives in packages/relay
- **Timeline**: A few weeks, no hard deadline
- **Quality bar**: Dogfoodable — stable enough to use for real writing across devices
- **Dependencies**: Supabase (Auth + Postgres), Fly.io for relay (~$7/mo)

## Technology Stack

## Languages
- TypeScript ~5.6.3 - Frontend application, SvelteKit components, configuration
- Svelte 5.55.3 - Reactive UI framework for components in `packages/desktop/src/routes` and `packages/desktop/src/lib`
- Rust 2021 edition - Desktop app backend via Tauri (`packages/desktop/src-tauri/src/`)
- JavaScript - Vite build configuration, scripts in `scripts/`
## Runtime
- Tauri 2.10.1 - Desktop application framework (wraps web frontend in native shell)
- Node.js - Development runtime (via bun package manager)
- bun - Primary package manager for frontend dependencies
- Lockfile: `bun.lock` at the repository root
- Cargo - Rust dependency management (`packages/desktop/src-tauri/Cargo.lock`)
## Frameworks
- SvelteKit 2.57.1 - Meta-framework for Svelte with file-based routing
- Vite 6.4.2 - Build tool and dev server
- Tauri 2.10.1 - Desktop framework (native window, file dialogs, menus, updater)
- Tailwind CSS 4.2.2 - Utility-first CSS framework (via `@tailwindcss/vite`)
- Bits UI 1.8.0 - Headless component library for composable UI elements
- lucide-svelte 0.475.0 - SVG icon set as Svelte components
- svelte-sonner 1.1.0 - Toast notification system
- CodeMirror 6 (`@codemirror/view` 6.41.0, `@codemirror/state` 6.6.0, etc.)
- harper.js 2.0.0 - Grammar and style linting for Markdown
- crelt 1.0.6 - Lightweight DOM creation helper
- ai 5.0.172 - Vercel AI SDK (unified LLM client)
- @ai-sdk/openai 2.0.102 - OpenAI provider adapter
- @ai-sdk/anthropic 3.0.69 - Anthropic Codex provider adapter
- @ai-sdk/google 3.0.62 - Google Gemini provider adapter
- @ai-sdk/svelte 3.0.172 - Svelte utilities for AI streaming
- unified 11.0.5 - Text processing ecosystem
- remark-parse 11.0.0 - Markdown parser
- remark-gfm 4.0.1 - GitHub Flavored Markdown syntax support
- remark-rehype 11.1.2 - Markdown to HTML AST converter
- rehype-remark 10.0.1 - HTML to Markdown conversion
- rehype-stringify 10.0.1 - HTML AST to string converter
- dompurify 3.3.3 - XSS sanitizer for DOM content
- zod 4.3.6 - TypeScript-first schema validation and parsing
- Vitest 4.1.4 - Unit test runner (Vite-native, ESM-first)
- @testing-library/svelte 5.3.1 - DOM testing utilities for Svelte
- @testing-library/jest-dom 6.9.1 - Custom matchers for DOM assertions
- @vitest/coverage-v8 4.1.4 - V8-based code coverage
- fast-check 4.6.0 - Property-based testing framework
- jsdom 28.1.0 - Browser environment simulation for tests
- Playwright 1.59.1 - E2E testing framework
- pixelmatch 7.1.0 - Pixel-level image diffing (screenshot testing)
- pngjs 7.0.0 - PNG image processing
- Biome 1.9.4 - All-in-one linter, formatter, and language server
- svelte-check 4.4.6 - SvelteKit type checker
- @sveltejs/adapter-static 3.0.10 - SSG adapter for Tauri (prerender to HTML)
- @sveltejs/vite-plugin-svelte 5.1.1 - Vite plugin for Svelte
- @fontsource packages (8 fonts) - Self-hosted font families:
- lodash-es 4.18.1 - Functional utility library
- paneforge 1.0.2 - Resizable pane divider system
- posthog-js 1.367.0 - Product analytics with session replay
## Configuration
- Frontend config via `$env/static/public` (SvelteKit)
- `vite.config.js` - Vite configuration (SvelteKit + Tailwind plugins)
- `svelte.config.js` - SvelteKit config with static adapter (Tauri doesn't support SSR)
- `tsconfig.json` - TypeScript strict mode, source maps, path aliases
- `biome.json` - Linting and formatting rules (4-space indent, 100-char line width)
- `tauri.conf.json` - Tauri app config (`packages/desktop/src-tauri/tauri.conf.json`)
- `packages/desktop/src-tauri/Cargo.toml` - Rust dependencies (see Rust section below)
- Strict mode enabled: `forceConsistentCasingInFileNames`, `resolveJsonModule`, etc.
- Source maps enabled for debugging
- SvelteKit extends `./.svelte-kit/tsconfig.json` (auto-generated)
## Rust Backend (Tauri)
- Rust 2021 edition
- tauri 2 - Desktop framework
- rusqlite 0.31 - SQLite driver with bundled SQLite library
- keyring 3 - System keychain integration
- serde 1 + serde_json 1 - Serialization/deserialization
- uuid 1 - UUID generation
- tauri-plugin-updater 2 - App auto-updater
- tauri-plugin-opener 2 - Open URLs/files in default applications
- tauri-plugin-process 2 - Subprocess management
- tauri-plugin-dialog 2.7.0 - Native file/save dialogs
- tauri-plugin-fs 2.5.0 - File system operations
- SQLite 3 (bundled via rusqlite) - Local database at `{app-data}/Quillium/quillium.db`
- Keyring crate - Stores API keys in system keychain (not SQLite)
## Platform Requirements
- Node.js with bun installed
- Rust 2021 edition toolchain (for Tauri compilation)
- macOS/Linux/Windows (Tauri supports all)
- Code signing identity for macOS builds (Tauri)
- Deployment: macOS (.app), Windows (.exe), Linux (.AppImage)
- Tauri bundles app with built SvelteKit frontend (`build/` directory)
- Auto-updater via GitHub Releases

## Conventions

## Naming Patterns
- Source files: `camelCase.ts` (e.g., `annotationField.ts`, `harperLinter.ts`)
- Svelte components: `PascalCase.svelte` (e.g., `Editor.svelte`, `Comment.svelte`)
- Test files: `<name>.test.ts` or `<name>.fuzz.test.ts` or `<name>.pw.ts` (Playwright) (e.g., `annotationField.test.ts`, `annotations.fuzz.test.ts`)
- Store files: `<name>.svelte.ts` (Svelte runes stores) (e.g., `settings.svelte.ts`, `autoai/settings.svelte.ts`)
- Configuration: `<tool>.<ext>` or `<tool>.config.<ext>` (e.g., `biome.json`, `vitest.config.ts`, `playwright.config.ts`)
- Exported utility functions: `camelCase` (e.g., `cleanRangesOf`, `getNewId`, `createNewAnnotation`)
- Command functions: `verbNoun` pattern (e.g., `addAnnotation`, `removeAnnotation`, `setActiveRevisionVersion`, `updateThread`)
- Query functions: `getNoun` or `getActiveNoun` pattern (e.g., `getNewId`, `getLastId`, `getActiveAnnotation`)
- Type guards: `isNoun` pattern (e.g., `isAnnotationOfType`)
- Internal/private functions: prefix with `_` (e.g., `_restoreAnnotation`, `_nestedEditRevision`)
- Constants: `UPPER_SNAKE_CASE` (e.g., `SAMPLE_DOCUMENT_TITLE`, `CODEX_PROXY_BASE_URL`)
- Mutable values: `camelCase` (e.g., `persistQueue`, `metaDebounceTimers`)
- Destructured imports: `camelCase` (e.g., `{ createNewAnnotation, isAnnotationOfType }`)
- Exported types: `PascalCase` (e.g., `Annotations`, `GenericAnnotation`, `VersionState`)
- Discriminated union fields: `_type` for type discriminator (e.g., `_type: "comment"`, `_type: "revision"`)
- **Important:** Use `isAnnotationOfType()` type guard—never compare `_type` directly (see note in AGENTS.md)
- Zod schema types: `PascalCase + "Schema"` suffix (e.g., `RawAnnotationsSchema`, `ThreadMessageSchema`)
- Union types: `Noun | Noun` pattern (e.g., `"openai" | "openai-codex" | "anthropic" | "google"`)
- Exported stores: `camelCase` (e.g., `annotations`, `currentDocumentId`, `editorView`)
- Mock instances: `mock<Service>` (e.g., `mockAppSettings`)
## Code Style
- Tool: Biome (configured in `biome.json`)
- Indentation: 4 spaces
- Line width: 100 characters
- Line endings: LF
- Trailing commas: All (enabled in JS formatter)
- Semicolons: Always required
- Import organization: Enabled
- Tool: Biome with recommended rules enabled
- Svelte files: `useConst` and `useImportType` rules disabled
- Test files: `noNonNullAssertion` rule disabled to allow non-null assertions in tests
- JSON files: 2-space indentation (override from 4-space)
- Svelte/Astro/Vue files: `useConst` and `useImportType` disabled
- TypeScript test files: Non-null assertions permitted
## Import Organization
- `$lib/` → `src/lib/` (configured in SvelteKit, used throughout)
## Comments and Documentation
- File name and purpose (first line as `filename.ts — Brief description`)
- What it contains and its role in the system
- Key dependencies it uses
- Main interactions with other modules
- Comment non-obvious logic, workarounds, and important constraints
- Explain "why" not "what" — code shows what; comments explain design decisions
- Mark important requirements with bold or ALL_CAPS: `// DO NOT COMPARE _type; instead use isAnnotationOfType`
## Error Handling
- File: `src/lib/editor/listeners.ts` — persistence layer catches errors from Tauri invokes
- File: `src/lib/errorGuard.ts` — suspicious change detection and recovery
- Log prefixes include module name (e.g., `[listeners]`, `[caretBroadcast]`)
- Full error object logged for debugging
- Some async operations use `.catch(() => {})` to silently fail without interrupting the operation chain
- Example: Meta updates are debounced and failures don't stop other operations
## Logging
- Errors: `console.error("[module] message", error)`
- Warnings: `console.warn("[module] message", context)`
- No debug/info logging in production code (kept minimal)
## Function Design
- Ordered by specificity: required globals/state first, then specific arguments
- Prefer parameter object destructuring when function has 3+ params
- Type annotations always present
- Always explicitly typed
- Query functions return `Value | undefined` (e.g., `getActiveAnnotation(): GenericAnnotation | undefined`)
- Pure functions never throw; use `null` or `undefined` for "not found"
- Functions that may fail return union types or explicit null (e.g., `cleanRangesOf()` returns `EditorSelection | null`)
## Module Design
- Prefer named exports (not default)
- Export only what's needed publicly; keep internal utilities private with `_` prefix
- Re-export from `index.ts` files for convenience (barrel files)
- Location: `index.ts` in each module
- Purpose: Re-export public API from submodules for cleaner imports
- Example: `src/lib/editor/plugins/annotations/index.ts` exports effects, commands, and extensions
- `models.ts` — Type definitions and serialization
- `utils.ts` — Pure query/transform functions
- `annotationField.ts` — StateField and effects
- `index.ts` — Commands, keybindings, extensions
## State and Mutations
- All annotation data stored in a single `annotationField: StateField<Annotations>`
- Mutations via `StateEffect` objects dispatched through transactions
- No direct field mutation; all changes go through the reducer
- Undo/redo via `invertedEffects` with proper `map` functions
- Runes-based stores (`.svelte.ts` files) with `writable()`, `readable()`, `derived()`
- Stores re-exported from `src/lib/stores.ts` for centralized access
- No direct store mutation in components; always dispatch through stores
## Type Patterns
- Use `_type` field to distinguish variants
- Always use `isAnnotationOfType(ann, "revision")` guard, never compare `_type` directly
- Zod schemas enforce discriminator at parse time
- Annotation models are plain objects (not classes) for JSON serializability
- Classes used only in test helpers and controllers
## Svelte Component Conventions
- Use `$lib/stores` for shared state (not component-local state when multiple components read it)
- Svelte 5 runes preferred for local state (`.svelte.ts` files)
- Accept `let:` bindings for exposing component state to parents
- Named slots for major sections
## Database and Persistence
- Every user action persisted as an immutable event record
- Snapshots stored periodically to speed up load times
- Replay from snapshots + events on load
- CodeMirror StateFields serialize via `toJSON()`/`fromJSON()` in `savedFields`
- Only specified fields are saved (annotation field, history field)
## Path Conventions
- `src/lib/` — All library code
- `src/lib/editor/` — CodeMirror integration, plugins, listeners
- `src/lib/editor/plugins/annotations/` — Annotation subsystem (models, field, utils, effects, keybindings)
- `src/lib/ai/` — AI provider abstraction, streaming, chat
- `src/lib/db/` — Tauri invoke wrappers, event log, database types
- `src/routes/` — SvelteKit pages and layouts
- `src/lib/ui/` — Reusable UI components
- `tests/` — Unit, integration, and E2E tests
- `packages/desktop/src-tauri/` — Tauri backend (Rust)

## Architecture

## Pattern Overview
- Dual state worlds: CodeMirror (immutable, transaction-based) and Svelte stores (reactive, manually synced)
- Annotation-driven non-linear editing model (comments, suggestions, revisions)
- Nested editors as full EditorView instances with parent-relative coordinate mapping
- Event-sourced persistence with SQLite append-only event log + periodic snapshots
- Plugin-based extension system with ViewPlugins for decoration and behavior injection
## Layers
- Purpose: Svelte component tree rendering pages, modals, sidebars, and editor UI
- Location: `src/lib/` (Svelte components) and `src/routes/` (page-level routes)
- Contains: `.svelte` files organized by feature (editor, ai, library, annotations, etc.)
- Depends on: Svelte stores, CodeMirror view, Tauri commands
- Used by: Browser DOM, user interactions
- Purpose: Immutable transaction-based editor state, extensions, plugins
- Location: `src/lib/editor/` (Editor.svelte, extensions.ts, plugins/)
- Contains: StateFields, ViewPlugins, keymaps, transaction builders
- Depends on: CodeMirror 6 (npm), annotation field state, nested editor controllers
- Used by: updateListener, transaction dispatchers, view plugins
- Purpose: Non-linear editing model with comments, suggestions, revisions
- Location: `src/lib/editor/plugins/annotations/`
- Contains: annotationField.ts (StateField), models.ts (types), UI components
- Depends on: CodeMirror state, undo/redo history, event bus
- Used by: Editor, nested editors, annotation cards, AI features
- Purpose: SQLite-based crash-safe storage of document state and events
- Location: `packages/desktop/src-tauri/src/db/` (Rust), `src/lib/db/` (TypeScript wrappers)
- Contains: Event log, snapshots, document metadata, migrations
- Depends on: Tauri invoke(), SQLite (WAL mode), schema versioning
- Used by: listeners.ts, load flow, version history browser
- Purpose: Streaming AI requests, provider abstraction, annotation creation
- Location: `src/lib/ai/` (Chat.svelte, Feedback.svelte, chatFactory.ts, etc.)
- Contains: Provider client setup, multi-persona execution, streaming handlers
- Depends on: Universal AI SDK, CodeMirror state, annotation factory functions
- Used by: User interaction, AutoAI engine, comment suggestion threads
- Purpose: File I/O, native menu, keyboard shortcuts, OS integration
- Location: `packages/desktop/src-tauri/src/` (Rust backend), Tauri bridging in frontend
- Contains: Tauri commands (invoke wrappers), menu registration, keychain
- Depends on: Tauri API, Rust crates (rusqlite, keyring)
- Used by: Frontend via `invoke()` calls, system events
## Data Flow
```
```
## Key Abstractions
- Purpose: DOM-mounted editor instance with plugin system
- Examples: `src/lib/editor/extensions.ts` (main extension stack), `src/lib/editor/Editor.svelte` (mount point)
- Pattern: Extensions registered via `StateField` (data), `ViewPlugin` (behavior), facet providers, keymaps. Each extension can react to `update` events (transaction + state change). `updateListener` is a top-level plugin that syncs to Svelte stores.
- Purpose: Unified data model for comments, suggestions, revisions; persisted state management
- Examples: `src/lib/editor/plugins/annotations/annotationField.ts`, `src/lib/editor/plugins/annotations/models.ts`
- Pattern: `annotationField` is a `StateField<Annotations>` that holds the map `{ id: annotation }`. Every CodeMirror transaction triggers its `update()` function in three deterministic phases: (1) remap selection ranges, (2) apply StateEffects, (3) push doc text to active revision versions. Undo/redo is handled by `invertedAnnotationFieldEffects` which generates reverse effects for each mutation.
- Purpose: Encapsulate lifecycle and sync for inline and modal revision editors
- Examples: `src/lib/editor/plugins/annotations/NestedEditorController.ts`, used by `Revision.svelte` and `RevisionModal.svelte`
- Pattern: Constructor creates an `EditorView` from a `VersionState` blob. `syncFromParent(doc)` patches the buffer when parent changes. `updateListener` calls `translateAndDispatch(parentView, revisionId)` to map nested edits back to parent. `needsVersionSwitch()` and `needsAnnotationRebuild()` signal when to destroy and recreate. Flush behavior configurable: `"flush"` (modal saves state to parent on destroy) vs `"no-flush"` (parent is source of truth via Phase 3).
- Purpose: Manage nested modal overlays for revisions, diffs, comments; track parent-child relationships
- Examples: `src/lib/stores.ts` (`modalStack` store), `src/routes/+page.svelte` (`{#each $modalStack}`), `RevisionModal.svelte`
- Pattern: Stack of entries with `type` (revision/diff/comment), `parentView` (EditorView instance), and stack index. Breadcrumbs derived from `$modalStack.slice(0, stackIndex + 1)`. Deeply nested modals read from `$modalAnnotationStores[stackIndex - 1]` instead of `$annotationsStore` to avoid ID collisions. FSM in `RevisionModal` manages mount/tick/rebuild/ready states.
- Purpose: Typed pub/sub decoupling ViewPlugins and commands from component reactions
- Examples: `src/lib/editor/plugins/annotations/eventBus.ts`, consumed by `Revision.svelte`, `RevisionModal.svelte`
- Pattern: Each event type (e.g., `"revision-boundary-nudge"`, `"nested-annotation-create"`) has subscribers. ViewPlugins emit when user interacts; components subscribe in `$effect` blocks, returning unsubscribe cleanup. No deduplication tokens needed—direct handler dispatch.
- Purpose: Reactive UI state and CodeMirror state mirrors
- Examples: `src/lib/stores.ts` (global), `src/lib/editor/plugins/annotations/index.ts` (annotation-specific)
- Pattern: Writable stores (`editorView`, `annotations`, `documentContent`, `modalStack`, etc.) are manually updated by `updateListener` or explicit dispatches. Derived stores recalculate from dependencies (e.g., `activeAnnotation` derived from `annotations` and `editorView.state.selection`). Components consume via `$store` syntax.
- Purpose: Crash-safe, append-only record of changes with periodic snapshots
- Examples: `src/lib/db/index.ts` (TypeScript), `packages/desktop/src-tauri/src/db/` (Rust)
- Pattern: Every significant change (`docChanged` or annotation mutation) extracts an event payload, appends to SQLite `events` table atomically, returns `needsSnapshot` flag. Snapshots created when ≥50 events accumulated or ≥120 seconds elapsed. Load flow: fetch latest snapshot + events since, restore snapshot, replay events. Undo/redo handled entirely by CodeMirror history; changes are re-recorded as events.
- Purpose: Provider-agnostic streaming and tool-call handling
- Examples: `src/lib/ai/provider.ts` (client setup), `src/lib/ai/chatFactory.ts` (request builders), `src/lib/ai/clientStreams.ts` (stream handlers)
- Pattern: `createModel()` wraps the selected provider (OpenAI, Anthropic, etc.) and exposes a unified interface. `streamChat()`, `streamFeedback()`, `streamRevise()` are mode-specific stream builders that inject system prompts and context. Tool handlers (`createComment`, `createSuggestion`, `createRevision`) dispatch annotation factory functions directly to CodeMirror.
## Entry Points
- Location: `src/routes/+page.svelte`
- Triggers: App startup, navigation via `goToEditor()`, link clicks
- Responsibilities: Mount Editor.svelte with document ID, render three-panel layout (AI sidebar | editor | annotations), manage modal stack rendering, dispatch native menu events (`menu:settings`, `menu:library`, `menu:history`), listen for custom DOM events (`quillium:manual-review`, `quillium:show-changelog`), render error/update banners
- Location: `src/routes/library/+page.svelte`
- Triggers: Navigation via `goToLibrary()` or native menu
- Responsibilities: Fetch document list from Rust, render grid of cards, implement search, trash/restore/delete operations, handle document creation and renaming, show preview panel sidebar
- Location: `src/routes/history/+page.svelte`
- Triggers: Navigation via `goToHistory()` or native menu
- Responsibilities: Thin wrapper that renders VersionHistory.svelte full-screen; handles bootstrap of draft ID if missing
- Location: `src/lib/editor/Editor.svelte`
- Triggers: When `+page.svelte` mounts and document ID is available
- Responsibilities: Load document state via `loadDocumentState()`, create EditorView, mount CodeMirror DOM, set up `updateListener`, subscribe to `documentContent` changes for AI sidebar, manage nested editor mounting/unmounting, handle manual review and AutoAI
- Location: `src/lib/ai/AISidebar.svelte`
- Triggers: Rendered by `+page.svelte` side panel
- Responsibilities: Render tab picker (Chat / Feedback / Revise / Context / Readers / Settings), route to corresponding sub-component, manage API key checking, dispatch `quillium:open-ai-settings` on key error
- Location: `src/lib/autoai/engine.ts`
- Triggers: `startAutoAI()` called from `+page.svelte` on mount
- Responsibilities: Subscribe to `documentContent` store, debounce changes, trigger AI review, dispatch annotation creation commands, manage face state (thinking/reviewing/sleeping)
## Error Handling
## Cross-Cutting Concerns
- CodeMirror state validity checked implicitly via transaction application (invalid changes rejected by CM)
- Annotation field ranges validated via `cleanRangesOf()` helper (collapses zero-width ranges)
- Event log replay wraps each event in try-catch; events that fail to apply are logged as PostHog events
- Type guards throughout: `isAnnotationOfType(annotation, "revision")` never `_type ===`
- AI provider API keys stored in OS keychain via Tauri `packages/desktop/src-tauri/src/keychain.rs`
- Keys retrieved on demand, not cached in memory
- Missing/invalid keys caught on first AI request; banner prompts user to configure
- No multi-user or access control (single-user desktop app)
- Document soft-delete only (trash with retention policy)
- All operations available to any code path (no permission checks)
## Key File Locations
| File Path | Purpose |
|-----------|---------|
| `src/routes/+page.svelte` | Main editor page layout and modal rendering |
| `src/lib/editor/Editor.svelte` | CodeMirror mount point and state sync |
| `src/lib/editor/extensions.ts` | Complete extension stack (history, annotations, keymaps) |
| `src/lib/editor/listeners.ts` | updateListener + event extraction for persistence |
| `src/lib/editor/plugins/annotations/annotationField.ts` | StateField with 3-phase update logic and undo inversion |
| `src/lib/editor/plugins/annotations/models.ts` | Type defs, factory helpers, type guards |
| `src/lib/editor/plugins/annotations/NestedEditorController.ts` | Nested editor lifecycle and parent sync |
| `src/lib/editor/plugins/annotations/index.ts` | ViewPlugins (decorations, collapsed resolver, nudge), keymaps |
| `src/lib/editor/plugins/annotations/eventBus.ts` | Typed pub/sub for ViewPlugin → component events |
| `src/lib/stores.ts` | Global Svelte stores (annotations, documentContent, modalStack, etc.) |
| `src/lib/db/index.ts` | TypeScript Tauri invoke() wrappers for all DB commands |
| `packages/desktop/src-tauri/src/db/mod.rs` | DB module exports and shared types |
| `packages/desktop/src-tauri/src/db/schema.rs` | SQLite schema, migrations, WAL mode setup |
| `packages/desktop/src-tauri/src/db/events.rs` | Event log append, snapshot thresholds |
| `packages/desktop/src-tauri/src/db/load.rs` | State reconstruction from snapshot + event replay |
| `src/lib/ai/chatFactory.ts` | Multi-persona execution, request building, tool dispatch |
| `src/lib/autoai/engine.ts` | AutoAI review orchestration and annotation dispatch |
| `src/lib/editor/replay.ts` | Event log replay with error handling |
| `src/lib/errorGuard.ts` | Suspicious deletion detection before persistence |
