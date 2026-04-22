# Coding Conventions

**Analysis Date:** 2026-04-16

## Naming Patterns

**Files:**
- Source files: `camelCase.ts` (e.g., `annotationField.ts`, `harperLinter.ts`)
- Svelte components: `PascalCase.svelte` (e.g., `Editor.svelte`, `Comment.svelte`)
- Test files: `<name>.test.ts` or `<name>.fuzz.test.ts` or `<name>.pw.ts` (Playwright) (e.g., `annotationField.test.ts`, `annotations.fuzz.test.ts`)
- Store files: `<name>.svelte.ts` (Svelte runes stores) (e.g., `settings.svelte.ts`, `autoai/settings.svelte.ts`)
- Configuration: `<tool>.<ext>` or `<tool>.config.<ext>` (e.g., `biome.json`, `vitest.config.ts`, `playwright.config.ts`)

**Functions:**
- Exported utility functions: `camelCase` (e.g., `cleanRangesOf`, `getNewId`, `createNewAnnotation`)
- Command functions: `verbNoun` pattern (e.g., `addAnnotation`, `removeAnnotation`, `setActiveRevisionVersion`, `updateThread`)
- Query functions: `getNoun` or `getActiveNoun` pattern (e.g., `getNewId`, `getLastId`, `getActiveAnnotation`)
- Type guards: `isNoun` pattern (e.g., `isAnnotationOfType`)
- Internal/private functions: prefix with `_` (e.g., `_restoreAnnotation`, `_nestedEditRevision`)

**Variables:**
- Constants: `UPPER_SNAKE_CASE` (e.g., `SAMPLE_DOCUMENT_TITLE`, `CODEX_PROXY_BASE_URL`)
- Mutable values: `camelCase` (e.g., `persistQueue`, `metaDebounceTimers`)
- Destructured imports: `camelCase` (e.g., `{ createNewAnnotation, isAnnotationOfType }`)

**Types:**
- Exported types: `PascalCase` (e.g., `Annotations`, `GenericAnnotation`, `VersionState`)
- Discriminated union fields: `_type` for type discriminator (e.g., `_type: "comment"`, `_type: "revision"`)
- **Important:** Use `isAnnotationOfType()` type guard—never compare `_type` directly (see note in CLAUDE.md)
- Zod schema types: `PascalCase + "Schema"` suffix (e.g., `RawAnnotationsSchema`, `ThreadMessageSchema`)
- Union types: `Noun | Noun` pattern (e.g., `"openai" | "openai-codex" | "anthropic" | "google"`)

**Store symbols:**
- Exported stores: `camelCase` (e.g., `annotations`, `currentDocumentId`, `editorView`)
- Mock instances: `mock<Service>` (e.g., `mockAppSettings`)

## Code Style

**Formatting:**
- Tool: Biome (configured in `biome.json`)
- Indentation: 4 spaces
- Line width: 100 characters
- Line endings: LF
- Trailing commas: All (enabled in JS formatter)
- Semicolons: Always required
- Import organization: Enabled

**Linting:**
- Tool: Biome with recommended rules enabled
- Svelte files: `useConst` and `useImportType` rules disabled
- Test files: `noNonNullAssertion` rule disabled to allow non-null assertions in tests

**File formatting rules:**
- JSON files: 2-space indentation (override from 4-space)
- Svelte/Astro/Vue files: `useConst` and `useImportType` disabled
- TypeScript test files: Non-null assertions permitted

**Run formatting/linting:**
```bash
bun run format    # Format code
bun run lint      # Lint code
bun run biome     # Run both format and lint
```

## Import Organization

**Order:**
1. External packages from `node:` stdlib (e.g., `import { randomFillSync } from "node:crypto"`)
2. Third-party packages (e.g., `@codemirror`, `zod`, `lodash-es`)
3. Internal alias imports starting with `$lib/` (e.g., `$lib/editor/plugins/annotations/models`)
4. Local relative imports (e.g., `./utils`, `../constants`)

**Path Aliases:**
- `$lib/` → `src/lib/` (configured in SvelteKit, used throughout)

