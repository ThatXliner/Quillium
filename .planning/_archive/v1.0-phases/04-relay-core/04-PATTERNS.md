# Phase 4: Relay Core - Pattern Map

**Mapped:** 2026-04-17
**Files analyzed:** 13
**Analogs found:** 7 / 13

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `relay/src/index.ts` | entry-point | server-startup | `src/lib/db/index.ts` (Quillium) | role-match |
| `relay/src/server.ts` | server | event-driven | (none in codebase) | no-analog |
| `relay/src/auth/middleware.ts` | middleware | request-response | `src/routes/api/omni-waitlist/+server.ts` (quillium-landing) | partial-match |
| `relay/src/auth/supabase.ts` | service | request-response | `src/lib/auth/supabase.ts` (Quillium) | exact |
| `relay/src/rooms/manager.ts` | service | event-driven | (none in codebase) | no-analog |
| `relay/src/rooms/types.ts` | model | N/A | `src/lib/editor/plugins/annotations/models.ts` (Quillium) | role-match |
| `relay/src/rooms/ot.ts` | utility | transform | (none in codebase) | no-analog |
| `relay/src/handlers/connection.ts` | handler | event-driven | (none in codebase) | no-analog |
| `relay/src/handlers/pull.ts` | handler | request-response | (none in codebase) | no-analog |
| `relay/src/handlers/push.ts` | handler | event-driven | (none in codebase) | no-analog |
| `relay/src/schemas.ts` | model | N/A | `src/lib/auth/schemas.ts` (Quillium) | exact |
| `relay/package.json` | config | N/A | N/A | config |
| `relay/tsconfig.json` | config | N/A | N/A | config |

## Pattern Assignments

### `relay/src/auth/supabase.ts` (service, request-response)

**Analog:** `src/lib/auth/supabase.ts` (Quillium client)

**Note:** The relay uses Supabase Admin SDK with `service_role` key (server-side), not anon key (client-side). Pattern is similar but configuration differs.

**Imports pattern** (lines 1-11):
```typescript
/**
 * supabase.ts -- Supabase client singleton for Quillium.
 *
 * Desktop app (Tauri) with no SSR, so we use @supabase/supabase-js
 * directly with localStorage storage (not @supabase/ssr).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
    PUBLIC_SUPABASE_URL,
    PUBLIC_SUPABASE_PUBLISHABLE_ANON_KEY,
} from "$env/static/public";
```

**Relay adaptation:** Replace env import pattern with dotenv for Node.js:
```typescript
/**
 * supabase.ts -- Supabase Admin client for relay server.
 *
 * Uses service_role key for JWT validation and permission queries.
 * No session persistence needed -- server-side only.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
```

**Configuration check pattern** (lines 16-21):
```typescript
export const supabaseConfigured = !!(SUPABASE_URL && SUPABASE_ANON_KEY);

if (!supabaseConfigured) {
    console.warn("[supabase] Missing environment variables -- auth features will not work");
}
```

**Client creation pattern** (lines 22-31):
```typescript
export const supabase: SupabaseClient | null = supabaseConfigured
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          auth: {
              storage: localStorage,
              autoRefreshToken: true,
              persistSession: true, // per D-14: session via localStorage
              detectSessionInUrl: false, // no OAuth redirects for v1
          },
      })
    : null;
```

**Relay adaptation:** No localStorage, no session persistence:
```typescript
export const supabase: SupabaseClient | null = supabaseConfigured
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
          auth: {
              autoRefreshToken: false,
              persistSession: false,
          },
      })
    : null;
```

---

### `relay/src/schemas.ts` (model, validation)

**Analog:** `src/lib/auth/schemas.ts` (Quillium)

**Imports pattern** (lines 1-4):
```typescript
/**
 * schemas.ts -- Form validation schemas for auth forms.
 */
import { z } from "zod";
```

**Simple schema pattern** (lines 6-9):
```typescript
export const loginSchema = z.object({
    email: z.string().email("Invalid email address"),
    password: z.string().min(1, "Password is required"),
});
```

**Type export pattern** (lines 17-18):
```typescript
export type LoginInput = z.infer<typeof loginSchema>;
export type SignUpInput = z.infer<typeof signUpSchema>;
```

