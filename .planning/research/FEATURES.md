# FEATURES Research — Collab Patterns for Annotation Sync

**Milestone:** Quillium v1.1 — Re-architect annotationField ↔ Y.Map sync layer
**Researched:** 2026-04-19
**Confidence:** HIGH on Yjs-adjacent patterns (y-prosemirror, y-codemirror, Tiptap, Automerge, Peritext, BlockSuite); MEDIUM on proprietary apps (Notion, Figma, Google Docs); LOW on Quillium-specific "revision versions" (no direct precedent found — this is genuinely novel).

> Note: This file supersedes the v1.0 `FEATURES.md` from the initial Omni research. Scope is narrowed to the v1.1 annotation-sync re-architecture only.

---

## Scenarios and Patterns

### 1. Position-Anchored Annotations on Remote-Modified Text

**The core problem (well-documented in the ecosystem):**
In y-prosemirror, when a remote peer edits the document, the integration emits a ProseMirror transaction that effectively *replaces the entire document*. This causes `DecorationSet.map` to return empty, annihilating locally-computed decorations even when the remote edit is elsewhere in the doc. (Sources: [y-prosemirror#49](https://github.com/yjs/y-prosemirror/issues/49), [y-prosemirror#113](https://github.com/yjs/y-prosemirror/issues/113))

This is *exactly* Quillium's "switch once to render" bug: CM positions remapped through a doc-replacing transaction lose their anchors, and the annotationField doesn't re-emit until the local user does something that triggers re-decoration.

#### Pattern A — **Y.RelativePosition anchoring** (canonical Yjs fix)
- **Source:** [Yjs docs — Relative Positions](https://docs.yjs.dev/api/relative-positions); [How to keep RelativePositions up to date](https://discuss.yjs.dev/t/how-to-keep-relativepositions-up-to-date/2653)
- **What:** Anchor annotation `from`/`to` to *CRDT items* (not integer offsets). `Y.createRelativePositionFromTypeIndex(ytext, index)` produces a stable anchor; `Y.createAbsolutePositionFromRelativePosition(relPos, ydoc)` resolves to the current integer index at render time. Yjs guarantees relative positions converge to the same absolute index on all clients once synced.
- **Quillium applicability:** HIGH. Each annotation's `selection.ranges[]` should persist as `{ relFrom, relTo }` in the Y.Map, resolved to CM integer offsets only inside a derived-decoration ViewPlugin. Eliminates the class of bugs where a remote insertion shifts text but the stored integer anchor goes stale.
- **Complexity:** MEDIUM. Requires a translator: `annotationsYMap ↔ annotationField`, resolving rel-pos on every sync event.
- **Risk:** Rel-pos only exists on a Y.Text. Sub-annotations living inside revision versions need each version to have its own Y.Text (see §3).

#### Pattern B — **Derive decorations from Yjs, not from CM StateField**
- **Source:** [ProseMirror+Yjs decorations tip](https://discuss.prosemirror.net/t/prosemirror-yjs-and-decorations-tip/4368); [BlockSuite CRDT-native data flow](https://block-suite.com/blog/crdt-native-data-flow.html); [BlockSuite document-centric](https://block-suite.com/blog/document-centric.html)
- **What:** Treat the Y.Doc as *single source of truth*. A ViewPlugin's `update()` hook rebuilds the DecorationSet from Yjs state on every update where `update.docChanged || yDocObservedChange`. The StateField becomes vestigial or purely derived.
- **Quillium applicability:** HIGH. This is the architectural answer to PROJECT.md's "single source of truth between CM annotationField and Y.Map" principle. Today Quillium has two sources (annotationField + Y.Map) that must be kept consistent; the fix is to make annotationField a *pure derivation* of Y.Map content + ytext rel-pos resolution.
- **Complexity:** HIGH. Mental-model shift; requires deleting bidirectional sync code.
- **Risk:** Undo/redo semantics must be preserved — Y.UndoManager must own it, not CM history.

#### Pattern C — **`observeDeep` + force re-render** (simpler but less pure)
- **Source:** [Tiptap Collaboration overview](https://tiptap.dev/docs/collaboration/getting-started/overview); [Hocuspocus collaborative editing](https://tiptap.dev/docs/hocuspocus/guides/collaborative-editing)
- **What:** Subscribe to `yAnnotationsMap.observeDeep(evt => rebuildDecorations())` and trigger a no-op CM transaction (or directly invalidate ViewPlugin) so `update()` fires and decorations re-render.
- **Quillium applicability:** MEDIUM — good for incremental migration if full "derive from Yjs" is too big a lift for v1.1.
- **Risk:** Easy to double-dispatch or miss events. Likely the first cheap fix to try.

---

### 2. Hierarchical / Tree-Structured Collaborative Data

#### Pattern A — **Y.Doc subdocuments (GUID-keyed lazy-loaded sub-CRDTs)**
- **Source:** [Yjs Subdocuments](https://docs.yjs.dev/api/subdocuments); [Liveblocks 1.6 subdocs](https://liveblocks.io/blog/liveblocks-1-6-introducing-yjs-subdocuments-support); [Hocuspocus multi-subdocuments](https://tiptap.dev/docs/hocuspocus/guides/multi-subdocuments); [Liveblocks subdocs guide](https://liveblocks.io/docs/guides/how-to-use-yjs-subdocuments)
- **What:** Each nested editable region is its own Y.Doc identified by GUID, embedded into a parent Y.Map. Parent only references the GUID; subdoc loads lazily. Each subdoc is a complete CRDT with its own Y.Text + Y.Map (for its own sub-annotations).
- **Quillium applicability:** VERY HIGH. Natural fit for revision versions:
  - Revision annotation = Y.Map entry keyed by revision id
  - Inside that map: `versions: Y.Array<Y.Doc>` — each version a subdoc
  - Each version subdoc contains: own `Y.Text` (the text) + own `Y.Map<annotations>` (sub-annotations) — recursively infinite
- **Complexity:** MEDIUM-HIGH. Subdoc lifecycle (load/destroy) must be wired to NestedEditorController mount/unmount.
- **Risk:** GC — unloaded subdocs still need sync through the relay; provider must be configured to sync subdocs.

#### Pattern B — **Notion block-tree with parent pointers + LWW text**
- **Source:** [Notion data model](https://www.notion.com/blog/data-model-behind-notion); [HN: Notion doesn't use OT/CRDT](https://news.ycombinator.com/item?id=37767739)
- **What:** Every block has `parent_id` + `content: [block_id…]`. Text inside a block is last-write-wins (NOT a CRDT). Tree operations are intention-preserving but not strictly convergent; text divergence is bounded because each block is small.
- **Quillium applicability:** LOW (anti-pattern for our goal). Quillium explicitly needs character-level merge inside a version. LWW per block would regress from v1.0.
- **Why noted:** Useful reminder that "hierarchy" and "character-level merge" can be orthogonal design decisions, but for us they must both hold.

#### Pattern C — **Figma tree of objects + LWW registers + central server**
- **Source:** [How Figma's multiplayer tech works](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/); [Figma code layers with Eg-walker](https://www.figma.com/blog/building-figmas-code-layers/)
- **What:** Server is central authority; properties use LWW registers; tree reparenting has special conflict rules. For the one place they needed real text CRDT (code layers), they switched to Eg-walker.
- **Quillium applicability:** LOW for the sync layer (we use Yjs). Useful as validation that "central authority for ordering + CRDT for text regions" is industry-standard.

---

### 3. Alternative-Version Structures ("versions inside a revision")

**Finding:** No editor in the ecosystem ships a first-class "range of text with multiple collaboratively-edited alternatives" primitive. This is genuinely novel to Quillium. Closest analogs:

#### Closest analog A — **Google Docs Suggestions Mode**
- **Source:** [Suggest edits in Google Docs](https://support.google.com/docs/answer/6033474); [Google Docs OT architecture](https://sderay.com/google-docs-architecture-real-time-collaboration/)
- **What:** A suggestion is a proposed delta (insert/delete) rendered with strikethrough/underline. Owner accepts/rejects. Doc has one canonical text; suggestions are pending ops layered on top.
- **Quillium difference:** Quillium revisions have *multiple* alternative versions, any of which can be "active" and switched freely, and each version is itself fully editable with its own nested annotations. Google's model is single-original + candidate-diff, not multi-alternative.
- **Transfer:** Concept of "pending ops stored separately from canonical text" informs our shape: store each version's text in its *own* Y.Text, plus an `activeVersionIndex` register.

#### Closest analog B — **Branch-per-version (Ink & Switch / Automerge)**
- **Source:** [Universal version control and rich text on Automerge](https://www.inkandswitch.com/newsletter/dispatch-004/); [Automerge 2.2: Rich Text](https://automerge.org/blog/rich-text/)
- **What:** Automerge treats each "branch" as a fork of the doc history; a viewer selects which branch to render. Peritext generalizes rich-text marks over this.
- **Quillium applicability:** MEDIUM. Each revision version ≈ a mini-branch. Full branch semantics would be overkill. Lighter interpretation: each version is a separate Y.Text (subdoc) inside a revision's Y.Map; `activeVersionIndex` is a Y.Map field. Version switching = swap which subdoc the nested editor binds to.
- **Complexity:** HIGH conceptually, MEDIUM to implement once subdocs are in place.

#### Closest analog C — **Scrivener snapshots / Craft versioning** (LOW confidence — training data only)
- **What:** Point-in-time immutable snapshots. Not collaborative.
- **Applicability:** NONE for collab. Snapshots are immutable; Quillium versions are each live-editable. Not a model to copy.

#### Recommended Quillium shape

```
Y.Doc (root)
├── Y.Text  "main document body"
└── Y.Map   "annotations"
    └── <id> ↦ Y.Map
        ├── _type: "revision"
        ├── from: Y.RelativePosition
        ├── to:   Y.RelativePosition
        ├── activeVersionIndex: number  (LWW — intentional)
        ├── thread: Y.Array<Y.Map>
        └── versions: Y.Array<Y.Doc>    ← subdoc per version
            └── each Y.Doc: own Y.Text + Y.Map(annotations), recursively
```

---

### 4. Character-Level Merge Inside a "Scope"

#### Pattern A — **One Y.Text per scope** (Yjs canonical)
- **Source:** [Yjs shared types](https://docs.yjs.dev/getting-started/working-with-shared-types); [A collaborative editor](https://docs.yjs.dev/getting-started/a-collaborative-editor)
- **What:** Each editable scope (document, cell, block, nested region) gets its own Y.Text. CRDT merge is automatic and local to that Y.Text; concurrent edits across scopes never interfere.
- **Quillium applicability:** HIGH. Each revision version = its own Y.Text (in its own subdoc). Character-level merge is automatic inside; scope isolation is automatic across.
- **Note:** This is the v1.0 pattern extended one level down — already validated in the text layer.

#### Pattern B — **Notion: one LWW text field per block** — rejected (§2 Pattern B).

#### Pattern C — **Peritext marks within one flat text CRDT**
- **Source:** [Peritext paper](https://www.inkandswitch.com/peritext/); [Automerge 2.2 rich text](https://automerge.org/blog/rich-text/); [Loro rich text](https://loro.dev/blog/loro-richtext)
- **What:** Single flat text CRDT with inline marks (bold/italic/comment) that have `expand` behavior (before/after/both/none) controlling whether marks grow when text is inserted at boundaries.
- **Quillium applicability:** MEDIUM — relevant for comment/suggestion anchoring, NOT the right primitive for revision versions (alternatives are structurally separate regions, not marks).
- **Transfer:** Configure annotation `expand`: comments and revisions likely `"none"` (anchor shouldn't grow on boundary typing). Product decision.

---

### 5. "Switch Once to Render" Bug Class

**Yes — this is a known, documented pattern in the Yjs ecosystem.**

#### Root cause (per [y-prosemirror#49](https://github.com/yjs/y-prosemirror/issues/49), [#113](https://github.com/yjs/y-prosemirror/issues/113))
Decorations computed from derived state are destroyed when a remote edit triggers a doc-replacing transaction, because the plugin state holding them maps through a transaction that looks like full-document replace. Decorations aren't recomputed until the *next* local transaction triggers the ViewPlugin's update path — the user has to do something (the "switch once").

#### Fix A — **Absolute positions in plugin state, recompute on every update**
- **Source:** [ProseMirror+Yjs decorations tip](https://discuss.prosemirror.net/t/prosemirror-yjs-and-decorations-tip/4368)
- **Quoted pattern:** "Use Yjs absolute positions in the plugin state, and create decorations from that."
- **What:** Plugin state stores rel-pos. In CodeMirror terms: ViewPlugin reads from Y.Map on every `update()`, resolves rel-pos to current absolute offsets, rebuilds DecorationSet fresh. No reliance on CM `RangeSet.map`.
- **Quillium applicability:** HIGH. Combine with §1 Pattern A + §1 Pattern B.

#### Fix B — **Force ViewPlugin invalidation on Yjs events**
- **What:** Subscribe to Y.Map/Y.Text observe events; on remote-origin updates, dispatch a CM transaction tagged as "remote sync" that forces `update()` to fire even when nothing CM-visible changed, so decorations rebuild.
- **Quillium applicability:** HIGH. Minimal kernel of the fix — at minimum, annotation Y.Map changes from the relay must produce a CM update that re-invokes the decoration plugin.
- **Risk:** Don't feed into undo history (`Transaction.addToHistory.of(false)`) — the `parentSyncEdit` annotation pattern already in NestedEditorController is the right shape.

#### Fix C — **Eager sync provider hook** (Tiptap/Hocuspocus)
- **Source:** [Hocuspocus collaborative editing](https://tiptap.dev/docs/hocuspocus/guides/collaborative-editing); [Hocuspocus overview](https://tiptap.dev/docs/hocuspocus/getting-started/overview)
- **What:** Provider `onSynced` fires when initial sync completes; client dispatches a re-render before the user can interact.
- **Quillium applicability:** HIGH for "joiner connect decorations missing." On `provider.on('sync', …)`, translate Y.Map to annotationField and dispatch.

---

## Pattern Categorization

### Table Stakes (MUST adopt for v1.1)

| # | Pattern | Source | Quillium use |
|---|---------|--------|--------------|
| T1 | **Y.RelativePosition for annotation anchors** | [Yjs docs](https://docs.yjs.dev/api/relative-positions) | Store each annotation's `from`/`to` as rel-pos in the Y.Map; resolve to CM offsets only at render time. Fixes "collapsed ranges" and remote-rebuild position rot. |
| T2 | **Derive decorations from Yjs on every update** | [ProseMirror discuss](https://discuss.prosemirror.net/t/prosemirror-yjs-and-decorations-tip/4368), [y-prosemirror#49](https://github.com/yjs/y-prosemirror/issues/49) | ViewPlugin rebuilds DecorationSet from Y.Map state each update. Eliminates "switch once to render." |
| T3 | **Yjs subdoc per revision version** | [Yjs subdocs](https://docs.yjs.dev/api/subdocuments), [Liveblocks 1.6](https://liveblocks.io/blog/liveblocks-1-6-introducing-yjs-subdocuments-support) | Each version = own Y.Doc (Y.Text + Y.Map). Nested revisions recurse. Solves infinite nesting + char-level merge inside versions + scope isolation, all at once. |
| T4 | **Single source of truth = Y.Doc; annotationField is derived** | [BlockSuite](https://block-suite.com/blog/crdt-native-data-flow.html) | Matches PROJECT.md principle. Deletes bidirectional sync code. |
| T5 | **Provider `onSynced` triggers annotationField rebuild** | [Hocuspocus](https://tiptap.dev/docs/hocuspocus/guides/collaborative-editing) | Fixes joiner-connect "no decorations until I type." |
| T6 | **Y.UndoManager scope covers Y.Map, not just Y.Text** | [Yjs UndoManager](https://docs.yjs.dev/api/undo-manager) | Fixes "Cmd-z reverts past connect state" — tracker scopes local-origin changes only, covering all relevant Y types. |

### Differentiators (consider adopting — novel but defensible)

| # | Pattern | Source | Why it'd differentiate |
|---|---------|--------|------------------------|
| D1 | **Multi-version revisions modeled as `Y.Array<Y.Doc>` subdocs** | Extension of Yjs subdocs | No editor ships this; fills the gap between Google Docs suggestions (single alternative) and VCS branching (heavyweight). Uniquely Quillium. |
| D2 | **Per-annotation `expand` behavior config (Peritext-style)** | [Peritext](https://www.inkandswitch.com/peritext/), [Automerge marks](https://automerge.org/docs/reference/documents/rich-text/) | Lets comments / suggestions / revisions have different anchor semantics. Ahead of Tiptap Comments which use fixed semantics. |
| D3 | **Thread append as `Y.Array` (not LWW overwrite)** | [Yjs shared types](https://docs.yjs.dev/getting-started/working-with-shared-types) | Concurrent thread replies never collide or drop. Current annotationField-as-blob pattern is effectively LWW on the whole thread and is the root cause of "concurrent thread append loses messages." |

### Anti-Features (AVOID — wrong for Quillium)

| # | Anti-pattern | Who does this | Why wrong for us |
|---|-------------|---------------|------------------|
| A1 | **LWW-per-block text (no CRDT)** | [Notion](https://www.notion.com/blog/data-model-behind-notion) | Works because Notion blocks are small paragraphs with a central server. Quillium revision versions can be long passages; LWW would drop concurrent edits — regression from v1.0. |
| A2 | **Rewrite CM into ProseMirror** | Tiptap, BlockSuite, Lexical paths | Explicitly ruled out. Also: y-prosemirror has *more* decoration bugs than y-codemirror (see issue #49, #113); we'd inherit the problem, not solve it. |
| A3 | **Snapshot-based versions (Scrivener model)** | Scrivener | Versions become immutable — conflicts with core Quillium UX. |
| A4 | **Serializing full annotation blob into Y.Map value** (current Quillium pattern) | Quillium v1.0 | This IS the v1.0 bug. Blob-level LWW means any two peers mutating the same annotation (even different fields: thread append + activeVersionIndex switch) clobber each other. Must be broken into field-level Y shared types. |
| A5 | **Separate annotation-only broadcast channel parallel to Y.Doc** | Firepad-era designs | Reintroduces dual source of truth — the exact root cause PROJECT.md names. |
| A6 | **Eg-walker / full rebase algorithm** | [Figma code layers](https://www.figma.com/blog/building-figmas-code-layers/) | Powerful but only justified for branch-merge workflows. Overkill; Yjs already handles document text well. |
| A7 | **Central-server OT (Google Docs style)** | [Google Docs](https://sderay.com/google-docs-architecture-real-time-collaboration/) | Would require scrapping Yjs. v1.0 is Yjs; the text layer is not in scope for v1.1 re-architecture. |

---

## Cross-Cutting Observations

1. **The problem you're solving has an industry name.** "Decorations disappear after remote peer edits" is [y-prosemirror#49](https://github.com/yjs/y-prosemirror/issues/49), open since 2020. The consensus fix is T1+T2: anchor via Y.RelativePosition, derive decorations from Yjs state, rebuild on every update. Quillium's "switch once to render" is the same bug, one editor binding away.

2. **The architectural principle in PROJECT.md is industry-validated.** "Single source of truth between annotationField and Y.Map" is precisely the [BlockSuite document-centric pattern](https://block-suite.com/blog/crdt-native-data-flow.html). The direction of truth must be **Y.Doc → annotationField** (one-way derivation), never both ways. Every current Quillium sync bug is a symptom of bidirectional sync.

3. **Subdocuments solve three problems at once.** Version isolation, infinite nesting, and character-level merge inside a scope all collapse into one pattern: "each nested editable region is a Y.Doc with its own Y.Text + Y.Map." `NestedEditorController` already has the right lifecycle shape (create/destroy/syncFromParent) — rewiring it to bind to a subdoc instead of a `VersionState` JSON blob is the principal refactor. The diff-based `syncFromParent` becomes unnecessary: Y.Text binding is inherently character-level.

4. **Threads must become Y.Array, not part of the annotation blob.** Concurrent thread append without loss (explicit v1.1 target) is not solvable while `thread` is serialized inside a Y.Map-stored blob. Every field that can be concurrently mutated must become its own Y shared type: `thread: Y.Array`, `replacements: Y.Array`, `label: Y.Text`.

5. **`activeVersionIndex` is the one place LWW is fine.** A single scalar with product meaning "who clicked last wins" — exactly LWW semantics. Y.Map's setter provides it for free. Don't over-engineer this one.

6. **Research gaps acknowledged.**
   - No direct precedent for "multi-version ranges with independent nested editors" in any shipping collaborative editor. D1 is our design, grounded in Yjs subdocs but not copied from a product.
   - Google Docs Suggestions is the closest user-facing concept, but its implementation (OT + central server) doesn't transfer.
   - Confidence on Notion internals is MEDIUM — based on HN comments from Notion engineers, not official docs.
