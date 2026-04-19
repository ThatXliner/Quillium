---
quick_id: "260419"
status: complete
---

# Quick Task Summary: Initial Annotation Sync

## Problem

When a joiner connected to a collab room with existing annotations, they didn't see them. The `createAnnotationSyncPlugin` only set up `observeDeep` for future changes but never pulled existing annotations from the Y.Map.

## Solution

Added `_syncInitialFromYjs()` method to the plugin constructor that:
1. Iterates over existing `scopeAnnotations` entries
2. Converts each via `yjsAnnotationToCodeMirror()`
3. Registers in idMap and dispatches `addAnnotation` effects
4. Uses `queueMicrotask` to defer dispatch (standard CM pattern — can't dispatch during construction or update cycles, see codemirror/dev#1341)

## Changes

- `src/lib/collab/yjsAnnotations.ts`: Added `_syncInitialFromYjs()` method
- `src/lib/collab/yjsAnnotations.test.ts`: Added test "syncs existing Y.Map annotations on plugin mount"

## Verification

- All 176 collab tests pass
- New test confirms pre-existing annotations are loaded on mount
