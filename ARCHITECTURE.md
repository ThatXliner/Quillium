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

The annotation system is a CodeMirror extension that layers comments, revisions, and suggestions onto the document. It is multi-layered: a `StateField` holds the data, `StateEffect`s mutate it, `ViewPlugin`s render decorations and enforce editing rules, and Svelte components display the side panel.

#### File Map

| File | Role |
|------|------|
| `models.ts` | Type definitions, factory functions, type guards |
| `annotationField.ts` | `StateField`, all `StateEffect`s, undo/redo support |
| `utils.ts` | Range mapping, active annotation detection, `canCreateNewComment` |
| `index.ts` | Keybindings, `ViewPlugin`s, `annotations()` extension export |
| `Annotations.svelte` | Floating panel container, card positioning logic |
| `Comment.svelte` | Comment card with thread + AI suggestion |
| `Revision.svelte` | Revision card with version pills + nested editor |
| `Suggestion.svelte` | Suggestion card with replacement buttons |
| `Thread.svelte` / `ThreadMessage.svelte` | Message list + inline edit |
| `PreComment.svelte` | Draft form for pending (unfilled) comments |
| `default.css` | Highlight classes for all annotation types |

#### Data Models

Three annotation types share a common base:

```typescript
type BaseAnnotation = {
    selection: EditorSelection; // what text is annotated
    id: number;
    thread: Thread;             // discussion messages
};

type CommentAnnotation    = BaseAnnotation & { _type: "comment" };
type SuggestionAnnotation = BaseAnnotation & { _type: "suggestion"; replacements: string[] };
type RevisionAnnotation   = BaseAnnotation & {
    _type: "revision";
    currentlySelected: number; // active version index
    versions: string[];        // all version texts
};

type GenericAnnotation = CommentAnnotation | SuggestionAnnotation | RevisionAnnotation;
type Annotations = { [id: number]: GenericAnnotation };
```

`isAnnotationOfType<T>(annotation, type)` is the type guard used throughout the codebase for safe narrowing.

#### `annotationField` — The State Field

`annotationField` is a `StateField<Annotations>` and is the single source of truth. Its `update()` method does three things on every transaction:

1. **Map positions** — `selection.map(change)` repositions annotations when the document changes. If annotated text is fully deleted, the annotation is removed. Revisions are the exception — they survive empty ranges.
2. **Process effects** — `StateEffect` dispatches mutate the annotation objects.
3. **Version text sync** — when text inside an active revision changes in the main document, `versions[currentlySelected]` is updated to match automatically.

The field is fully JSON-serializable (`toJSON`/`fromJSON`) via `EditorSelection.toJSON()`, enabling persistence through Tauri's save system.

#### State Effects

| Effect | Payload | Use |
|--------|---------|-----|
| `addAnnotation` | `GenericAnnotation` | Create any annotation |
| `removeAnnotation` | `GenericAnnotation` | Delete any annotation |
| `updateThread` | `{ annotationId, newThread }` | Update messages |
| `addSuggestion` | `{ targetText, replacements }` | Create suggestion |
| `_addVersionToRevision` | `{ annotationId, newVersion, at? }` | Add revision version |
| `_deleteVersionFromRevision` | `{ annotationId, versionId }` | Remove a version |
| `_updateActiveRevisionVersion` | `{ annotationId, to }` | Switch active version |
| `_updateRevisionVersionText` | `{ annotationId, versionId, text }` | Sync nested editor text |

`_`-prefixed effects are private to `annotationField.ts` and only exposed through public functions (`setActiveRevisionVersion`, `createNewRevision`, etc.). Undo/redo is handled by `invertedAnnotationFieldEffects`, which registers inverse effects so CodeMirror's history can reverse all mutations.

#### Keybindings

| Key | Command |
|-----|---------|
| `Ctrl+Alt+M` | Create comment (redirects to nested editor if cursor is inside an active revision) |
| `Ctrl+Alt+K` | Create revision (same redirect logic) |
| `Backspace` / `Delete` | Show boundary nudge hint; block deleting into an inactive revision |

Commands use a priority chain: `redirectToNestedEditor` runs first and returns `false` if no active revision is under the cursor, falling through to the real command.

#### ViewPlugins

Four plugins run on every relevant update:

- **`annotationDecorations`** — applies CSS classes (`cm-comment`, `cm-revision`, `cm-suggestion`, with `-active` variants) to annotated text. Active state is determined by `getActiveAnnotation()`, which finds the smallest annotation whose range contains the cursor.
- **`revisionAtomicRanges`** — marks inactive revision ranges as atomic via `EditorView.atomicRanges`. The cursor skips over them and partial selection is prevented.
- **`collapsedRevisionResolver`** — when a revision's range collapses to empty (its text was deleted), automatically switches to the next available version or removes the annotation if only one version remained.
- **`blockDirectRevisionEdits`** — a `transactionFilter` that drops any document change touching an inactive revision range. Transactions annotated with `allowRevisionDocEdit` bypass this guard (used when switching versions programmatically).

#### Floating Panel Layout

Annotation cards float in the right panel. Their Y positions are computed:

