---
phase: 08-annotation-sync
plan: 01
subsystem: collab
tags: [yjs, codemirror, annotations, crdt, relative-position, zod]

# Dependency graph
requires:
  - phase: 07-connection-ux
    provides: CollabSession type and Yjs provider infrastructure
provides:
  - YjsAnnotation interface for collaborative annotation storage
  - RelativePosition encode/decode utilities (absoluteToRelative, relativeToAbsolute)
  - Bidirectional converters between CM and Yjs annotation formats
  - AnnotationIdMap for numeric<->string ID bridging
  - Zod validation schema for Y.Map annotation entries
affects:
  - 08-annotation-sync (plans 02+ build on these types and converters)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "JSON-serialized nested data in Y.Map to avoid Yjs bug #642 with nested Y.Arrays"
    - "Client-prefixed string IDs (clientId-timestamp-random) for collab-safe uniqueness"
    - "try-catch wrapping around Yjs position decode and JSON.parse for tamper safety"

key-files:
  created:
    - src/lib/collab/types.ts (YjsAnnotation interface added)
    - src/lib/collab/relativePosition.ts
    - src/lib/collab/relativePosition.test.ts
    - src/lib/collab/annotationSchema.ts
    - src/lib/collab/annotationSchema.test.ts
    - src/lib/collab/types.test.ts
  modified:
    - src/lib/collab/types.ts (CollabSession extended with ymap field)

key-decisions:
  - "Store thread/versions/replacements as JSON strings in Y.Map (not nested Y.Array) to avoid Yjs UndoManager bug #642"
  - "Use client-prefixed string IDs for Yjs annotations to prevent ID collisions between concurrent clients"
  - "Wrap position decode and JSON.parse in try-catch to null-safe handle corrupted Y.Map data (T-08-01, T-08-02)"

patterns-established:
  - "absoluteToRelative/relativeToAbsolute: canonical pattern for annotation position anchoring in collab context"
  - "yjsAnnotationToCodeMirror returns null on any decode failure (position decode, JSON parse) — callers filter nulls"

requirements-completed: [SYNC-05]

# Metrics
duration: 10min
completed: 2026-04-18
---

# Phase 08 Plan 01: Annotation Sync Foundation Summary

**YjsAnnotation type, RelativePosition utilities, and bidirectional CM<->Yjs annotation converters with Zod validation and try-catch JSON safety**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-04-18T14:40:00Z
- **Completed:** 2026-04-18T14:50:59Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments

- Defined `YjsAnnotation` interface for all three annotation types (comment, suggestion, revision) stored in Y.Map with encoded RelativePositions
- Extended `CollabSession` with `ymap: Y.Map<YjsAnnotation>` for annotation sync
- Implemented `absoluteToRelative` / `relativeToAbsolute` utilities that survive concurrent text edits via Yjs RelativePosition anchoring
- Implemented `codeMirrorToYjsAnnotation` / `yjsAnnotationToCodeMirror` converters with full null-safety for all three annotation types
- Applied threat mitigations T-08-01 (Zod schema validation) and T-08-02 (JSON.parse in try-catch) from the plan's threat model
- 33 tests across 3 test files covering round-trips, edge cases, schema validation, and error handling

## Task Commits

Each task was committed atomically:

1. **Task 1: Add YjsAnnotation type to types.ts** - `f198e33` (feat)
2. **Task 2: Create relativePosition.ts utilities with tests** - `d0e2845` (feat)
3. **Task 3: Create annotationSchema.ts with bidirectional converters** - `b451f1a` (feat)

_Note: TDD tasks — tests written before implementation in each task._

## Files Created/Modified

- `src/lib/collab/types.ts` - Added `YjsAnnotation` interface; extended `CollabSession` with `ymap` field
- `src/lib/collab/types.test.ts` - Smoke tests for type shapes
- `src/lib/collab/relativePosition.ts` - `absoluteToRelative` / `relativeToAbsolute` utilities
- `src/lib/collab/relativePosition.test.ts` - 10 tests for position tracking through concurrent edits
- `src/lib/collab/annotationSchema.ts` - Bidirectional converters, Zod schema, `AnnotationIdMap`, `generateAnnotationId`
- `src/lib/collab/annotationSchema.test.ts` - 18 tests covering round-trips, validation, error handling

## Decisions Made