**Import grouping example** (from `annotationField.ts`):
```typescript
import {
    Annotation,
    EditorSelection,
    type EditorState,
    SelectionRange,
    StateEffect,
    StateField,
    Transaction,
} from "@codemirror/state";
import {
    createNewAnnotation,
    getLastId,
    getNewId,
    isAnnotationOfType,
    versionText,
    RawAnnotationsSchema,
    type Annotations,
    type GenericAnnotation,
    type RawAnnotations,
    type SuggestionReplacement,
    type Thread,
    type VersionState,
} from "./models";
import { cleanRangesOf, mapRange } from "./utils";
import { invertedEffects } from "@codemirror/commands";
import { SearchCursor } from "@codemirror/search";
import { mapValues } from "lodash-es";
```

**Type imports:** Place `type` keyword in import statements when importing only types:
```typescript
import type { GenericAnnotation, Annotations } from "./models";
```

## Comments and Documentation

**File-level documentation:**
Every TypeScript and library file opens with a module doc block explaining:
- File name and purpose (first line as `filename.ts — Brief description`)
- What it contains and its role in the system
- Key dependencies it uses
- Main interactions with other modules

Example from `models.ts`:
```typescript
/**
 * models.ts — Annotation data model definitions
 *
 * This file defines the core data types for the annotation
 * subsystem: comments, suggestions, and revisions. All types
 * are plain objects (not classes) to remain JSON-serializable
 * for CodeMirror StateField persistence.
 *
 * Role in the annotation subsystem:
 *   - Provides the canonical type definitions consumed by
 *     annotationField.ts (state), utils.ts (queries), and
 *     index.ts (commands/decorations).
 *   - Exports factory helpers (createNewAnnotation, clone)
 *     and type guards (isAnnotationOfType) used across the
 *     subsystem.
 *
 * Key dependencies:
 *   - @codemirror/state (EditorSelection) for range data.
 *
 * Interactions:
 *   - annotationField.ts stores Annotations (a map of these
 *     types) inside a CodeMirror StateField.
 *   - utils.ts queries annotations by cursor position.
 *   - index.ts dispatches effects that create/mutate these
 *     types.
 */
```

**Section comments:**
Group related code with visual separators:
```typescript
// ── Arbitraries ─────────────────────────────────────────────────────────────

const arbNonNegInt = fc.integer({ min: 0, max: 10_000 });
```

**Inline comments:**
- Comment non-obvious logic, workarounds, and important constraints
- Explain "why" not "what" — code shows what; comments explain design decisions
- Mark important requirements with bold or ALL_CAPS: `// DO NOT COMPARE _type; instead use isAnnotationOfType`

**JSDoc:** Not consistently used; prefer module-level comments and section headers for clarity.

## Error Handling

**Pattern:** Try-catch with explicit error logging to console.

**Where errors are logged:**
- File: `src/lib/editor/listeners.ts` — persistence layer catches errors from Tauri invokes
- File: `src/lib/errorGuard.ts` — suspicious change detection and recovery

**Common pattern:**
```typescript
try {
    await appendEvent(eventPayload);
} catch (e) {
    console.error("[listeners] appendEvent failed:", e);
}
```

**Error context:**
- Log prefixes include module name (e.g., `[listeners]`, `[caretBroadcast]`)
- Full error object logged for debugging

**Suspended errors:**
- Some async operations use `.catch(() => {})` to silently fail without interrupting the operation chain
- Example: Meta updates are debounced and failures don't stop other operations

## Logging

**Framework:** `console.error()`, `console.warn()` used selectively

**Patterns:**
- Errors: `console.error("[module] message", error)`
- Warnings: `console.warn("[module] message", context)`
- No debug/info logging in production code (kept minimal)

**Example from `listeners.ts`:
```typescript
} catch (e) {
    console.error("[caretBroadcast] coordsAtPos failed — no layout engine?", e);
}
```

## Function Design

**Size:** Functions are tightly focused on a single responsibility, often 10-30 lines. Longer utilities (50+ lines) break into smaller helpers.

**Parameters:**
- Ordered by specificity: required globals/state first, then specific arguments
- Prefer parameter object destructuring when function has 3+ params
- Type annotations always present

