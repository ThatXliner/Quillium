# Annotations

Comments, suggestions, and revisions attach to ranges of prose. CodeMirror
transactions update their text, ranges, and semantic state together.

Architecture decision: [stable revision-version identities](./adr/0005-stable-revision-version-identities.md).

## Where the implementation lives

Select a passage and create a revision: the field stores its range and alternate
versions, the card renders them, and the nested editor edits the active one.
Read [state management](state-management.md) first if the boundary between
CodeMirror state and Svelte cards is unfamiliar.

| Layer | Implementation |
|---|---|
| Types, schemas, factories, version helpers | [Shared models.ts](../packages/share/src/core/models.ts) |
| StateField, effects, commands, undo inversion | [Shared annotationField.ts](../packages/share/src/core/annotationField.ts) |
| Range and active-annotation queries | [Shared utils.ts](../packages/share/src/core/utils.ts) |
| Desktop view plugins, keymaps, creation commands | [Desktop index.ts](../packages/desktop/src/lib/editor/plugins/annotations/index.ts) |
| Shared card presentation | [share/src/cards](../packages/share/src/cards/) |
| Editable cards and nested-editor integration | [Desktop adapters](../packages/desktop/src/lib/editor/plugins/annotations/) |

The desktop `models.ts` and `annotationField.ts` are re-export shims. References
to those module names below mean the shared implementations, which import
CodeMirror state types and run in both desktop and read-only hosts.

## Data model

[models.ts](../packages/share/src/core/models.ts) defines the annotation union,
persisted schemas, and factories. Each annotation has an editor-local numeric ID,
selection, thread, and explicit `pending` or `active` status. Revisions add an
ordered `versions` array and an `activeVersionId`.

Use `isAnnotationOfType(annotation, "revision")` rather than comparing `_type`
directly. Read `annotation.status` for lifecycle state; content length does not
define it. Deserialization heals legacy snapshots without status. A first thread
message or revision-version mutation activates a pending annotation.

Use `activeVersion()` or `activeVersionIndex()` to resolve the active version.
`activeVersionId` is a stable string ID, never an array index.

### AI generation metadata

AI-created annotations carry an optional `aiProvenance` record with the request
ID, editorial task, provider, model, creation time, and optional reader persona.
AI-generated revision alternatives copy the same record onto their
`VersionState`, alongside the version's `"ai"` authorship classification. A human
edit changes that classification to `"mixed"` but retains the originating request
record.

The field is part of the shared raw and clipboard schemas, so it survives event
replay, snapshots, copy/paste, collaboration, and read-only shares. Human-created
and legacy annotations omit it. The request metadata supports attribution and
auditing; it does not bypass the normal annotation commands, undo history, or
persistence path. See [AI Features and Request Pipeline](./ai-sidebar.md) and
[Authorship Provenance](./provenance.md).

### Adding a new annotation type

The union is enumerated in several places. A new type needs all of these paths:

1. Add its type and persisted shape to `GenericAnnotation` and `RawAnnotationSchema`.
2. Add its clipboard shape to `SerializedAnnotationSchema`. The schema-length and
   type-equality assertions catch missing variants. Clipboard rebuilding copies
   public fields but starts a new private `_historyId` lineage.
3. Add its effects, inversion, range mapping, and persistence codecs. If the type
   mirrors prose like a revision, include it in the field's document-sync phase.
4. Add creation commands, decorations, and its card presentation.

Verify create, edit, undo, redo, copy, paste, and reopen behavior. A type that is
removed by cut but omitted from serialization loses data on paste. A field reducer
alone does not establish undo or persistence support.

### VersionState

A version stores its ID, prose, optional label, and provenance. It may also carry
a nested editor's serialized fields. `VersionStateSchema` preserves these extra
keys. The field's document-sync phase refreshes the active version's prose from
the parent range after edits.

### Version identity

Each version carries a stable string `id`; a revision references its active
version by `activeVersionId`. Version-targeting effects and builders take that ID.
An index can point to different text after a version is inserted, deleted, or
reordered. Stable IDs keep references attached to the intended version.

