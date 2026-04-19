# STACK Research — Annotation Sync Re-architecture

**Milestone:** Quillium v1.1 — pre-v2 annotation sync fix
**Researched:** 2026-04-19
**Scope:** ONLY the new annotation sync mechanism. Existing Yjs/CM/Tauri/SvelteKit stack is fixed.
**Overall Confidence:** HIGH (all library claims verified against npm + GitHub + Context7 2026-04)

---

## Current Stack (preserve — do not re-research)

These work and are the foundation the new sync layer must sit on. **No replacement needed.**

| Component | Version | Why keep |
|-----------|---------|----------|
| `yjs` | ^13.6.30 (latest: 13.6.30, published 2026-03-14) | CRDT core. Stable v13 line. v14 is unstable; don't migrate. |
| `y-protocols` | ^1.0.7 | Awareness protocol for cursors. Works. |
| `y-websocket` | ^3.0.0 | Relay provider. Works with Fly.io relay. |
| `@codemirror/view` ^6.41.0, `@codemirror/state` ^6.6.0, `@codemirror/commands` ^6.10.3 | current | Editor foundation. |
| `createYjsBinding` (`src/lib/collab/yjsBinding.ts`) | custom, ~110 LOC | Y.Text ↔ CM doc binding. Handles origin tagging and delta mapping correctly. Pattern is correct; **preserve this as the template** for the new annotation binding. |
| `annotationField` StateField (`src/lib/editor/plugins/annotations/annotationField.ts`) | custom | Single CM-side source of truth for annotation state + undo inversion. **Must remain** — the re-architecture makes Yjs a dumb mirror of it, not a second source of truth. |
| `zod` ^4.3.6 | current | Schema validation for `RawAnnotationsSchema` persistence — reuse for wire-format validation if needed. |
| `@supabase/supabase-js`, Fly.io relay, Tauri 2, SvelteKit 2, Svelte 5, Vitest 4, Playwright 1.59, Biome 1.9 | all current | Already validated in v1.0 STACK. Out of scope. |

---

## Investigation Findings

### 1. y-codemirror.next — is it maintained enough to adopt for annotation sync?

**Verdict: NO for annotation sync. Stable release does not solve our problem.**

**Evidence:**
- npm `latest` tag: `0.3.5`, published **2024-06-18** — unchanged for ~22 months (verified via `npm view y-codemirror.next time`).
- GitHub repo (`yjs/y-codemirror.next`) is NOT archived; `pushed_at` = 2026-04-18, 200 stars, 10 open issues. Recent commits are on `main` branch only.
- `main` branch README (verified 2026-04-19) explicitly states: *"The `main` branch of this repository is the development branch for the unstable `@y/codemirror` release, which adds support for Yjs v14 (`@y/y`). Most users should continue to use the stable `y-codemirror.next` package with Yjs v13 for now."*
- The stable v0.3.5 `y-sync.js` source itself warns: *"It cannot be guaranteed that absolute index positions can be synced up between peers. This might lead to undesired behavior when implementing features that require that all peers see the same marked range (e.g. a comment plugin)."*

**What stable y-codemirror.next actually does** (v0.3.5, verified from source):
- Y.Text ↔ CM doc text bidirectional sync (what our `createYjsBinding.ts` already does)
- Awareness-based remote cursor/selection rendering
- Shared `Y.UndoManager`
- Exposes `YSyncConfig.getYPos(pos)` and `fromYPos(ypos)` for relative-position conversion

**What it does NOT do:**
- Sync annotations, decorations, marks, comments, or any user-defined StateField. This is the gap we're filling.

**What this means for v1.1:**
- Our existing custom `yjsBinding.ts` is effectively a re-implementation of 0.3.5's `y-sync.js` for Y.Text only. We could replace it with `y-codemirror.next` to reduce custom code — but that's an optional cleanup, not a win for annotation sync.
- For annotations, we must still write our own binding. y-codemirror.next gives us nothing there.
- **Revisit D-72:** the "unmaintained" claim was partially true (stable release is frozen) but the repo is active on the v14 line. Update D-72 language to: "stable v0.3.5 only binds Y.Text, not annotations; we need a custom annotation binding regardless."