**Complex validation with transform** (lines 20-32):
```typescript
export const displayNameSchema = z.object({
    displayName: z
        .string()
        .min(2, "Name must be at least 2 characters")
        .max(50, "Name must be 50 characters or less")
        .regex(
            /^[a-zA-Z0-9\s\-']+$/,
            "Name can only contain letters, numbers, spaces, hyphens, and apostrophes",
        )
        .transform((s) => s.trim()),
});

export type DisplayNameInput = z.infer<typeof displayNameSchema>;
```

---

### `relay/src/rooms/types.ts` (model, types)

**Analog:** `src/lib/editor/plugins/annotations/models.ts` (Quillium)

**File header pattern** (lines 1-26):
```typescript
/**
 * models.ts -- Annotation data model definitions
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

**Simple type definitions** (lines 35-36):
```typescript
export type ThreadMessage = { message: string; author: string; time: number };
export type Thread = ThreadMessage[];
```

**Type guard pattern** (lines 43-48):
```typescript
export function isAnnotationOfType<T extends AnnotationType>(
    annotation: GenericAnnotation,
    type: T,
): annotation is Annotation<T> {
    return annotation._type === type;
}
```

**Factory function pattern** (lines 68-82):
```typescript
export function createNewAnnotation<T extends AnnotationType>(
    annotations: Annotations,
    selection: EditorSelection,
    type: T,
) {
    const newId = getNewId(annotations);
    return {
        selection,
        id: newId,
        _type: type,
        thread: [],
    };
}
```

**Zod schema for complex types** (lines 130-173):
```typescript
export const ThreadMessageSchema = z.object({
    message: z.string(),
    author: z.string(),
    time: z.number(),
});

export const RawAnnotationSchema = z.discriminatedUnion("_type", [
    RawBaseSchema.extend({ _type: z.literal("comment") }),
    RawBaseSchema.extend({
        _type: z.literal("suggestion"),
        replacements: z.array(SuggestionReplacementSchema),
        author: z.string().optional(),
    }),
    RawBaseSchema.extend({
        _type: z.literal("revision"),
        activeVersionIndex: z.number(),
        versions: z.array(VersionStateSchema).min(1),
    }),
]);

export type RawAnnotation = z.infer<typeof RawAnnotationSchema>;
```

---

### `relay/src/auth/middleware.ts` (middleware, request-response)

**Analog:** `src/routes/api/omni-waitlist/+server.ts` (quillium-landing)

**Error handling pattern** (lines 9-14):
```typescript
export const POST: RequestHandler = async ({ request }) => {
    const { email } = await request.json();

    if (!email || typeof email !== 'string') {
        return json({ error: 'Email is required' }, { status: 400 });
    }
```

**Try-catch with logging** (lines 16-63):
```typescript
    try {
        // ... operation logic ...
        return json({ success: true });
    } catch (err) {
        console.error('Omni waitlist endpoint error:', err);
        return json({ error: 'Something went wrong' }, { status: 500 });
    }
```

---

### `relay/src/index.ts` (entry-point, server-startup)

**Analog:** `src/lib/db/index.ts` (Quillium) - barrel file pattern

**Module header pattern** (lines 1-8):
```typescript
/**
 * db/index.ts -- Database access layer (invoke wrappers).
 *
 * All SQLite operations run in Rust via Tauri commands.
 * This module provides typed TypeScript wrappers around
 * `invoke()` calls so the rest of the app never imports
 * @tauri-apps/plugin-sql directly.
 */
```

**Grouped exports pattern** (lines 12-19):
```typescript
// -- Reset ---------------------------------------------------------

/**
 * Wipes all user data (documents, drafts, events, snapshots) and
 * re-initialises the schema. Only used by the dev debug panel.
 */
export async function resetDb(): Promise<void> {
    return invoke<void>("cmd_reset_db");
}
```

---

### Test Files (Wave 0)

**Analog:** `src/lib/editor/plugins/annotations/annotationField.test.ts` (Quillium)

**Test file header pattern** (lines 1-9):
```typescript
/**
 * annotationField.test.ts -- Integration tests for the annotationField StateField.
 *
 * Tests revision version management, Phase 3 (pushDocToVersionState),
 * annotation rebuild detection, and edge cases around version switching
 * and nested annotation flushing.
 *
 * These are pure CodeMirror state-level tests -- no DOM or Svelte needed.
 */
```

**Imports pattern** (lines 10-26):
```typescript
import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
    addAnnotation,
    annotationField,
    createNewRevision,
    // ... more imports
} from "./annotationField";
import { Transaction } from "@codemirror/state";
import { isAnnotationOfType, type Annotations, type VersionState } from "./models";
import { history, undo, redo } from "@codemirror/commands";
```

**Helper section pattern** (lines 28-50):
```typescript
// -- Helpers ----------------------------------------------------------