`makeVersion()` assigns an ID unless one is provided. IDs use a session counter
and random suffix; they persist with the version and only need uniqueness within
the revision. Clipboard rebuilding creates new version IDs and remaps the active
ID. Callers use `versionById()`, `versionIndexById()`, `activeVersion()`, and
`activeVersionIndex()` rather than reproducing lookup rules.

`normalizeRevision()` accepts legacy index-based revisions at deserialization and
collaboration boundaries. It assigns missing IDs, selects the clamped legacy
index, and leaves normalized data unchanged. The relay migrates legacy rooms to
the ID-based Yjs schema; desktop readers still tolerate the old shape.

### Version groups (linking versions across revisions)

A version group links one version from each of several different revisions.
Activating a member switches every member to its linked version in the same
transaction. The group map lives in `versionGroupField`, separate from
`annotationField`.

Each member identifies a revision and a version ID. The
[version-group field](../packages/share/src/core/versionGroupField.ts) owns its
schema, effects, and builders.

Reducer invariants:

- Adding a member detaches it from any prior group.
- `canAddMemberToGroup` rejects a second
  version from the same revision because the cascade target would be ambiguous.
- When a revision is removed or a version deleted
  (observed via `removeAnnotation` / `_deleteVersionFromRevision` effects in the
  same transaction), matching members are pruned; a group that drops below two
  members dissolves. Undo emits granular create/delete/rename/member effects,
  including each removed member's original index, so it restores a dissolved
  group without replacing unrelated groups added by a later untracked update.
  `_restoreVersionGroups` remains the authoritative whole-map projection for
  collaboration, recovery fallbacks, and backward decoding of older history.

`setActiveRevisionVersion` resolves the target version's group
partners (`groupSwitchTargets` → `groupPartnersOf`) and bundles every partner's
`_updateActiveRevisionVersion` effect + doc replacement into the *same*
transaction. So a group switch is atomic and reverts in one undo, and every
switch entry point (pill, `Ctrl-[` / `Ctrl-]`, modal) uses this cascade. The
`annotationField ↔ versionGroupField` import pair is a safe ESM cycle (all
cross-references are inside function bodies).

Public builders: `createVersionGroup(label, members)` → `{ spec, groupId }`,
`addVersionToGroup`, `removeVersionFromGroup`, `deleteVersionGroup`,
`renameVersionGroup`. Both group switches and the root editor's group structure
sync through Yjs collaboration.

The desktop manager currently supports root-level revisions only. Nested
revision cards keep the link affordance for discoverability, but clicking it
shows a request toast instead of reading or mutating the root version-group map.

## The annotationField StateField

`annotationField` is the single source of truth for all annotation data. Its `update()` function returns the existing field unchanged for cursor-only or
unrelated transactions. Document changes and annotation mutation effects run
through three phases:

### Phase 1: remap positions

```typescript
remapAnnotationSelections(annotations, tr)
```

Maps every annotation's `selection` through `tr.changes` so positions stay accurate as text is inserted or deleted.

- Comments and suggestions are **removed** if their range collapses to zero width
- Revisions **temporarily survive** empty ranges via `allowEmpty: true` in `cleanRangesOf()`, keeping them alive for `collapsedRevisionResolver` to handle

### Phase 2: apply effects

Processes each `StateEffect` in the transaction:

| Effect | Action |
|--------|--------|
| `addAnnotation` | Insert into map |
| `removeAnnotation` | Delete from map |
| `updateThread` | Replace `annotation.thread` |
| `_addVersionToRevision` | Splice new version into `versions`; make it active |
| `_deleteVersionFromRevision` | Remove version by id; recompute `activeVersionId` |
| `_updateActiveRevisionVersion` | Update `activeVersionId` (target by id), rebuild selection |
| `_updateRevisionVersionState` | Replace version blob (by id) with nested editor state |
| `addSuggestion` | Text search + add suggestion |
| `_applySuggestion` | Delete suggestion from map |

Effects touching a specific revision ID are tracked in `revisionsWithExplicitEffect` (used in Phase 3).

### Phase 3: push document text

```typescript
if (tr.docChanged) {
    annotations = pushDocToVersionState(annotations, tr, revisionsWithExplicitEffect);
}
```

