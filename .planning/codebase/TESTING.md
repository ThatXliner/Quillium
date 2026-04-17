# Testing Patterns

**Analysis Date:** 2026-04-16

## Test Framework

**Unit/Integration tests:**
- Runner: Vitest (configured in `vitest.config.ts`)
- Environment: jsdom (browser DOM simulation)
- Setup files: `tests/setup.ts` (Tauri mocks, crypto polyfill)

**E2E tests:**
- Framework: Playwright
- Config: `playwright.config.ts`
- Test directory: `tests/e2e/`
- Base URL: `http://127.0.0.1:4173` (preview/dev server)

**Run Commands:**
```bash
# Unit/integration tests
bun run test              # Watch mode (re-runs on file change)
bun run test:run          # Single run, no watch
bun run test:run src/lib/editor/plugins/annotations/annotations.fuzz.test.ts  # Single file
bun run test:coverage     # With coverage report (v8 provider)

# E2E tests
bun run test:e2e              # Headless Chromium
bun run test:e2e:headed       # With browser window visible
```

**Assertion Library:**
- vitest's built-in `expect()` (uses same API as Jest)
- Playwright's `expect()` for E2E

## Test File Organization

**Location patterns:**

1. **Co-located unit tests** (alongside source):
   - `src/lib/**/*.test.ts` — Test the module in the same directory
   - Examples:
     - `src/lib/editor/dictionary.test.ts`
     - `src/lib/editor/harper/harperLinter.test.ts`
     - `src/lib/posthog.test.ts`

2. **Property-based/fuzz tests** (same location):
   - `src/lib/**/*.fuzz.test.ts` — Uses fast-check for generating arbitrary inputs
   - Example: `src/lib/editor/plugins/annotations/annotations.fuzz.test.ts`

3. **Integration tests** (centralized in tests/):
   - `tests/integration/**/*.test.ts` — Test subsystem interactions
   - `tests/annotations/` — Annotation system unit & integration tests
   - `tests/ai/` — AI provider and streaming tests
   - `tests/editor/` — Replay, restore, export tests
   - `tests/stores/` — Store logic tests
   - Examples:
     - `tests/integration/annotations.stateMachine.test.ts` — Complex state machine verification
     - `tests/integration/nestedEditor.undoRedo.test.ts` — Undo/redo with nested editors
     - `tests/annotations/annotationField.test.ts` — Core annotation field tests

4. **E2E tests** (Playwright):
   - `tests/e2e/**/*.pw.ts` — Browser-based integration tests
   - `tests/e2e/QuilliumPage.ts` — Page object with fluent API (not a test file)
   - `tests/e2e/utils.ts` — Helpers (not a test file)
   - Examples:
     - `tests/e2e/annotationUndo.pw.ts` — User-facing undo workflows
     - `tests/e2e/nestedEditorModal.pw.ts` — Modal nested editor interactions
     - `tests/e2e/libraryMultiSelect.pw.ts` — Document library UI
     - `tests/e2e/tutorial.pw.ts` — Tutorial flow
     - `tests/e2e/app.smoke.pw.ts` — Basic app launch smoke test

5. **Test utilities and helpers:**
   - `tests/setup.ts` — Global setup (Tauri mocks, crypto, store defaults)
   - `tests/helpers/EditorHarness.ts` — Fluent test helper for CodeMirror editor

**Naming:**
- Test files: `*.test.ts`, `*.fuzz.test.ts`, `*.pw.ts`
- Test suites: `describe()` blocks with descriptive names
- Test cases: `it()` with clear, action-focused names (e.g., "should preserve ranges on deletion")

## Test Structure

**Suite organization pattern:**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";

