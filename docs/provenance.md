# Authorship Provenance

The provenance system builds an authorship report from Quillium's local event
log. It is evidence of the writing process, not cryptographic proof: it records
timestamped edits captured on this device and classifies where document-changing
events came from.

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
};
```

`listeners.ts` reads each CodeMirror transaction's `Transaction.userEvent`
annotation and revision/nested-editor markers, then stores the derived
`origin` alongside the raw `userEvent`. The raw value stays in the event so the
classification can be audited or reinterpreted later.

## Origin Mapping

| Origin | Signal | Meaning |
|--------|--------|---------|
| `type` | `input.type*` | Human keystrokes / composition |
| `paste` | `input.paste` | Pasted text |
| `cut` | `delete.cut` | Cut operation |
| `delete` | other `delete*` | Non-cut deletion |
| `restore` | `input.restore` | Crash/backup restore, not authored text |
| `format` | bare `input` | Markdown formatting command |
| `ai-revision` | `revisionInternalEdit` | Accepted/switched revision text |
| `nested-edit` | nested-editor marker | Text written through a nested editor |
| `unknown` | no recognized signal | Legacy or unclassified event |

Revision and nested-editor markers win over `userEvent`, because those changes
are dispatched programmatically and may not carry a user event.

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