For each revision **not** in `revisionsWithExplicitEffect`, reads the document slice under the revision's range and writes it into the active version's `doc` (the slot at `activeVersionIndex(rev)`).

Phase 3 only runs when `tr.docChanged` and skips revisions with explicit effects this transaction.

## Undo and redo

`invertedAnnotationFieldEffects` is registered through `invertedEffects.of(...)`.
It returns the semantic effects that accompany the inverse text transaction.

| Original effect | Inverted effect |
|-----------------|-----------------|
| `addAnnotation` | ID-based removal, or `removeAnnotation` for effect-only adds |
| `removeAnnotation` | exact `_restoreAnnotation` snapshot when text also changed |
| `updateThread` | `updateThread` with old thread |
| `_addVersionToRevision` | `_deleteVersionFromRevision` by the added version's id |
| `_deleteVersionFromRevision` | `_addVersionToRevision` with old version, at its old slot |
| `_updateActiveRevisionVersion` | `_updateActiveRevisionVersion` with old `activeVersionId` |
| `_updateRevisionVersionState` | three-way semantic version-state delta, preserving later bookkeeping |
| `_applySuggestion` | exact `_restoreAnnotation` snapshot |
| *(implicit)* lossy range/version remap | exact `_restoreAnnotation` snapshot |

`_restoreAnnotation` carries both the original semantic snapshot and the history
event's inverse `ChangeSet`. Its `map` function rebases that snapshot through
later `addToHistory: false` document changes, while a transaction extender places
an `isolateHistory("after")` boundary on edits whose positional inverse must not
be joined to the next change. Revision-system builders use full isolation at
their public action boundary. Consecutive nested typing uses version-state
inverses rather than exact snapshots, so grouped events remain safe to rebase.
Moving between nested revision targets and surrounding document text starts a
new undo step; empty/non-empty transitions are fully isolated. The persisted
`annotationHistoryScope` field preserves these grouping boundaries across
snapshots and replay. Older saved histories with incompatible restore transforms
are discarded on load, while the document and annotations remain intact.

Every live annotation also has a private persisted
`_historyId` lineage token. Numeric display IDs may be reused after removal, so
the token prevents an older undo entry from modifying a different annotation
that later received the same ID, type, and range. Legacy annotations receive a
token when their saved field is loaded.

## Public API

Effects prefixed with `_` are internal. External code uses transaction builders:

```typescript
// Each builder returns a TransactionSpec for the caller to dispatch.
// toId and versionId are stable VersionState IDs, not indexes.
setActiveRevisionVersion(state, annotationId, toId)
createNewRevision(state, annotationId)
deleteRevisionVersion(state, annotationId, versionId)
updateRevisionVersionState(state, annotationId, versionId, newVersionState)
updateRevisionVersionLabel(state, annotationId, versionId, label)
branchSuggestion(state, annotationId)
applySuggestion(state, annotationId, replacementIndex)
```

Positional callers (a pill click, `Ctrl-[` / `Ctrl-]`) translate the target index
to its id first, e.g. `setActiveRevisionVersion(state, id, rev.versions[next].id)`.

## Transaction annotations

### `revisionInternalEdit`

Set to `true` on transactions dispatched by revision API builders. Marks the transaction as revision-system-driven (not user typing).

Consumers:

1. `collapsedRevisionResolver` skips auto-removal because the collapse is intentional.
2. `boundaryInsertNudge` skips hints for programmatic insertions.
3. `invertedAnnotationFieldEffects` skips implicit remapping detection.

### `_revisionCleanup`

`collapsedRevisionResolver` tags cleanup with `_revisionCleanup.of(true)` and
`addToHistory.of(false)`. The inversion function returns no effects for this
transaction, so cleanup does not add a collapsed revision to a later undo entry.

## Follow an editing action

A version-pill click resolves the displayed slot to a version ID, then dispatches
`setActiveRevisionVersion()`. That transaction replaces the revision's prose,
updates its active ID, and includes any linked version-group switches. The field
skips automatic document sync for explicitly updated revisions. The UI bridge
then publishes the resulting state to the cards.

Comment and revision creation follow the same command-to-field-to-store path.
Read [state management](state-management.md) for that boundary and
[nested editors](nested-editors.md) for edits inside a revision.