describe("moduleName", () => {
    // Optional: setup/teardown helpers
    function makeState(doc = "Hello, world!") {
        return EditorState.create({
            doc,
            extensions: [annotationField, suggestionPreviewField],
        });
    }

    // Group related tests
    describe("featureName", () => {
        it("should do thing when condition", () => {
            // Arrange
            const state = makeState();
            
            // Act
            const result = doSomething(state);
            
            // Assert
            expect(result).toBe(expected);
        });

        it("should handle edge case", () => {
            // ...
        });
    });
});
```

**Arrangement patterns:**

1. **Helper functions** (local to test file):
   ```typescript
   function sel(from: number, to: number) {
       return EditorSelection.create([EditorSelection.range(from, to)]);
   }
   
   function makeComment(id: number, from: number, to: number): GenericAnnotation {
       return {
           id,
           _type: "comment",
           selection: sel(from, to),
           thread: [],
       };
   }
   ```

2. **Factory builders** (co-located in test):
   ```typescript
   function makeState(doc = "Hello, world!") {
       return EditorState.create({
           doc,
           extensions: [annotationField, suggestionPreviewField],
       });
   }
   ```

3. **EditorHarness** (reusable test helper for complex scenarios):
   ```typescript
   const h = EditorHarness.create("hello world");
   h.addRevision(0, 5).nestedEdit(0, 5, 5, " dear").undo();
   expect(h.doc).toBe("hello world");
   ```

**Test organization by type:**

- **Unit tests** — Single function/class with mocked dependencies
  - Location: Co-located next to source (`src/lib/**/*.test.ts`)
  - Scope: Single module/function
  - Dependencies: Mocked or stubbed

- **Integration tests** — Multiple modules interacting (CodeMirror + annotations + undo/redo)
  - Location: `tests/integration/` or `tests/annotations/`
  - Scope: Subsystem (e.g., nested editor + undo, annotations + state machine)
  - Setup: EditorHarness or minimal EditorView setup
  - Duration: Fast (< 100ms per test)

- **Property-based tests** — Fuzz testing with fast-check
  - Location: `src/lib/**/*.fuzz.test.ts` (alongside the module being tested)
  - Approach: Generate 100+ random inputs, verify invariants
  - Example: `annotations.fuzz.test.ts` generates random annotation operations and verifies state consistency

- **E2E tests** — Full app in browser via Playwright
  - Location: `tests/e2e/`
  - Scope: User workflows (create document, annotate, undo, export)
  - Setup: QuilliumPage page object + Tauri mock config
  - Duration: 5-30 seconds per test (slow)
  - CI: Run on real build (`bun run build && bun run preview`)

## Mocking

**Framework:** `vi` from vitest

**Tauri mocks** (in `tests/setup.ts`):
```typescript
import { clearMocks } from "@tauri-apps/api/mocks";
import { randomFillSync } from "node:crypto";

beforeAll(() => {
    // jsdom doesn't have WebCrypto; polyfill for Tauri's getRandomValues
    Object.defineProperty(window, "crypto", {
        value: {
            getRandomValues: (buffer: Uint8Array) => randomFillSync(buffer),
        },
    });
});

afterEach(() => {
    // Reset Tauri mocks between tests (window is reused across tests)
    clearMocks();
});
```

**Module mocks** (vi.mock at top level):
```typescript
const mocked = vi.hoisted(() => {
    const openaiModelBuilder = vi.fn((modelId: string) => ({
        modelId,
        provider: "openai",
        specificationVersion: "v1",
    }));
    return { createOpenAI: vi.fn(() => openaiModelBuilder), openaiModelBuilder };
});

vi.mock("@ai-sdk/openai", () => ({
    createOpenAI: mocked.createOpenAI,
}));

import { createModel } from "$lib/ai/provider";

beforeEach(() => {
    vi.clearAllMocks();
});

describe("createModel", () => {
    it("routes openai provider through createOpenAI", () => {
        const model = createModel("openai", "openai-key", "gpt-4o-mini");
        expect(mocked.createOpenAI).toHaveBeenCalledWith({ apiKey: "openai-key" });
    });
});
```

**Settings mock** (in `tests/setup.ts`):
```typescript
const mockAppSettings = {
    selectTextInNestedEditor: true,
    showNestedEditor: true,
    atomicRevisions: true,
    docFontFamily: "",
    docFontSize: 18,
    uiFontFamily: "",
    customQuickActions: [],
    titleVisibility: "hover",
    autoVersionOnRevisionCreate: true,
};

