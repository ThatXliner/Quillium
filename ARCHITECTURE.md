# Architecture Overview

Quillium is built as a modern web application using SvelteKit, packaged as a cross-platform desktop app via Tauri. The architecture emphasizes state management, editor extensibility, and seamless AI integration.

## Core Technologies

- **Frontend Framework**: SvelteKit with TypeScript
- **Editor Engine**: CodeMirror 6 for robust text editing
- **Desktop Runtime**: Tauri (Rust-based)
- **Styling**: Tailwind CSS v4
- **State Management**: Hybrid approach using CodeMirror StateFields + Svelte stores
- **AI Integration**: Universal AI SDK with multiple provider support
- **Build Tools**: Vite + Biome (formatting/linting)

## Application Architecture

### Three-Panel Layout

The main application follows a three-panel design:

```
┌─────────────┬─────────────────┬─────────────────┐
│             │                 │                 │
│ AI Sidebar  │     Editor      │  Annotations    │
│             │                 │                 │
├─────────────┼─────────────────┼─────────────────┤
│ - Chat      │ - CodeMirror 6  │ - Comments      │
│ - Context   │ - Status Bar    │ - Revisions     │
│ - Prompts   │ - Extensions    │ - Side Panel    │
└─────────────┴─────────────────┴─────────────────┘
```

### File Structure

```
# Some insignificant/self-explanatory files have been omitted for brevity.
src/
├── lib/
│   ├── ai/
│   │   ├── AISidebar.svelte  # AI chat picker interface
│   │   ├── Chat.svelte  # The AI chat
│   │   ├── Feedback.svelte  # The AI chat but for feedback
│   │   └── Revise.svelte  # The AI chat but for revisions
│   ├── editor/
│   │   ├── Editor.svelte  # Main CodeMirror-Svelte wrapper
│   │   ├── extensions.ts  # CodeMirror configuration
│   │   ├── listeners.ts  # Event listeners for CodeMirror (used by extensions.ts)
│   │   ├── plugins/
│   │   │   ├── annotations/  # Annotation plugin
│   │   │   └── dont-use-for-now-history/  # A currently non-functional history reimplementation
│   │   └── StatusBar.svelte  # Writing statistics
│   ├── save/
│   │   └── Save.svelte  # Save icon. Separated into its own component for future extension
│   └── stores.ts  # Global Svelte stores
└── routes/
    └── api/  # AI API endpoints
```

## State Management

Quillium uses a hybrid state management approach to handle the complexity of editor state synchronization:

### 1. CodeMirror StateFields

Used for editor-specific state that needs to be part of the undo/redo history:

```typescript
// Annotation state field (excerpt from src/lib/editor/plugins/annotations/annotationField.ts)
export const annotationField = StateField.define<Annotations>({
  create(): Annotations {
    return [];
  },
  update(oldAnnotations: Annotations, tr: Transaction): Annotations {
    // ...
  }
}
```

**Manages:**
- Document content and editing history
- Annotations (comments, revisions)
- Editor selections and decorations
- Extension state

### 2. Svelte Stores

Used for UI state that needs to be reactive across components:

```typescript
// Global stores in src/lib/stores.ts
export const editorView = writable<EditorView | null>(null);
export const annotations = writable<Annotation[]>([]);
export const activeComment = writable<string | null>(null);
```

**Manages:**
- Editor view instance reference
- UI panel visibility and state
- Cross-component communication
- AI chat history and context

### State Synchronization

The challenge is keeping CodeMirror state and Svelte stores in sync. This is handled through:

1. **Update Listeners**: CodeMirror dispatches updates to Svelte stores
2. **Manual Sync**: Critical state changes trigger explicit synchronization
3. **Event System**: Custom events for complex state changes

See `src/lib/editor/listeners.ts` and `src/lib/editor/Editor.svelte`.

## Editor System

We use [CodeMirror 6](https://codemirror.net/) for the core editing library.

### Annotation System

The annotation system is a CodeMirror extension that layers comments, revisions, and suggestions onto the document.

**Key Components:**
- `annotationField.ts`: StateField managing annotation data
- `Annotations.svelte`: Side panel for displaying annotations
- `Suggestion.svelte` / `Comment.svelte` / `Revision.svelte`: Individual annotation components
  - I honestly need to organize the whole `src/lib/editor/plugins/annotations` folder better

### Non-linear Editing

The revision system enables non-linear editing currently by the revision system (similar to takes in Final Cut Pro). Eventualy we're going to explore alternative interfaces such as a tree view.

## AI Integration

### Architecture

TODO. This may be subject to change and is currently under ongoing development.

<!--
AI integration follows a provider-agnostic approach using the Universal AI SDK:

```typescript
// AI client configuration
import { createOpenAI } from '@ai-sdk/openai';
import { streamText } from 'ai';

const openai = createOpenAI({
    apiKey: process.env.OPENAI_API_KEY
});
```

### Components

- **AISidebar.svelte**: Main AI interface with chat and context panels
- **Chat.svelte**: Conversation UI with streaming responses
- **Reference.svelte**: Document context display for AI prompts
- **API Route**: Server-side AI integration (`/api/chat/+server.ts`)

### Context Integration

The AI system maintains awareness of document context:

```typescript
function injectDocumentContext(message: string, document: string): string {
    return `Document context:\n${document}\n\nUser message: ${message}`;
}
```-->

## Data Flow

TK. There's currently really bad AI generated docs that are commented out. Beware it may be misleading.

<!--### Editing Flow

1. User types in CodeMirror editor
2. CodeMirror dispatches document change

### AI Interaction Flow

1. User sends message in AI sidebar
2. Current document context is extracted
3. Message + context sent to AI API route
4. Streaming response displayed in chat
5. AI suggestions can be applied to editor

### Annotation Flow

1. User creates annotation (comment/revision)
2. Annotation updated in CodeMirror StateField
3. UI components subscribe to annotation changes
4. Side panel updates to show new annotation
5. Editor decorations render visual indicators-->

## Performance Considerations

TK. Performance is the least of our priorities right now (especially considering that this is a JavaScript application).

<!--### Editor Performance

- **Lazy Loading**: Extensions loaded only when needed
- **Efficient Updates**: Minimal re-renders via targeted state updates
- **Virtual Scrolling**: Large documents handled efficiently by CodeMirror

### State Synchronization

- **Debounced Updates**: Prevent excessive sync operations
- **Selective Updates**: Only sync changed state portions
- **Memory Management**: Clean up unused annotation references-->

## Development Workflow

### Build System

- **Vite**: Fast development server and optimized builds
- **SvelteKit**: SSG mode for Tauri compatibility
- **Biome**: Fast formatting and linting
- **TypeScript**: Strict type checking across the codebase

### Code Quality

- **4-space indentation** (configured in biome.json)
- **80-character line width**
- **Strict TypeScript** configuration
- **Svelte-specific** linting rules

## Future Architecture Plans

<!--### Plugin Architecture

- **Extension API**: Public API for third-party extensions
- **Plugin Manager**: Runtime plugin loading and management
- **Sandboxing**: Safe execution environment for community plugins-->

### Collaboration

- **Real-time Sync**: Operational transform for collaborative editing
- **Conflict Resolution**: Merge strategies for simultaneous edits
- **Presence Awareness**: Show other users' cursors and selections
