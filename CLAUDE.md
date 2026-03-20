# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Quillium is a modern writing application built with Tauri + SvelteKit + TypeScript. It's an innovative text editor focused on non-linear editing, AI-powered writing assistance, and collaborative features like comments/annotations and revisions.

## Development Commands

```bash
# Development server
bun run dev

# Build for production
bun run build

# Preview production build
bun run preview

# Type checking
bun run check

# Type checking (watch mode)
bun run check:watch

# Linting and formatting (uses Biome)
bun run format    # Format code
bun run lint      # Lint code
bun run biome     # Run both format and lint

# Testing (uses Vitest — must use `bun run test`, NOT `bun test`)
bun run test          # Watch mode
bun run test:run      # Single run
bun run test:run src/lib/editor/plugins/annotations/annotations.fuzz.test.ts  # Single file

# End-to-end tests (Playwright)
bun run test:e2e              # Headless
bun run test:e2e:headed       # With browser window

# Tauri commands
bun run tauri dev        # Run Tauri development mode
bun run tauri build      # Build Tauri application
```

## Architecture Overview

See `ARCHITECTURE.md` for the full deep dive — especially the annotationField three-phase update cycle, undo/redo inversion, and nested editor sync. What follows is enough to orient quickly.

### Tech Stack
- **SvelteKit** (static adapter for Tauri) + **TypeScript** (strict) + **Tailwind CSS v4**
- **CodeMirror 6**: Core editor engine — owns document state, annotations, undo history
- **Tauri** (Rust): Desktop runtime, SQLite persistence via Tauri commands
- **Biome**: Linting/formatting (4-space indent, 80-char line width, trailing commas + semicolons)

### Application Layout

Three-panel layout in `src/routes/+page.svelte`:
- **Left**: AI Sidebar (Chat / Feedback / Revise tabs)
- **Center**: CodeMirror editor (816px fixed width)
- **Right**: Annotations panel (comment, revision, suggestion cards)

Modal overlays (revision editors, diff views) stack on top via `modalStack` in `src/lib/stores.ts`.

### State Management: CodeMirror ↔ Svelte

CodeMirror owns its own immutable state — `EditorView.state` is swapped on every transaction, but `EditorView` itself is a stable mutable object that Svelte's reactivity system cannot observe. Manual synchronization is required:

1. `Editor.svelte`'s `updateListener` fires on every transaction
2. It pushes values into Svelte writable stores (`annotations`, `activeAnnotation`, `documentContent`, `selectedText`)
3. Components read these stores for reactive rendering

`$editorView` is set once at mount and never re-fires — use it only for imperative access (dispatching transactions), never for deriving reactive state.

### The Annotation System

The annotation system is Quillium's core complexity. Three annotation types share a `BaseAnnotation` (selection, id, thread):
- **Comment**: Text thread attached to a range
- **Suggestion**: AI-generated replacement text with rationale
- **Revision**: Multiple named versions of a text range, with nested editor support

**Always use `isAnnotationOfType(annotation, "revision")` — never compare `_type` directly.**

The system is layered across files in `src/lib/editor/plugins/annotations/`:
- `models.ts` — Types, factory helpers, type guards, Zod schemas (no CodeMirror imports)
- `annotationField.ts` — StateField + StateEffects + undo inversion (the heart of it)
- `utils.ts` — Range mapping, active annotation queries
- `index.ts` — ViewPlugins, keybindings, public API factory functions
- `eventBus.ts` — Typed pub/sub bus decoupling ViewPlugins from components
- `NestedEditorController.ts` — Shared lifecycle/sync for inline and modal nested editors

#### annotationField Three-Phase Update

`annotationField.update()` runs on every transaction:

1. **Remap positions** — maps all annotation selections through doc changes. Comments/suggestions removed if range collapses to zero. Revisions survive briefly for cleanup.
2. **Apply effects** — processes StateEffects (add, remove, thread update, version switch, etc.). Tracks which revisions had explicit effects.
3. **Push doc to version state** — for revisions NOT in the explicit-effect set, reads the doc slice under the revision range and writes it into `versions[activeVersionIndex].doc`.

Phase 3 only runs when `tr.docChanged`. This is how typing inside an active revision in the main doc keeps version text current without explicit effects.

### Nested Editors

Revision annotations support editing via nested CodeMirror editors (inline in the card or in a full-screen modal). Both delegate to `NestedEditorController`:

