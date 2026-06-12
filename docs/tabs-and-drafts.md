# Document Tabs & Draft Trees

Implements the unified tab/draft architecture from issue #160: a document is a
container of **tabs**, and each draft-type tab holds a **tree of drafts**.

```
Document (one card in Library)
└── Tabs (top bar, horizontal)
    ├── Draft Tab "Main"
    │   └── Draft tree: main → v1 → v1.5
    │                        └→ v2
    └── Draft Tab "Notes"
        └── Draft tree: main
```

## Concepts

| Concept | What it is | UI |
|---------|-----------|----|
| Document | Container of tabs; one Library card | Library grid |
| Tab | A piece of content within a document (`tab_type: "draft"`; future types e.g. canvas share the bar) | `DocumentTabs.svelte` above the document card |
| Draft | One editable text + its own event log/snapshots | `DraftTreePanel.svelte`, hugging the document's left edge |
| Draft tree | Parent/child links between a tab's drafts (`parent_draft_id`) | Indented rows in the panel |
| Lock | Derived from branching: a draft locks while it has live children | Amber strip inside the page; read-only state |
| Document activity | Audit log of all structural ops (tab CRUD, branching, locks, checkpoints) | Timeline in version history, with Restore actions |

## Schema

```sql
tabs       (id, document_id, tab_type, label, position, created_at, deleted_at)
drafts     (id, document_id, tab_id, parent_draft_id, label, created_at,
            is_active, locked, deleted_at)
doc_events (id, document_id, event_type, payload, created_at)
```

Events and snapshots stay **draft-scoped** (unchanged) — every draft has an
independent event log and version history. `_meta` keys `active_tab:{doc_id}`
and `active_draft:{tab_id}` persist the user's position.

**Nothing structural is ever destroyed.** Tab and draft deletion is a soft
delete (`deleted_at`); the rows, their events, and their snapshots all
survive. Deletion offers an Undo toast, and the version history's
"Document activity" timeline can restore any deleted tab or draft later.
Every structural operation appends a `doc_events` row (#160: "version
history is document-wide — one linear audit log tracks everything").

Migration (`schema.rs → migrate_tabs_and_draft_tree`) is idempotent: it
ALTER-adds the draft columns and attaches pre-existing drafts to a per-document
"Main" tab on startup.

## Forking

`cmd_fork_draft(parent_draft_id, label, state_json)`:

1. The frontend serializes the parent's current state — the live
   `EditorView` state if the parent is open, otherwise rebuilt from
   snapshot + event replay (`buildStateFromLoad`).
2. Rust creates the child draft and plants the state as a snapshot labeled
   **"Branch point"** (`up_to_event_id = -1`). Labeled snapshots are exempt
   from auto-prune, so the branch base can never be garbage-collected.
3. The parent is soft-locked (`locked = 1`).

The child's event log starts empty; restore-to-"Branch point" in version
history returns it exactly to the fork state.

"+ New draft" in the panel creates a **sibling** of the open draft instead —
a parallel take at the same tree level, seeded with the open draft's state.
Root drafts get a root sibling via `cmd_create_tab_draft` (no parent to
fork from).

## Locking

Locks come from two places sharing one flag:

- **Branching**: forking locks the parent; deleting a parent's last live
  branch auto-unlocks it; restoring a branch re-locks it.
- **Manual**: any draft can be locked/unlocked from its row in the panel.
  (Edge: the auto-unlock on losing the last branch also clears a manual
  lock — re-lock from the panel if needed.)

While locked, the editor state is built with `EditorState.readOnly.of(true)`
and an amber strip inside the page offers "Edit anyway" (persistently
unlocks) and "New branch". **Annotation creation is refused on locked
drafts**: the comment/revision keyboard commands and the programmatic
`createComment`/`createSuggestion`/`createRevision` entry points (used by
the AI sidebar and AutoAI) all bail on `state.readOnly`, and the AutoAI
engine skips reviewing read-only drafts entirely. Event replay dispatches
raw effects, so loading locked drafts is unaffected. The DB never rejects
writes — replay and collab are unaffected.

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
- Only leaf drafts can be deleted; all deletions are soft and reversible
  (Undo toast immediately, version-history timeline later).
- A draft is locked iff it has live children, unless explicitly unlocked.

## Key files

| File | Role |
|------|------|
| `src-tauri/src/db/tabs.rs` | Tab CRUD, draft tree ops, fork, active pointers |
| `src-tauri/src/db/schema.rs` | `tabs` table + drafts migration/backfill |
| `src-tauri/src/db/load.rs` | Tab-aware default draft resolution |
| `src/lib/editor/DocumentTabs.svelte` | Browser-style tab bar |
| `src/lib/editor/DraftTreePanel.svelte` | Draft tree sidebar |
| `src/lib/editor/draftTree.ts` | Pure tree build/flatten helpers |
| `src/lib/editor/Editor.svelte` | Tab/draft switching, fork, lock banner |

## Out of scope (follow-ups)

- Canvas tabs (#197) — `tab_type` column is ready, no implementation yet
- Merge workflow between draft branches (UX undecided in #160)
- Document-wide *content* checkpoints (one snapshot of all tabs/drafts at
  once); content snapshots remain per-draft, structural history is
  document-wide via `doc_events`
- Tab drag-reordering
