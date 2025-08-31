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
- `activeComment`: Currently selected comment annotation

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