vi.mock("$lib/settings.svelte", () => ({ appSettings: mockAppSettings }));
```

**What to Mock:**
- External SDKs (AI providers: OpenAI, Anthropic, Google)
- Tauri invoke calls (database, file system, native APIs)
- Large or stateful dependencies (PostHog, UpdateManager)
- Avoid mocking: CodeMirror, DOM operations, core utilities

**What NOT to Mock:**
- Core utilities (mapRange, cleanRangesOf, type guards)
- CodeMirror EditorState/EditorView/Transaction (test with real instances)
- DOM/browser APIs (jsdom handles these)
- Application state (stores, fields) — test with real state objects

## Fixtures and Test Data

**Location:** Test data factories live in the test file itself

**Pattern:** Helper functions that return test objects
```typescript
function makeComment(id: number, from: number, to: number): GenericAnnotation {
    return {
        id,
        _type: "comment",
        selection: sel(from, to),
        thread: [],
    };
}

function makeRevision(
    id: number,
    from: number,
    to: number,
    versions: { doc: string }[],
    activeVersionIndex = 0,
): GenericAnnotation {
    return {
        id,
        _type: "revision",
        selection: sel(from, to),
        thread: [],
        activeVersionIndex,
        versions,
    };
}
```

**Arbitrary generators** (fast-check for property-based tests):
```typescript
const arbNonNegInt = fc.integer({ min: 0, max: 10_000 });

const arbSelection = fc
    .tuple(
        fc.array(
            fc.tuple(arbNonNegInt, arbNonNegInt).map(([a, b]) => {
                const lo = Math.min(a, b);
                const hi = Math.max(a, b) + 1; // ensure non-collapsed
                return EditorSelection.range(lo, hi);
            }),
            { minLength: 1, maxLength: 4 },
        ),
        fc.integer({ min: 0, max: 3 }),
    )
    .map(([ranges, mainIdx]) =>
        EditorSelection.create(ranges, Math.min(mainIdx, ranges.length - 1)),
    );
