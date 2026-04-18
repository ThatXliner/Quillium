# Phase 8: Annotation Sync - Context

**Gathered:** 2026-04-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Comments and revisions sync between collaborators via Yjs shared types. Comment annotations sync via Yjs Y.Map, revision annotations sync via Yjs Y.Map, position tracking uses Yjs RelativePosition (no drift), annotation operations integrate with per-user undo.

</domain>

<decisions>
## Implementation Decisions

### Undo Integration
- **D-80:** Delete entire thread on undo — when User A undoes creating a comment that User B replied to, the entire thread is deleted (comment + all replies). Simple mental model: "undo my action" removes what I created, replies are collateral.
- **D-81:** Suggestion acceptance is undoable — accepting a suggestion is like any edit, reversible via undo. The suggestion reappears and original text is restored.
- **D-82:** Version switches are undoable — switching active revision version is tracked in undo stack. Matches current local behavior.
- **D-83:** Single unified undo stack — one UndoManager per user covering both text and annotations, interleaved by time. No separate stacks for text vs annotations.

### Preserved Behaviors (from prior phases)
- **D-72:** Custom Yjs-CodeMirror binding (Phase 7.5)
- **D-74:** Client-side UndoManager per user (Phase 7.5)
- **D-57:** Live Room mode — session ends when owner leaves (Phase 6)
- **D-54:** Dual-write local SQLite persistence continues during collab (Phase 6)

### Claude's Discretion
- Y.Map schema design for annotations (nested Y.Arrays for threads/versions vs flat structure)
- Position tracking implementation (RelativePosition for ranges — start+end or single anchor)
- Concurrent edit merge strategy for threads (Yjs Y.Array natural merge behavior)
- How suggestion/revision state syncs (accepted state, active version index)
- Annotation ID generation in collaborative context (avoid collisions)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/ROADMAP.md` — Phase 8 success criteria (4 items)
- `.planning/REQUIREMENTS.md` — SYNC-05 (annotation sync)

### Prior Phase Decisions
- `.planning/phases/07.5-yjs-migration/07.5-CONTEXT.md` — D-72 (custom binding), D-74 (UndoManager), Yjs architecture
- `.planning/phases/06-client-collab/06-CONTEXT.md` — D-54 (dual-write), D-57 (Live Room mode)

### Existing Annotation Code
- `src/lib/editor/plugins/annotations/models.ts` — Annotation type definitions, Zod schemas
- `src/lib/editor/plugins/annotations/annotationField.ts` — StateField, effects, undo inversion
- `src/lib/editor/plugins/annotations/utils.ts` — Range mapping helpers
- `ARCHITECTURE.md` § The Annotation System — Data model, three-phase update, undo/redo

### Yjs Documentation
- Yjs docs: https://docs.yjs.dev/ — Y.Map, Y.Array, RelativePosition
- UndoManager: https://docs.yjs.dev/api/undo-manager — trackedOrigins, scope

</canonical_refs>

<code_context>
## Existing Code Insights

### Annotation Data Model
- `Annotations` type: `{ [id: number]: GenericAnnotation }`
- Three types: `comment`, `suggestion`, `revision` (discriminated by `_type`)
- Each has: `id`, `selection` (EditorSelection), `thread` (ThreadMessage[])
- Revisions have: `versions[]` (VersionState[]), `activeVersionIndex`
- Suggestions have: `replacements[]` (SuggestionReplacement[])

### Serialization
- Zod schemas in `models.ts` define JSON shape
- `toJSON`/`fromJSON` on annotationField for persistence
- EditorSelection serializes to `{ ranges: [{anchor, head}], main }`

### Current Undo System
- `invertedAnnotationFieldEffects` handles local undo inversion
- Each StateEffect has a clear inverse (add ↔ remove, etc.)
- Unified undo stack for text + annotations (current behavior to preserve)

### Integration Points
- Yjs binding from Phase 7.5 will need annotation sync layer
- Y.Map for annotations collection, potentially nested Y.Arrays for threads/versions
- RelativePosition for anchoring positions that survive concurrent edits

</code_context>

<specifics>
## Specific Ideas

- Thread deletion on undo is intentional simplicity — avoids orphaned replies UI complexity
- Unified undo stack matches what users already experience in local editing
- Position tracking via RelativePosition is the standard Yjs pattern for this problem

</specifics>

<deferred>
## Deferred Ideas

- **Offline queue with annotation sync** — Phase 9 (Yjs persistence handles this naturally)
- **Annotation conflict UI** — not needed if Yjs merge is seamless
- **Per-annotation permissions** — v2 (who can edit/delete which annotations)

</deferred>

---

*Phase: 08-annotation-sync*
*Context gathered: 2026-04-17*
