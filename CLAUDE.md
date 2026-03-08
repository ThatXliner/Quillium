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

# Tauri commands
bun run tauri dev        # Run Tauri development mode
bun run tauri build      # Build Tauri application
```

## Architecture Overview

### Frontend Stack
- **SvelteKit**: Web framework with static adapter for Tauri compatibility
- **TypeScript**: Strict typing enabled
- **Tailwind CSS**: Styling framework (v4)
- **CodeMirror 6**: Core editor functionality
- **Biome**: Linting and formatting (4-space indentation, 80-character line width)

### Backend/Desktop
- **Tauri**: Cross-platform desktop application framework
- **Rust**: Backend logic (minimal currently)

### State Management
Two primary state management approaches are used:

1. **CodeMirror StateFields**: For editor-specific state (annotations, document content)
2. **Svelte Stores**: For UI state synchronization with editor state

Key global stores in `src/lib/stores.ts`:
- `editorView`: Main CodeMirror editor instance
- `annotations`: Manually synced annotation state
- `activeAnnotation`: Currently focused annotation (comment, revision, or suggestion)

### Core Components

#### Editor System (`src/lib/editor/`)
- `Editor.svelte`: Main editor component with CodeMirror integration
- `extensions.ts`: CodeMirror extension configuration
- `StatusBar.svelte`: Writing statistics (word count, WPM, character count)

#### Annotation System (`src/lib/editor/plugins/annotations/`)
- `annotationField.ts`: CodeMirror state field for annotations
- `Annotations.svelte`: Side panel for displaying/managing annotations
- `Comment.svelte` & `Revision.svelte`: Individual annotation components
- `models.ts`: TypeScript interfaces for annotation data structures

#### AI Integration (`src/lib/ai/`)
- `AISidebar.svelte`: AI-powered writing assistant interface
- `Chat.svelte`: Conversation interface with AI
- `Reference.svelte`: Context reference display
- `index.ts`: OpenAI client configuration

### Application Layout
The main layout (`src/routes/+page.svelte`) uses a three-panel design:
- Left: AI Sidebar
- Center: Editor
- Right: Annotations panel

## Development Environment

### Configuration Files
- `biome.json`: Linting/formatting rules with Svelte-specific overrides
- `svelte.config.js`: Static adapter configuration for Tauri
- `vite.config.js`: Tauri-specific Vite configuration (port 1420)
- `src-tauri/tauri.conf.json`: Desktop application configuration

### Code Style
- 4-space indentation (2-space for JSON)
- 80-character line width
- Trailing commas and semicolons required
- Import organization enabled

## Key Development Notes

### State Synchronization
Due to CodeMirror's architecture, manual state synchronization is required between editor state and Svelte stores. The editor's `updateListener` in `Editor.svelte` handles this synchronization.

### AI Integration
The application uses OpenAI's API through the `@ai-sdk/openai` package. API configuration is handled in `src/lib/ai/index.ts`.

### Testing
No specific testing framework is currently configured. When adding tests, check the codebase for any existing test setup before assuming a framework.

### Build Process
The application uses a static build process via `@sveltejs/adapter-static` to be compatible with Tauri's requirements. The Tauri configuration handles the build orchestration between frontend and backend.

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