```

**EditorHarness fixtures:**
```typescript
const h = EditorHarness.create("hello world");
// Query methods
h.doc                               // Current document text
h.annotations                       // All annotations map
h.annotation(id)                    // Get annotation by id
h.annotationCount                   // Number of annotations
h.annotationIdsOfType("revision")   // Get all revision IDs
h.revisionSlice(id)                 // Text under revision in parent doc
h.undoDepth                         // Steps available to undo
```

## Coverage

**Requirements:** No enforced coverage target; tracked but not gated

**View Coverage:**
```bash
bun run test:coverage
# Outputs: text, json, clover, lcov reports
# Open coverage/index.html in browser for HTML report
```

**Provider:** v8 (built-in)

**Test coverage is high in critical areas:**
- Annotation subsystem (models, field, utils, effects) — 80%+
- Nested editors and undo/redo — 75%+
- Property-based state machine tests — comprehensive invariant verification
- E2E coverage for user-facing workflows (annotation creation, revision editing, undo)

## Test Types

**Unit Tests (co-located):**
- Scope: Single function or class
- Setup: Minimal; factories for test data
- Duration: < 5ms per test
- Examples:
  - `src/lib/editor/dictionary.test.ts` — Dictionary phonetic extraction
  - `src/lib/posthog.test.ts` — Event tracking
  - `src/lib/editor/harper/harperLinter.test.ts` — Lint cache invalidation

**Integration Tests (tests/ directory):**
- Scope: Subsystem with multiple interacting modules
- Setup: EditorHarness or EditorView with extensions
- Duration: 10-100ms per test
- Examples:
  - `tests/integration/nestedEditor.undoRedo.test.ts` — Undo/redo with nested revision edits
  - `tests/integration/annotations.stateMachine.test.ts` — 100+ property-based random operation sequences
  - `tests/integration/persistence.roundtrip.test.ts` — Event log round-trip serialization

**Property-Based Tests (fast-check):**
- Scope: Core utilities with invariant properties
- Approach: Generate 100+ random inputs, verify invariants after every step
- Examples:
  - `src/lib/editor/plugins/annotations/annotations.fuzz.test.ts`
    - Targets: `getNewId`, `createNewAnnotation`, `cleanRangesOf`, `mapRange`
    - Invariants: All ranges within [0, doc.length], serialization round-trip valid
  - `tests/integration/annotations.stateMachine.test.ts`
    - Commands: insert, delete, addRevision, nestedEdit, undo, redo, switchVersion, applySuggestion
    - Invariants: Ranges valid after every step, versions sync, undo depths non-negative

**E2E Tests (Playwright):**
- Scope: Complete user workflows in real browser
- Setup: Page object (QuilliumPage) with Tauri mock configuration
- Duration: 5-30 seconds per test (parallel: 3s per file, serial: 30s)
- Examples:
  - `tests/e2e/annotationUndo.pw.ts` — Create comment/revision, undo/redo
  - `tests/e2e/nestedEditorModal.pw.ts` — Open/edit/save nested revision modal
  - `tests/e2e/threadReply.pw.ts` — Add replies to annotation threads
  - `tests/e2e/tutorial.pw.ts` — Run through tutorial steps
  - `tests/e2e/app.smoke.pw.ts` — App loads and renders initial state

## Common Patterns

**Async Testing:**
```typescript
it("should load document state", async () => {
    const state = await loadDocumentState(docId);
    expect(state.doc).toBe("expected");
});
```

**Error Testing:**
```typescript
it("should handle missing annotation gracefully", () => {
    const h = EditorHarness.create("hello");
    expect(() => h.annotation(999)).toThrow("No annotation with id 999");
});
```

**State Machine Testing** (property-based):
```typescript
fc.assert(
    fc.property(arbCommandSequence, (commands) => {
        const h = EditorHarness.create("initial");
        for (const cmd of commands) {
            executeCommand(h, cmd);
            // Verify invariants after every step
            verifyAnnotationRangesValid(h);
            verifyVersionsSync(h);
            verifyUndoRedoDepth(h);
        }
    }),
    { numRuns: 100 }
);
```

**E2E Test Pattern** (with QuilliumPage):
```typescript
import { test, expect } from "@playwright/test";
import { QuilliumPage } from "./QuilliumPage";

test("create and delete comment", async ({ page }) => {
    const quillium = new QuilliumPage(page, {
        skipTutorial: true,
        initialDoc: "Hello world",
        settings: { showNestedEditor: true },
    });
    
    await page.goto("/");
    await quillium.selectText(0, 5);
    await quillium.createComment("Great!");
    
    expect(await quillium.commentCount).toBe(1);
});
```

## Test Execution

**Local development:**
```bash
# Watch mode (re-runs on save)
bun run test

# Run once
bun run test:run

# Run single file with output
bun run test:run src/lib/editor/plugins/annotations/annotationField.test.ts

# With coverage
bun run test:coverage
```

**CI (playwright.config.ts):**
- 3 retries in CI mode (0 in local)
- Parallel execution enabled
- Server: auto-started from `bun run build && bun run preview` in CI, reuses existing in local
- Timeout: 30 seconds per test, 5 seconds for assertions
- Reporter: list (minimal output)
- Trace: retained on failure for debugging

## Testing Best Practices

1. **Keep tests isolated:** Use `afterEach(() => clearMocks())` to reset state between tests
2. **Use descriptive test names:** "should preserve annotations on text insertion" not "test1"
3. **Arrange-Act-Assert structure:** Clearly separate setup, execution, and verification
4. **Test invariants, not implementation:** Verify behavior, not internal state
5. **Avoid mocking core utilities:** Test with real CodeMirror, real annotation models
6. **Co-locate unit tests:** Keep small focused tests next to the code they test
7. **Group integration tests centrally:** Keep complex subsystem tests in `tests/integration/`
8. **Use factories and helpers:** Extract repeated test setup into helper functions
9. **Property-based tests for invariants:** Use fast-check to verify properties hold under random inputs
10. **E2E tests for user workflows:** Test actual user stories, not internal interactions

---

*Testing analysis: 2026-04-16*