1. Each annotation's document position is converted to a viewport Y via `view.coordsAtPos()`
2. Cards are stacked top-to-bottom with `MIN_SPACING = 8px` and `TOP_CLAMP = 64px`
3. A `ResizeObserver` watches each card for height changes
4. All recalculations are debounced at 16ms

Clicking a card dispatches `{ anchor: c.selection.main.from }` to the editor, which moves the cursor and triggers the active annotation to update.

#### Comment Flow

```
User selects text
  → Ctrl+Alt+M
  → canCreateNewComment() check (only one pending comment at a time)
  → addAnnotation dispatched { thread: [] }
  → PreComment.svelte renders (pending state: no messages yet)
  → User types + clicks "Comment"
  → updateThread dispatched with first message
  → Comment.svelte renders (thread non-empty)
```

#### Revision Flow

```
User selects text
  → Ctrl+Alt+K
  → addAnnotation dispatched { versions: ["original text"], currentlySelected: 0 }
  → Text becomes atomic (cannot be edited directly)
  → Revision.svelte renders with one version pill

User creates new version:
  → _addVersionToRevision: copies current version text
  → Two version pills shown

User clicks version 2:
  → setActiveRevisionVersion(state, id, 1)
  → document change: replaces selection with versions[1]
  → currentlySelected = 1
  → Selection remapped to span of new text

User opens nested editor (Ctrl+Alt+K inside revision):
  → redirectToNestedEditor fires first
  → revisionOpenNestedEditor store set
  → Revision.svelte opens nested CodeMirror instance
  → Full annotation support in nested editor
  → Text changes sync back via _updateRevisionVersionText
```

#### Nested Editors

Revisions support a full nested editing environment — a complete `EditorView` instance (with its own annotations, history, and keybindings) embedded inside a revision card or modal. There are two surfaces:

**Inline editor** (`Revision.svelte`): A 220px `EditorView` mounted inside the revision card. Created by `createRecursiveEditor()` with all extensions. `syncRecursiveEditorToActiveVersion()` loads the correct version content (including full serialized `VersionState` if present). Text changes sync back to the parent via `_updateRevisionVersionText`.

**Modal editor** (`RevisionModal.svelte`): A full-screen modal editor. Supports arbitrary nesting depth via a breadcrumb stack (`modalStack` in `stores.ts`). Each stack entry is:

```typescript
type ModalEntry = {
    type: "revision" | "diff";
    revisionId: number;
    pendingNestedCommand?: PendingNestedCommand;
};
```

`popToAndRebuild()` signals a parent level to recreate its editor when a child switches versions. A `rebuildToken` (timestamp) drives this recreation.

#### Pending Command System

When the user triggers `Ctrl+Alt+M` or `Ctrl+Alt+K` while the cursor is **inside an active revision** in the main document, the command cannot execute there — it needs to target the nested editor instead. This is handled by a two-step redirect:

**Step 1 — Intercept in main editor** (`index.ts`: `redirectToNestedEditor`):

```
Ctrl+Alt+K pressed
  → redirectToNestedEditor() fires first (high priority)
  → getActiveAnnotation() finds a revision under cursor
  → selection mapped to revision-relative offsets
  → revisionOpenNestedEditor store set with NestedEditorCommand
  → returns true (swallows keypress)
```

**Step 2 — Execute in nested editor** (`Revision.svelte` / `RevisionModal.svelte`):

```
revisionOpenNestedEditor store changes
  → Revision.svelte reacts (if revisionId matches)
  → If inline editor already open: dispatch command immediately
  → If modal needed: push entry onto modalStack with pendingNestedCommand
  → Modal opens, editor mounts, then executes pending command
```

The types involved (`stores.ts`):

```typescript
// Set on the store when main editor intercepts the command
type NestedEditorCommand = {
    revisionId: number;
    type: "comment" | "revision";
    selectionFrom: number; // doc-relative
    selectionTo: number;
};

// Carried on the modal stack entry, coordinates are revision-relative
type PendingNestedCommand = {
    type: "comment" | "revision";
    selectionFrom: number;
    selectionTo: number;
};
```

The coordinate mapping (`RevisionModal.svelte`) converts the pending command's revision-relative offsets to absolute document positions before dispatching into the nested editor.

**Pending comment state** is a separate concept: a comment exists in a pending/draft state when `thread.length === 0`. `canCreateNewComment()` (`utils.ts`) enforces that only one draft comment exists at a time (acts as a mutex). On undo of an empty-thread comment, `annotationField.ts` deletes it entirely rather than leaving a threadless annotation.

#### Persistence

The annotation field participates in full state serialization alongside the history field:

```typescript
// Save
const json = editorView.state.toJSON({ historyField, annotationField });
invoke("save", { state: JSON.stringify(json) });

// Load
const state = EditorState.fromJSON(
    JSON.parse(saved),
    { extensions: getExtensions(...) },
    { historyField, annotationField },
);
```

`EditorSelection` objects serialize to plain JSON and reconstruct on load, preserving annotation positions across sessions.

### Non-linear Editing

The revision system enables non-linear editing (similar to takes in Final Cut Pro). The plan is to eventually explore alternative interfaces such as a tree view.

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