- JSON-serialize thread/versions/replacements in Y.Map rather than use nested Y.Array/Y.Map, to avoid Yjs UndoManager bug #642 (per plan)
- Use `clientId-timestamp-random` string IDs for Yjs annotations to prevent collisions between concurrent clients
- Wrap `Y.decodeRelativePosition` in try-catch (in addition to JSON.parse) — corrupted position bytes in Y.Map should return null rather than throw

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed test using `EditorSelection.cursor()` instead of `EditorSelection.single()`**
- **Found during:** Task 2 (relativePosition.test.ts)
- **Issue:** `EditorSelection.cursor(n)` returns `SelectionRange`, not `EditorSelection`. Accessing `.main.from` on a `SelectionRange` throws "Cannot read properties of undefined". The plan's test template used this incorrectly.
- **Fix:** Changed cursor tests to use `EditorSelection.single(n, n)` which returns a proper `EditorSelection`
- **Files modified:** `src/lib/collab/relativePosition.test.ts`
- **Verification:** Tests pass
- **Committed in:** `d0e2845` (Task 2 commit)

**2. [Rule 1 - Bug] Fixed test expectation for RelativePosition at document end**
- **Found during:** Task 2 (relativePosition.test.ts)
- **Issue:** Test expected position 5 (end of "hello") to stay at 5 after inserting " world" at index 5, but Yjs tracks end-of-sequence positions forward — position 5 becomes 11
- **Fix:** Rewrote test to select from the middle of the document (indices 1-3) and insert after, verifying the anchor does not shift when insertion is after the selection
- **Files modified:** `src/lib/collab/relativePosition.test.ts`
- **Verification:** Tests pass, documents actual Yjs RelativePosition behavior
- **Committed in:** `d0e2845` (Task 2 commit)

**3. [Rule 2 - Missing Critical] Added try-catch around position decode in yjsAnnotationToCodeMirror**
- **Found during:** Task 3 (annotationSchema.test.ts)
- **Issue:** T-08-02 threat mitigation requires handling corrupted data from Y.Map. The plan wrapped JSON.parse but not the Yjs position decode call, which throws on empty/corrupted Uint8Array input
- **Fix:** Wrapped `relativeToAbsolute` call in try-catch that returns null on decode failure
- **Files modified:** `src/lib/collab/annotationSchema.ts`
- **Verification:** Test "returns null for malformed JSON in thread" now passes with corrupted position bytes
- **Committed in:** `b451f1a` (Task 3 commit)

**4. [Rule 1 - Bug] Fixed TypeScript null-narrowing in annotationSchema test**
- **Found during:** Task 3 (bun run check)
- **Issue:** `if (restored!._type === "suggestion")` doesn't narrow `restored` from `GenericAnnotation | null` — TypeScript still reports "possibly null" inside the block
- **Fix:** Changed to `if (restored !== null && restored._type === "suggestion")` for proper narrowing
- **Files modified:** `src/lib/collab/annotationSchema.test.ts`
- **Verification:** `bun run check` shows no errors for new collab files
- **Committed in:** `b451f1a` (Task 3 commit)

---

**Total deviations:** 4 auto-fixed (2 Rule 1 bugs in tests, 1 Rule 2 missing critical safety, 1 Rule 1 type narrowing)
**Impact on plan:** All fixes were necessary for correctness and security. No scope creep.

## Issues Encountered

None beyond the auto-fixed deviations above.

## Known Stubs

None - all converters are fully implemented with no placeholder data.

## Threat Flags

None - no new network endpoints, auth paths, or schema changes beyond those already in the plan's threat model.

## Next Phase Readiness

- `YjsAnnotation`, `RelativePosition` utilities, and `AnnotationIdMap` are ready for use by the sync plugin (plan 08-02+)
- `CollabSession.ymap` field is defined; consuming code in `index.ts` / `yjsProvider.ts` needs to initialize the Y.Map on session creation
- No blockers

## Self-Check

Files exist:
- `src/lib/collab/types.ts` - FOUND
- `src/lib/collab/relativePosition.ts` - FOUND
- `src/lib/collab/relativePosition.test.ts` - FOUND
- `src/lib/collab/annotationSchema.ts` - FOUND
- `src/lib/collab/annotationSchema.test.ts` - FOUND

Commits:
- `f198e33` - FOUND
- `d0e2845` - FOUND
- `b451f1a` - FOUND

## Self-Check: PASSED

---
*Phase: 08-annotation-sync*
*Completed: 2026-04-18*
