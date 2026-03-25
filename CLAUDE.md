# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Quillium is a modern writing application built with Tauri + SvelteKit + TypeScript. It's an innovative text editor focused on non-linear editing, AI-powered writing assistance, and collaborative features like comments/annotations and revisions. Supports multiple documents via a library view, automatic AI review (AutoAI), and a guided tutorial for new users.

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

# Utility scripts
bun run bump              # Patch version bump
bun run bump:minor        # Minor version bump
bun run bump:major        # Major version bump
bun run screenshots       # Generate screenshots
bun run icons             # Generate app icons
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
- Dictionary & thesaurus popover (§ Dictionary & Thesaurus)
- Common flows: creating comments/revisions, version switching, nested editing, undo (§ Common Flows)
- Keybindings (§ Keybindings)
- PostHog event catalog (§ PostHog Events)
- Known limitations (§ Known Limitations)

### Quick Orientation

**Always use `isAnnotationOfType(annotation, "revision")` — never compare `_type` directly.**

Two routes: `/` (editor) and `/library` (document grid). Page transitions via `src/lib/navigation.ts`.

Key files not covered in ARCHITECTURE.md:
- `src/lib/settings.svelte.ts` — App settings (fonts, zoom, feature toggles, analytics opt-out), persisted to localStorage
- `src/lib/settings/SettingsModal.svelte`, `FontGuideModal.svelte` — Settings UI
- `src/lib/errorGuard.ts` — Suspicious change detection + crash backups to localStorage
- `src/lib/posthog.ts` — PostHog analytics init (opt-out via settings, disabled in dev)
- `src/lib/ui/UpdateBanner.svelte` — In-app auto-updater via `@tauri-apps/plugin-updater`
- `src/lib/editor/plugins/annotations/commentAi.ts` — AI-powered comment features
- `src/lib/editor/plugins/annotations/revisionModalKeyguard.ts` — Keyboard handling in revision modals
- `src/lib/editor/plugins/annotations/CommentModal.svelte` — Full-screen comment modal overlay
- `src-tauri/src/keychain.rs` — Secure API key storage via OS keychain

## Code Style
- 4-space indentation (2-space for JSON)
- 100-character line width
- Trailing commas and semicolons required
- Import organization enabled

---

## Design

See `BRANDING.md` for the full brand bible: color system, typography, spacing, depth, motion, component patterns, voice/copy guidelines, anti-patterns, and design tokens. See `DESIGN.md` for the conceptual model (how revisions, nested editors, undo, and annotations are intended to work from the user's perspective).