/** Create a minimal EditorState with annotationField, history, and inverted effects. */
function makeState(doc: string): EditorState {
    return EditorState.create({
        doc,
        extensions: [annotationField, history(), invertedAnnotationFieldEffects],
    });
}

/** Read annotations from an EditorState. */
function getAnnotations(state: EditorState): Annotations {
    return state.field(annotationField);
}
```

**Describe block pattern** (lines 77-94):
```typescript
describe("Phase 3: pushDocToVersionState", () => {
    it("syncs active version doc from parent document on text change", () => {
        // doc: "hello world", revision covers "world" [6, 11]
        let state = makeState("hello world");
        state = addRevision(state, 6, 11, ["world"]);

        // Type inside the revision range.
        state = state.update({
            changes: { from: 6, to: 11, insert: "earth" },
        }).state;

        const rev = getRevision(state, 0);
        expect(rev.versions[0].doc).toBe("earth");
    });
```

---

## Shared Patterns

### Error Handling
**Source:** Multiple files in Quillium codebase
**Apply to:** All relay handler files

```typescript
// Console logging with module prefix
console.error("[module] message", error);
console.warn("[module] message", context);

// Try-catch with specific error types
try {
    // operation
} catch (err) {
    console.error('[handlers] Operation failed:', err);
    // Socket.io error response
    callback({ error: 'OPERATION_FAILED' });
}
```

### Module Documentation
**Source:** `src/lib/editor/plugins/annotations/models.ts` (lines 1-26)
**Apply to:** All new relay files

Each file should have a header comment explaining:
1. File name and purpose (first line)
2. What it contains and its role
3. Key dependencies
4. Main interactions with other modules

### Type Export Convention
**Source:** `src/lib/auth/schemas.ts` (lines 17-18, 32)
**Apply to:** `relay/src/schemas.ts`, `relay/src/rooms/types.ts`

```typescript
// Schema definition
export const SomeSchema = z.object({ ... });

// Derived type export immediately after
export type SomeInput = z.infer<typeof SomeSchema>;
```

### Environment Variable Checking
**Source:** `src/lib/auth/supabase.ts` (lines 16-20)
**Apply to:** `relay/src/auth/supabase.ts`, `relay/src/index.ts`

```typescript
const REQUIRED_VAR = process.env.SOME_VAR;
export const configured = !!REQUIRED_VAR;

if (!configured) {
    console.warn("[module] Missing environment variables -- feature will not work");
}
```

---

## No Analog Found

Files with no close match in the codebase (use RESEARCH.md patterns instead):

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `relay/src/server.ts` | server | event-driven | No Socket.io servers exist in either codebase |
| `relay/src/rooms/manager.ts` | service | event-driven | No room/session management code exists |
| `relay/src/rooms/ot.ts` | utility | transform | No OT/rebaseUpdates usage in server context |
| `relay/src/handlers/connection.ts` | handler | event-driven | No WebSocket connection handlers exist |
| `relay/src/handlers/pull.ts` | handler | request-response | No collab protocol handlers exist |
| `relay/src/handlers/push.ts` | handler | event-driven | No collab protocol handlers exist |

**Recommendation:** For these files, use the code examples from RESEARCH.md Section "Code Examples" which provides:
- Complete server setup with Socket.io
- JWT authentication middleware
- Room management with cleanup timers
- rebaseUpdates wrapper
- Zod schemas for WebSocket messages

---

## Metadata

**Analog search scope:**
- `/Users/bryanhu/Developer/current/Quillium/src/lib/` (Quillium client)
- `/Users/bryanhu/Developer/current/quillium-landing/src/` (Landing page)

**Files scanned:** 25+
**Pattern extraction date:** 2026-04-17
