# Authorship Provenance

The provenance system builds an authorship report from Quillium's local event
log. It is evidence of the writing process, not cryptographic proof: it records
timestamped edits captured on this device and classifies where document-changing
events came from.

## Feature gate

The whole feature is behind the `authorship-provenance` PostHog flag, which
fails closed. Until the flag is on for a user:

- the `Authorship Report…` menu item is built disabled, so its
  `CmdOrCtrl+Shift+A` accelerator does nothing;
- the `menu:authorship` handler in `routes/+page.svelte` ignores the event;
- the status bar's authorship playback button (`editor/StatusBar.svelte`) is
  not rendered;
- `/authorship` renders an unavailable state instead of `PlaybackViewer`.

Capture is deliberately not gated. `listeners.ts` keeps stamping provenance on
every `doc_change`, so turning the flag on later gives a user a report covering
their whole writing history rather than only the period since the flag flipped.

The gate is here because the classifier and report builder have not had a
review pass, and a report about who wrote what is only worth shipping if it is
right. Screenshot runs override the flag (`scripts/screenshots.ts`,
`scripts/changelog-shot.ts`).

## Files

| File | Purpose |
|------|---------|
| `src/lib/db/events.ts` | Event payload types and optional `provenance` field |
| `src/lib/editor/listeners.ts` | Captures provenance when persisting doc changes |
| `src/lib/provenance/classify.ts` | Pure origin classifier |
| `src/lib/provenance/report.ts` | Pure report builder + async DB wrapper |
| `src/lib/provenance/export.ts` | JSON/Markdown authorship report export |
| `src/lib/provenance/PlaybackViewer.svelte` | `/authorship` playback UI |
| `src/routes/authorship/+page.svelte` | Route wrapper for the playback viewer |

## Capturing Provenance

Only `doc_change` and `compound` events carry provenance. The field is optional
so legacy events remain loadable:

```typescript
type Provenance = {
    origin: ChangeOrigin;
    userEvent?: string;
    insertedChars?: number;
    removedChars?: number;
    aiGenerations?: AiGenerationProvenance[];
};
```

`listeners.ts` reads each CodeMirror transaction's `Transaction.userEvent`
annotation and revision/nested-editor markers, then stores the derived
`origin` alongside the raw `userEvent`. The raw value stays in the event so the
classification can be audited or reinterpreted later.

When a transaction applies text from an AI suggestion or revision,
`aiGenerations` records the originating request ID, editorial task, provider,
model, timestamp, and optional persona. The same request record lives on the
source annotation and generated revision versions. Human and legacy work omits
it. This gives accepted AI text a traceable request identity without treating all
revision-system transactions as AI-authored.

## Origin Mapping

| Origin | Signal | Meaning |
|--------|--------|---------|
| `type` | `input.type*` | Human keystrokes / composition |
| `paste` | `input.paste` | Pasted text |
| `cut` | `delete.cut` | Cut operation |
| `delete` | other `delete*` | Non-cut deletion |
| `restore` | `input.restore` | Crash/backup restore, not authored text |
| `format` | bare `input` | Markdown formatting command |
| `human-revision` | explicit human version provenance | Human-created revision text |
| `ai-revision` | explicit AI version provenance | AI-created revision text |
| `mixed-revision` | explicit mixed version provenance | AI text subsequently edited by a human |
| `nested-edit` | nested-editor marker | Text written through a nested editor |
| `unknown` | no recognized signal | Legacy or unclassified event |

Revision operations carry explicit per-version provenance. The internal revision
marker alone never implies AI; legacy revisions without explicit provenance are
reported as unknown. Nested-editor changes carry the active version's updated
human/mixed provenance; legacy nested edits without it retain the `nested-edit`
classification.

## Report Builder

`buildProvenanceReport()` is pure and deterministic. Callers provide the ordered
events, draft id, document title, generated timestamp, and final document
length. The report includes:

- character totals by origin (`typedChars`, `pastedChars`, `aiRevisionChars`,
  `formatChars`, `unknownChars`)
- active writing time with idle gaps over `IDLE_THRESHOLD_MS` (2 minutes)
  clamped out
- writing sessions split at that same idle threshold
- paste log, with pastes at or above `PASTE_FLAG_CHARS` (200 chars) flagged
- AI assistance counts for AI revision events and AI-authored annotations
- integrity statement and legacy/unclassified event ratio

`generateProvenanceReport()` is the async convenience wrapper. It loads every
event for a draft with `listDraftEvents()`, replays them into a minimal
CodeMirror state to measure final document length, stamps `generatedAt`, then
delegates to the pure builder.

## Playback UI

`/authorship` renders `PlaybackViewer.svelte`. The viewer reads the draft event
stream, replays edits, and lets the writer scrub through the writing timeline.
Each current edit is highlighted with a provenance-specific presentation bucket
derived from the event payload.

Navigation uses `goToAuthorship()` and the native menu emits
`menu:authorship`.

## Export

`exportAuthorshipReport(draftId, documentTitle, format)` writes either:

| Format | Contents |
|--------|----------|
| `json` | Full `ProvenanceReport` object |
| `md` | Human-readable summary, totals, sessions, paste log, AI section, integrity |

The Markdown export truncates inline paste previews at 500 characters. Both
formats use the shared native save dialog helpers from `src/lib/export.ts`.

## Limitations

- Reports are local and trust the local SQLite event log.
- Events written before provenance capture are surfaced as `unknown`, not hidden.
- The report cannot prove that someone did not manually retype AI-generated
  text.
- It is not a tamper-proof signature or remote attestation system.

## Tests

- `tests/provenance/classify.test.ts` covers origin classification.
- `tests/provenance/report.test.ts` covers buckets, idle splitting, paste flags,
  legacy handling, and AI-assist counts.