**Example:**
```typescript
export function mapRange(annotation: GenericAnnotation, change: ChangeDesc) {
    // Focused utility
}

export function createModel(provider: Provider, apiKey: string, modelId: string): LanguageModel {
    // 3+ params shown explicitly
}
```

**Return Values:**
- Always explicitly typed
- Query functions return `Value | undefined` (e.g., `getActiveAnnotation(): GenericAnnotation | undefined`)
- Pure functions never throw; use `null` or `undefined` for "not found"
- Functions that may fail return union types or explicit null (e.g., `cleanRangesOf()` returns `EditorSelection | null`)

## Module Design

**Exports:**
- Prefer named exports (not default)
- Export only what's needed publicly; keep internal utilities private with `_` prefix
- Re-export from `index.ts` files for convenience (barrel files)

**Example from `annotationField.ts`:**
```typescript
export const addAnnotation = StateEffect.define<GenericAnnotation>({
    map: mapRange,
});
const _restoreAnnotation = StateEffect.define<GenericAnnotation>({
    // ... internal only
});
export function getNewId(annotations: Annotations) { ... }
```

**Barrel files:**
- Location: `index.ts` in each module
- Purpose: Re-export public API from submodules for cleaner imports
- Example: `src/lib/editor/plugins/annotations/index.ts` exports effects, commands, and extensions

**File organization:** Related utilities grouped by responsibility:
- `models.ts` — Type definitions and serialization
- `utils.ts` — Pure query/transform functions
- `annotationField.ts` — StateField and effects
- `index.ts` — Commands, keybindings, extensions

## State and Mutations

**CodeMirror StateField pattern:**
- All annotation data stored in a single `annotationField: StateField<Annotations>`
- Mutations via `StateEffect` objects dispatched through transactions
- No direct field mutation; all changes go through the reducer
- Undo/redo via `invertedEffects` with proper `map` functions

**Svelte stores:**
- Runes-based stores (`.svelte.ts` files) with `writable()`, `readable()`, `derived()`
- Stores re-exported from `src/lib/stores.ts` for centralized access
- No direct store mutation in components; always dispatch through stores

**Example from settings:**
```typescript
export const appSettings = writable(defaultSettings);
```

## Type Patterns

**Discriminated unions:**
- Use `_type` field to distinguish variants
- Always use `isAnnotationOfType(ann, "revision")` guard, never compare `_type` directly
- Zod schemas enforce discriminator at parse time

**Generic constraints:**
```typescript
export function isAnnotationOfType<T extends AnnotationType>(
    annotation: GenericAnnotation,
    type: T,
): annotation is Annotation<T> {
    return annotation._type === type;
}
```

**Plain objects over classes:**
- Annotation models are plain objects (not classes) for JSON serializability
- Classes used only in test helpers and controllers

## Svelte Component Conventions

**Script block structure:**
1. Imports (external, then `$lib`, then local)
2. Type definitions
3. Store subscriptions / reactive assignments
4. Event handlers
5. Lifecycle hooks (onMount, etc.)

**Reactivity:**
- Use `$lib/stores` for shared state (not component-local state when multiple components read it)
- Svelte 5 runes preferred for local state (`.svelte.ts` files)

**Slot usage:**
- Accept `let:` bindings for exposing component state to parents
- Named slots for major sections

## Database and Persistence

**Event log pattern:**
- Every user action persisted as an immutable event record
- Snapshots stored periodically to speed up load times
- Replay from snapshots + events on load

**Field serialization:**
- CodeMirror StateFields serialize via `toJSON()`/`fromJSON()` in `savedFields`
- Only specified fields are saved (annotation field, history field)

## Path Conventions

**Source structure:**
- `src/lib/` — All library code
- `src/lib/editor/` — CodeMirror integration, plugins, listeners
- `src/lib/editor/plugins/annotations/` — Annotation subsystem (models, field, utils, effects, keybindings)
- `src/lib/ai/` — AI provider abstraction, streaming, chat
- `src/lib/db/` — Tauri invoke wrappers, event log, database types
- `src/routes/` — SvelteKit pages and layouts
- `src/lib/ui/` — Reusable UI components
- `tests/` — Unit, integration, and E2E tests
- `src-tauri/` — Tauri backend (Rust)

---

*Convention analysis: 2026-04-16*