- **Nested → parent**: `translateAndDispatch` maps changes to parent coordinates and dispatches with `nestedEditorEdit.of(revisionId)` + `addToHistory: true`
- **Parent → nested**: `syncFromParent(doc)` patches the nested buffer when external changes arrive, tagged with `parentSyncEdit` annotation to prevent echo loops
- **Undo**: Nested editors have no local history — Mod-z delegates to `undo(parentView)`. The parent undo inverts the doc change, Phase 3 re-reads the correct text, and the Svelte `$effect` patches the nested editor
- **Modal flush**: Modal editors use `flushBehavior: "flush"` to serialize nested state back to the parent version blob on destroy

Modals support infinite nesting — each modal's `parentView` can be another nested EditorView. `translateAndDispatch` chains upward automatically.

### Persistence

SQLite event log (Rust, WAL mode) with periodic snapshots:
- Every `docChanged` or annotation mutation → `appendEvent()` via Tauri `invoke()`
- Snapshot triggered after ≥50 events or ≥120 seconds since last snapshot
- Load = latest snapshot + replay events since snapshot via `replayEvents()`
- Active revision version text is crash-safe (per-keystroke via `translateAndDispatch`). Non-active version text and `activeVersionIndex` are snapshot-only.

### AI Integration

Provider-agnostic via the universal `ai` SDK with `@ai-sdk/openai`, `@ai-sdk/anthropic`, and `@ai-sdk/google`. Provider/model configuration in `src/lib/ai/settings.svelte.ts`, client setup in `src/lib/ai/provider.ts`.

## Code Style
- 4-space indentation (2-space for JSON)
- 80-character line width
- Trailing commas and semicolons required
- Import organization enabled

---

## Design Context

### Users
Fiction and nonfiction writers doing long-form creative work — novels, essays, personal writing. They open Quillium to enter a focused writing state. The tool should feel like a quiet, trusted companion: present when needed, invisible when not. The job to be done is *getting into flow and staying there*, with AI and annotation assistance that feels natural rather than intrusive.

### Brand Personality
**Warm. Creative. Focused.**

Quillium has the tactile warmth of a well-made notebook. It respects the writer's headspace — never loud, never demanding — but carries genuine personality. Think Craft or Bear, not Notion. The interface should feel like a workspace a writer would be proud to spend hours in. We use neumorphic/glassmorphic UI interface for a fun and modern experience.

### Aesthetic Direction
- **Theme**: Light only. Warm whites and soft off-whites rather than clinical pure white.
- **Color**: Blue as primary interaction color, contextual greens/purples for AI features. Accent colors should be desaturated and gentle — not neon or harsh.
- **Typography**: Generous, readable body text (currently 18px SF Pro). UI chrome uses smaller type but maintains clarity.
- **Spacing**: Breathable. Panels shouldn't feel cramped. White space is intentional and valued.
- **Depth**: Subtle — `shadow-sm` for panels, `shadow-xl` for the editor document card. Glass-morphism used sparingly (status bar, save menu).
- **References**: Bear, Craft, iA Writer for warmth and focus. Not Figma, Jira, or dense productivity tools.
- **Anti-references**: Avoid harsh primary colors, aggressive gradients, heavy dark chrome, or interfaces that feel like dashboards.

### Design Tokens (Existing)
- **Editor font**: SF Pro Text, system-ui stack, 18px
- **Primary**: blue-500 / blue-600 (hover)
- **Feedback/AI green**: green-500 / green-50 (bg)
- **Revision/AI purple**: purple-500 / purple-50 (bg)
- **Comment highlight**: `#fef2cd` (inactive), `#fcbc05` (active)
- **Suggestion highlight**: `#f0fdf4` (inactive), `#dbf9e2` (active)
- **Border radius**: `rounded-lg` default; `rounded-full` for pill shapes
- **Panel padding**: `p-4` standard
- **Document width**: 816px fixed

### Design Principles
1. **The writing comes first.** Chrome, controls, and AI features should retreat to the edges. The editor is the product — everything else is scaffolding.
2. **Warmth over sterility.** Prefer soft backgrounds, gentle shadows, and slightly warm tones. Avoid clinical grays and pure-white flatness.
3. **Calm interactions.** Transitions should be smooth and unhurried (`transition-colors`, `duration-300`). Avoid jarring state changes or aggressive animations.
4. **Color with intention.** Each action type has a hue (blue = chat, green = feedback, purple = revise, yellow = comment). Honor these associations consistently throughout the UI.
5. **WCAG AA as a floor.** Sufficient contrast is required on all text and interactive elements. Focus states must be clearly visible. Don't rely on color alone to convey state.
