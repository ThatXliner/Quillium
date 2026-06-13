# Document Tabs & Draft Trees

Implements the unified tab/draft architecture from issue #160: a document is a
container of **tabs**, and each draft-type tab holds drafts related by two
distinct moves — **iterate** (the next version) and **branch** (a different
take).

```
Document (one card in Library)
└── Tabs (top bar, horizontal)
    ├── Draft Tab "Main"
    │   main → v1 → v2          ← iteration run (flat)
    │            └ take 2 → …    ← branch off v1 (indented), its own run
    └── Draft Tab "Notes"
        main
```

## Two relations: iterate vs branch

The crux of the model (and the resolution of much UX confusion) is that a
draft is created by one of *two* moves, stored as two separate links:

- **Iterate** — "the next version, continuing from this draft." The common
  action. Linked by `parent_draft_id`. An iteration chain (a **run**)
  renders **flat** — same indent, oldest→newest — so a hundred iterations
  stay a readable list, never a hundred-deep tree. Iterating **locks the
  source** (it's superseded); only the newest live draft in a run (the
  **tip**) is editable.
- **Branch** — "a different take on the same idea." The rarer action. Linked
  by `branched_from`. A branch renders **indented** one level under its
  source and starts its own run. Branching **locks nothing** — the source
  and the branch are parallel live explorations. Branch is *not* offered on
  a run head (`main` or another branch's root): a top-level take is a new
  tab, not a branch off main.

Why iterations are flat and branches nested (inverted from the obvious
parent=child reading): the frequent action gets the cheap visual (a list),
the rare action gets the expensive one (indentation). See the #160 thread.

## Concepts

| Concept | What it is | UI |
|---------|-----------|----|
| Document | Container of tabs; one Library card | Library grid |
| Tab | A piece of content within a document (`tab_type: "draft"`; future types e.g. canvas share the bar) | `DocumentTabs.svelte` above the document card |
| Draft | One editable text + its own event log/snapshots | `DraftTreePanel.svelte`, hugging the document's left edge |
| Run | An iteration chain (`parent_draft_id` links) — renders flat | A flat group of rows in the panel |
| Branch | A different take (`branched_from`) — its own run, indented | An indented sub-group |
| Lock | Soft read-only state: a superseded iteration, or set manually | Amber strip inside the page; read-only state |
| Document activity | Audit log of all structural ops (tab CRUD, iterate/branch, locks, checkpoints) | Unified history timeline, with Restore actions |

## Schema

```sql
tabs       (id, document_id, tab_type, label, position, created_at, deleted_at)
drafts     (id, document_id, tab_id, parent_draft_id, branched_from, label,
            created_at, is_active, locked, deleted_at)
doc_events (id, document_id, event_type, payload, created_at)
```

A draft sets at most one of `parent_draft_id` (iteration) / `branched_from`
(branch); `main` and branch roots set neither.

Events and snapshots stay **draft-scoped** (unchanged) — every draft has an
independent event log and version history. `_meta` keys `active_tab:{doc_id}`
and `active_draft:{tab_id}` persist the user's position.

**Nothing structural is ever destroyed.** Tab and draft deletion is a soft
delete (`deleted_at`); the rows, their events, and their snapshots all
survive. Deletion offers an Undo toast, and the version history's
unified timeline can restore any deleted tab or draft later.
Every structural operation appends a `doc_events` row (#160: "version
history is document-wide — one linear audit log tracks everything").

Migrations are idempotent numbered entries (`migrations.rs`): #6
`tabs_and_draft_tree` adds the tabs/draft-tree columns and attaches
pre-existing drafts to a per-document "Main" tab; #7 `draft_branch_relation`
adds `branched_from` and reinterprets any old fork-as-child link as a branch
(preserving the existing tree shape).

## Iterate & branch

`cmd_iterate_draft(source_draft_id, label, state_json)` and
`cmd_branch_draft(source_draft_id, label, state_json)` both:

1. Take the source's current state, serialized by the frontend — the live
   `EditorView` if the source is open, otherwise rebuilt from snapshot +
   event replay (`seedStateJson` → `buildStateFromLoad`).
2. Create the new draft and plant that state as a snapshot labeled
   **"Branch point"** (`up_to_event_id = -1`). Labeled snapshots are exempt
   from auto-prune, so the seed can never be garbage-collected. The new
   draft's event log starts empty, so restore-to-"Branch point" returns it
   exactly to its seed.

They differ only in the link and the lock side effect:

- **iterate** sets `parent_draft_id = source` and relocks the run so only the
  new tip is editable (the source, now superseded, locks).
- **branch** sets `branched_from = source`, locks nothing, and is refused if
  the source is a run head.

## Locking

A draft is locked when either is true:

- **Superseded** — it has a newer live iteration in its run. `relock_run`
  re-derives this on every iterate/delete/restore: each run locks all live
  members except the tip. Runs are independent, so each branch line has its
  own editable tip.
- **Manual** — locked from its row in the panel. (Edge: the run re-derivation
  on delete/restore also clears a manual lock if that draft becomes the tip;
  re-lock from the panel if needed.)

While locked, the editor state is built with `EditorState.readOnly.of(true)`.
An amber strip inside the page reads "This is an older version." (superseded)
or "This draft is locked." (manual), and offers "Edit anyway" (persistent
unlock) plus "New take" (branch — shown only on a non-run-head).

**Annotation creation is refused on locked drafts**: the comment/revision
keyboard commands and the programmatic `createComment`/`createSuggestion`/
`createRevision` entry points (used by the AI sidebar and AutoAI) all bail on
`state.readOnly`, and the AutoAI engine skips reviewing read-only drafts
entirely. Event replay dispatches raw effects, so loading locked drafts is
unaffected. The DB never rejects writes — replay and collab are unaffected.

## Resolution order

Opening a document without an explicit draft id resolves:
active tab (`_meta`) → first tab by position → that tab's active draft
(`_meta`) → first draft by `created_at` → legacy pre-tabs fallbacks.
This logic lives in Rust (`load.rs → resolve_default_draft`) and is mirrored
for the frontend by `resolveActiveDraftId()` in `src/lib/db/index.ts`
(used by export, the library preview, and version-history bootstrap).

## Invariants

- Every tab has ≥ 1 live draft (`create_tab` seeds a root "main" draft;
  deleting a tab's last live draft is rejected).
- Every document has ≥ 1 live tab (deleting the last live tab is rejected;
  `create_draft` legacy path creates a "Main" tab when none exists).
- A draft is a deletable leaf only if nothing iterates from it and nothing
  branches off it; all deletions are soft and reversible (Undo toast
  immediately, version-history timeline later).
- Locking is derived from supersession or set manually; iterate locks the
  source, branch locks nothing.

## Key files

| File | Role |
|------|------|
| `src-tauri/src/db/tabs.rs` | Tab CRUD, iterate/branch, run relocking, active pointers |
| `src-tauri/src/db/migrations.rs` | Numbered schema migrations (#6 tabs, #7 branch relation) |
| `src-tauri/src/db/load.rs` | Tab-aware default draft resolution |
| `src/lib/editor/DocumentTabs.svelte` | Browser-style tab bar |
| `src/lib/editor/DraftTreePanel.svelte` | Draft panel (flat runs, indented branches) |
| `src/lib/editor/draftTree.ts` | Pure row-layout helpers (`layoutDraftRows`) |
| `src/lib/editor/Editor.svelte` | Tab/draft switching, iterate/branch, lock banner |

## Omni (web preview) and the single view

Omni renders a **single view** per document. The read-only web preview /
public share is therefore keyed by **document id**, not draft id: one share
link per document. Pressing **Update now** publishes whatever tab+draft is
*currently active* in the editor — the last one you clicked into — so updating
from a different draft simply replaces what the single shared view shows. (The
live "Go Live" relay room still keys on draft id; that's a separate, per-view
mechanism, and not functional yet — #260 tracks bringing it in line with the
tabs/drafts model.) The share key lives in `GoLiveButton.svelte` as `shareId`
(document) vs `currentId` (draft). Keying on the document — rather than baking
a multi-draft payload into the share — is what keeps the door open for Omni
rendering multiple tabs later without changing the share identity.

## Out of scope (follow-ups)

- Omni rendering **multiple tabs** in one preview (#261) — today it's a single
  view of the last active tab+draft; the share is already document-keyed for this
- Omni **live relay room** on the tabs/drafts model (#260) — still per-draft and
  not functional yet
- Canvas tabs (#197) — `tab_type` column is ready, no implementation yet
- Merge workflow between draft branches (UX undecided in #160)
- Document-wide *content* checkpoints (one snapshot of all tabs/drafts at
  once); content snapshots remain per-draft, structural history is
  document-wide via `doc_events`
- Tab drag-reordering