**Confidence:** HIGH — source + README + npm timestamps all agree.

---

### 2. Helpers for observing nested Y types (@yjs/react, y-protocols, etc.)

**Verdict: None that help. Stay with `observeDeep` and path-based routing.**

**Evidence:**
- `@yjs/react` / `y-react` etc. are React-specific hooks for exposing Y types to component state. Not applicable (we're on Svelte 5) and they don't solve nested observation — they wrap `observe`/`observeDeep` and call `setState`.
- `y-protocols` (already installed ^1.0.7) is about network protocol messages (sync, awareness, auth), not observation.
- `y-utility` and similar packages offer single-type wrappers (e.g. `y-array` helpers); no path-aware dispatcher.
- Yjs core ships the only two primitives needed: `ytype.observe(cb)` (shallow) and `ytype.observeDeep(cb)` where each event's `ev.path: Array<string|number>` tells you exactly where it happened.

**What actually helps (current Yjs core, no new dep):**
- `ev.path` + `ev.target instanceof Y.Map|Y.Array|Y.Text` — this is the pattern our current `yjsAnnotations.ts` uses (lines 88–143). The pattern is fine; the bug is that we dispatch effects back into CM *and also* have `annotationField`'s `pushDocToVersionState` pulling text from the parent doc, creating the dual source of truth.
- For hierarchical tree-like trees (revision-inside-revision), `observeDeep` scales fine; Yjs emits one YEvent per changed parent container per transaction.

**Confidence:** HIGH (Context7 /yjs/docs + package search).

---

### 3. Alternative CRDTs — Automerge, Loro, y-sweet

**Verdict: DO NOT adopt. Would require a ground-up rewrite that breaks scope.**

| Library | Latest (2026-04) | Why ruled out |
|---------|------------------|---------------|
| `@automerge/automerge` | 3.2.5 (2026-04-13) | Strong ecosystem, JSON-shaped CRDT, Rust core. But: no drop-in CM binding; would replace Yjs wholesale, discarding working Y.Text/Y.UndoManager/awareness/relay; not in scope for v1.1. |
| `loro-crdt` | 1.11.0 (2026-04-12) | **Has** a first-class `LoroTree` with fractional indexing and movable hierarchical nodes (verified via Context7 `/loro-dev/loro` — supports `tree.mov`, `tree.children`, metadata LoroMap per node). Genuinely better-suited to our recursive revision tree than nested `Y.Map<Y.Map<Y.Map<…>>>`. But: requires rewriting Y.Text binding, relay protocol, UndoManager, awareness, cursor broadcast, persistence. ~4–6 weeks of work. Breaks v1.1 scope. |
| `y-sweet` | n/a as dep | A relay/server product (from Drift), not a CRDT. Not a client-side alternative. Relay already works on Fly.io; not replacing. |

**Note for future (v2+):** If we hit a wall with Y.Map-of-Y.Map hierarchy, Loro's `LoroTree` is the strongest candidate for a post-v1 migration. Log this as a future decision, not a v1.1 action.

**Confidence:** HIGH (npm metadata + Context7 Loro docs + Automerge docs).

---

### 4. Y.XmlFragment / Y.XmlElement for recursive revision structure

**Verdict: Worth evaluating for the "annotations anchored in revision version X" substructure, but NOT a free win. Lean toward keeping Y.Map for annotations; leaning toward Y.Text (unchanged) for version bodies.**

**Evidence (Context7 `/yjs/docs`):**
- `Y.XmlFragment` is a container holding an ordered sequence of `Y.XmlElement` and `Y.XmlText` children. Each `Y.XmlElement` has a `nodeName`, typed attributes (`setAttribute`/`getAttribute`), and nested children. Inherits from `Y.XmlFragment`.
- Attributes support shared types as values — you can put a `Y.Text` or `Y.Array` as an attribute value.
- `Y.XmlElement.toDOM()` produces DOM; useful for ProseMirror-style editors but we don't need that.

**Pros for our use case:**
- Native tree navigation (`firstChild`, `nextSibling`, `parent`) vs. our manual `Y.Map<Y.Map>` recursion.
- Ordered children — currently our `versions` uses `Y.Map<string(index), Y.Map>` keyed by stringified numeric index (see `annotationSchema.ts` lines 82–95), which **cannot safely concurrently insert a version at an arbitrary index**. A `Y.XmlFragment` of version elements would handle concurrent version insertion as a proper CRDT list.
- Attributes for discriminator (`_type`) and scalars (`activeVersionIndex`, `startPos`, `endPos`) — cleaner than Y.Map keys.

**Cons / risks:**
- Y.XmlText is an overlay on Y.Text with rich-text formatting semantics (attributes-on-ranges). For plain text bodies we'd want Y.Text, not Y.XmlText.
- Migrating the existing `YjsAnnotationNode = Y.Map<unknown>` schema to Y.XmlElement is a wire-format change. Per D-94 ("no legacy wire format"), we can do a clean break, but every sync test + relay snapshot has to be redone.
- `observeDeep` still works on Y.Xml types; our event-routing logic does not materially simplify.
- Y.UndoManager scoping: the UndoManager is already configured on the Y.Text and the annotations Y.Map (per v1.0 phases). Adding Y.XmlFragment into its tracked set is straightforward but needs to be explicit.

**Recommendation:**
- For v1.1: **keep Y.Map for the annotation node** (each annotation is `Y.Map { _type, startPos, endPos, thread, versions, ... }`) because the migration cost outweighs the ordering win at the top level (annotation keys are already UUIDs, insertion order doesn't matter).
- For `versions`: **change `Y.Map<string, Y.Map>` to `Y.Array<Y.Map>`**. This is a small, targeted fix. Y.Array is a proper CRDT list — concurrent `push`/`insert(i, …)` is defined. It replaces the current index-keyed Y.Map which has no concurrent-insert story. Cheaper than switching to Y.XmlFragment and solves the same ordering problem.
- `activeVersionIndex` stays as a simple number key in the annotation Y.Map — it's last-writer-wins semantics, which is what we want (the most recent version switch wins).

**Confidence:** MEDIUM-HIGH. The Y.Array-over-Y.Map(index) fix is a well-known Yjs idiom; Y.XmlFragment evaluation rests on docs only, not on a prototype.

---

### 5. Y.Doc subdocuments — one subdoc per revision version?

**Verdict: NO for v1.1. Interesting for future isolation, but adds complexity without fixing our bugs.**

**Evidence (Context7 `/yjs/docs` — `api/subdocuments.md`):**
- `new Y.Doc()` can be `.set()` into a parent Y.Map as a subdoc value.
- Subdocs are loaded lazily (`{ autoLoad: true }` to eager-load).
- Providers must implement per-subdoc loading: `doc.on('subdocs', ({ loaded }) => loaded.forEach(subdoc => new Provider(subdoc.guid, subdoc)))`.
- Subdocs with the same `guid` auto-sync — useful for mirrors/aliases.

**Why not adopt for v1.1:**
- Our `y-websocket` relay is one provider per `Y.Doc`. Using per-version subdocs means the relay must route N WS connections per document, or we patch `y-websocket` to multiplex. Both are non-trivial server changes that spill into quillium-landing (out of scope for v1.1 scope).
- Position encoding (`absoluteToRelative`/`relativeToAbsolute` in `src/lib/collab/relativePosition.ts`) works within one Y.Doc. Cross-Doc relative positions are not a thing. Annotations anchored in a parent doc cannot reference positions in a child subdoc without us re-inventing the anchoring layer.
- Undo: `Y.UndoManager` is per-doc. Each subdoc needs its own UndoManager; coordinating undo across the revision tree duplicates the problem we're trying to simplify.
- The bugs we're fixing (comment positions on rebuild, decoration render-on-connect, Cmd-z past connect) are not isolation failures — they're single-source-of-truth failures. Subdocs don't address them.

**When subdocs would help (future):** cross-document transclusion, truly independent per-version history, lazy-loading revisions that are never opened. None of these are v1.1 needs.

**Confidence:** HIGH.

---

### 6. Binding patterns — single source of truth with rich/structured data

**Verdict: Canonical pattern is *"CRDT is the source of truth for shared state; editor is the render/apply layer."* Our current architecture inverts this for annotations. The fix is a design discipline, not a library.**

**Evidence / precedents:**
- **BlockNote, Liveblocks, TipTap + Yjs**: all use Y.XmlFragment as the source of truth, editor state is a projection. ProseMirror's `y-prosemirror` binding makes this explicit.
- **Automerge + CodeMirror examples**: same — Automerge Doc is truth, CM is view.
- **y-codemirror.next 0.3.5**: Y.Text is truth; the `ySyncFacet` holds the ytext + awareness; CM state reads from ytext on init, writes back on transaction.
- **Our working `createYjsBinding.ts`**: follows this correctly for Y.Text. Origin-tag check (`tr.origin === "local"`) prevents loops.

**Where we diverge (the bug):**
- `annotationField.ts` `pushDocToVersionState` (Phase 3, lines 586–612) reads doc text and writes it back into `versions[i].doc` unconditionally whenever a revision's selection is non-empty and no explicit effect fired. **This is a second writer to `versions[i].doc`**, competing with the Y.Map versions subtree.
- `yjsAnnotations.ts::diffAndReconcile` (lines 286–339) treats CM as source of truth and diffs Y.Map to match. Meanwhile `_syncInitialFromYjs` (lines 218–249) treats Yjs as source of truth.
- Result: on a remote rebuild, CM's `addAnnotation` effect and Y.Map's observer both try to install the annotation; on a version switch, the explicit effect updates `versions` but then Phase 3 on a subsequent keystroke rewrites `versions[active].doc` from the parent's text which may lag the subtree Y.Text → divergence.

**The pattern we need for v1.1 (design, not library):**
1. **Y.Map is the source of truth** for annotation identity, type, position, thread, versions structure, activeVersionIndex, and label.
2. **Y.Text (scoped per version)** is the source of truth for version body text.
3. `annotationField` becomes a *derived projection*. Its `update()` no longer contains Phase 3 (no `pushDocToVersionState`). Instead, the annotation binding plugin observes Yjs and dispatches a single effect (`_rebuildAnnotations`) whose value is the full new `Annotations` map. CM-side effects (user actions) write to Yjs only; Yjs observer is the only path that updates the CM field.
4. Undo stays on the CM side via `Y.UndoManager` with per-client origin filtering (already configured).
5. Decorations are a ViewPlugin reading `annotationField` — no change; they "just render" whenever the field updates.

**What does NOT need to change:**
- `createYjsBinding.ts` for Y.Text ↔ CM doc. Keep as-is.
- Relay server. Thin Yjs WS broadcaster, unchanged.
- `createNewAnnotation` / factories — they run once to construct the Y.Map node, not as a CM effect.

**What WILL need invention (not off-the-shelf):**
- The single `yjsAnnotationsBinding` ViewPlugin that replaces `createAnnotationSyncPlugin`. ~150–250 LOC. Tested same way as `yjsBinding.ts`.
- A schema module (`annotationSchema.ts`) that only has Y→CM conversion (reader). The CM→Y writer lives in the command handlers (`addAnnotation` command mutates Y.Map, does NOT dispatch a CM effect — the observer will).
- Optional: wrap the Y.Map in a small `LiveAnnotation` class for ergonomic access, similar to how `NestedEditorController` wraps an EditorView. Not required.

**Confidence:** HIGH for the principle; MEDIUM for "150–250 LOC" estimate (depends on undo inversion details).

---

## Recommendations

### For New Architecture

| Library / Module | Version | Purpose | Integration Risk |
|------------------|---------|---------|------------------|
| `yjs` | ^13.6.30 (pinned, stay on v13 line) | CRDT core — unchanged | None (already installed) |
| `y-protocols` | ^1.0.7 | Awareness — unchanged | None |
| `y-websocket` | ^3.0.0 | Relay client — unchanged | None |
| Custom `yjsBinding.ts` (Y.Text ↔ CM) | current | Preserve verbatim as the template pattern | None (working code) |
| **New** `yjsAnnotationsBinding.ts` (Y.Map ↔ `annotationField` projection) | to be written | Replaces `createAnnotationSyncPlugin`. Yjs-as-source-of-truth; CM field is projection. | **HIGH — core of the milestone.** Requires deleting `pushDocToVersionState` from `annotationField.ts`, removing diff-and-reconcile writer path, unifying initial-sync into one code path. Affects ~8 other files (listeners, commands, nested editor controller). |
| **Change** `Y.Map<string, Y.Map>` versions → `Y.Array<Y.Map>` versions | schema change | Proper concurrent-insert semantics for revision versions | MEDIUM — wire-format change, but per D-94 no legacy format. Update `codeMirrorToYjsAnnotation` and `yjsAnnotationToCodeMirror`. |
| `zod` ^4.3.6 | existing | Optional: validate Y.Map→CM conversion output (fail safe on malformed remote data) | LOW |
| `lib0` (transitive from yjs) | existing | `lib0/random`, `lib0/environment` already available if needed for client IDs | LOW |

### Do NOT Add

| Library | Why not |
|---------|---------|
| `y-codemirror.next` 0.3.5 | Stable release does not sync annotations (only Y.Text + awareness + undo). We already re-implement the Y.Text half correctly. Adopting it would replace `yjsBinding.ts` with ~equivalent code and add a dep whose stable branch has been frozen for 22 months. No payoff for this milestone. |
| `y-codemirror.next` from `main` (unstable) | Targets Yjs v14 (`@y/y`), which is itself unstable and incompatible with our `yjs ^13.6.30` pin. Adopting it means a double migration (v14 + new binding) with unknown stability. Out of scope. |
| `@automerge/automerge` 3.2.5 | Would require replacing Yjs wholesale: relay protocol, binding, UndoManager, awareness, all tests. Weeks of work. v1.1 is a sync-layer fix, not a CRDT swap. |
| `loro-crdt` 1.11.0 | Best-in-class movable tree (`LoroTree`) that genuinely fits the revision-in-revision model — **but** same scope-blowup as Automerge. Log as a v2 candidate; do not adopt now. |
| `Y.XmlFragment` / `Y.XmlElement` as the annotation container | Tree semantics are nice but don't solve the dual-source-of-truth bug, which is our actual problem. Migration cost > payoff. Keep annotations as `Y.Map`. Exception: if we later want rich-text (bold/italic) inside comments, revisit. |
| Y.Doc subdocuments per version | Requires relay protocol changes (one WS per subdoc or multiplexer), breaks cross-doc position encoding, forks UndoManager. Doesn't address our bugs. |
| `@yjs/react`, `y-react`, `y-utility`, any observation helper lib | None exist for Svelte; Yjs core `observeDeep` + `ev.path` is already sufficient. Avoid framework-specific wrappers. |
| `y-sweet` | It's a relay server, not a client library. Our Fly.io relay works. |
| `y-prosemirror`, `y-quill`, `y-monaco` | Editor-specific bindings for non-CM editors. Not applicable. |

---

## Integration Points (concrete)

### Files that will be modified

| File | Change |
|------|--------|
| `src/lib/collab/yjsAnnotations.ts` | **Delete `diffAndReconcile` and the CM→Y writer path.** Unify `_syncInitialToYjs` and `_syncInitialFromYjs` into one Yjs-source-of-truth initializer. Keep `observeDeep` + rebuild dispatch as the only CM-update path. |
| `src/lib/collab/annotationSchema.ts` | `codeMirrorToYjsAnnotation` becomes "construct initial Y.Map from a new annotation" (called once on `addAnnotation` command). Replace `versions: Y.Map<string, Y.Map>` with `versions: Y.Array<Y.Map>`. `yjsAnnotationToCodeMirror` updated to iterate Y.Array instead of sorted Y.Map keys. |
| `src/lib/editor/plugins/annotations/annotationField.ts` | **Delete `pushDocToVersionState` (Phase 3)** — stop reading doc back into versions. Version body doc comes only from the subtree Y.Text. Effects `_updateRevisionVersionDoc`, `_updateRevisionVersionState` semantics revisit (collab-mode effect becomes the only writer). `invertedAnnotationFieldEffects` mostly unchanged but must not emit effects for Yjs-origin transactions (use `yjsAnnotationSync` annotation check). |
| `src/lib/editor/plugins/annotations/NestedEditorController.ts` | Stop dispatching `_updateRevisionVersionDoc` from nested edit listener in collab mode — the subtree Y.Text change will propagate via the binding. (Local-only mode unchanged.) |
| Command functions (`setActiveRevisionVersion`, `createNewRevision`, `deleteRevisionVersion`, etc.) | In collab mode, mutate the Y.Map first (`node.set('activeVersionIndex', n)`, `versionsArray.push(new Y.Map(...))`), then the observer dispatches the CM effect. In local mode, dispatch the effect directly (unchanged). A `collabMode` facet/flag distinguishes. |
| `src/lib/collab/types.ts` | Add `YjsVersionsType = Y.Array<Y.Map<unknown>>` alias; narrow `YjsAnnotationNode.versions` type. |
| Tests: `src/lib/collab/*.test.ts`, fuzz tests | Rewrite against the new single-source-of-truth flow. Fuzz tests from Phase 11–12 stay valid at the CM level. |

### Files that stay unchanged

- `src/lib/collab/yjsBinding.ts` — Y.Text ↔ CM doc works.
- `src/lib/collab/relativePosition.ts` — position encoding unchanged.
- Relay server in `quillium-landing` — unchanged.
- All ViewPlugins in `src/lib/editor/plugins/annotations/index.ts` that read `annotationField` — they're projections of the field; they don't care who writes it.
- `annotations.fuzz.test.ts` — property tests on `annotationField` still apply.

---

## Open Questions (for Requirements phase)

1. **Undo/redo semantics in collab mode.** Current `invertedAnnotationFieldEffects` produces inverse CM effects. If Yjs becomes source of truth, does `Y.UndoManager` handle annotation inversion, or do we still project through `invertedAnnotationFieldEffects`? This needs a concrete design in requirements. (Hypothesis: `Y.UndoManager` tracks Y.Map mutations; observer re-projects to CM; `invertedAnnotationFieldEffects` is bypassed in collab mode. Untested.)
2. **`_restoreAnnotation` on implicit text deletion.** Today, when a user deletes the text an annotation is anchored to, `invertedAnnotationFieldEffects` synthesizes `_restoreAnnotation` so undo re-adds it. In the new model, the remote peer must also see this restore. Does that come for free from Y.UndoManager, or do we need an explicit Y.Map mutation on the deletion path?
3. **Version `Y.Array` vs `Y.Map(index)` concurrent-insert behavior.** Needs a fuzz test: two peers call `createNewRevision` concurrently — does Y.Array merge preserve both versions? Expected yes; verify.
4. **Label updates on version doc.** `_updateRevisionVersionLabel` sets `label` on the version's Y.Map. With Y.Array<Y.Map>, the Y.Map identity is stable across version reordering (Y.Array doesn't mutate element identity on insert). Verify.
5. **Initial-sync race.** When a joiner connects, which fires first: Y.Text sync (text appears) or Y.Map sync (annotations appear)? Decorations depend on both. Today we see "decorations missing until switch once." New model must emit CM rebuild after both are present. Design a two-gate initializer.
6. **Persistence snapshot format.** Tauri SQLite event log currently stores `RawAnnotationsSchema` JSON. That continues to work (it's the local snapshot; Yjs is over-the-wire). No change needed, but confirm.

---

## Sources

- npm metadata (2026-04-19): `npm view yjs|y-codemirror.next|@automerge/automerge|loro-crdt time dist-tags`
- GitHub (2026-04-19): `yjs/y-codemirror.next` repo state, `main` branch README, v0.3.5 tag source (`src/y-sync.js`), commit log
- Context7 `/yjs/docs` (2026-04-19): Subdocuments API, Y.XmlFragment API, Y.XmlElement API
- Context7 `/loro-dev/loro` (2026-04-19): LoroTree hierarchical data + movable nodes
- Existing code inspected: `yjsAnnotations.ts`, `annotationSchema.ts`, `yjsBinding.ts`, `annotationField.ts`, `models.ts`
- `.planning/PROJECT.md` v1.1 milestone scope
