# Authorship provenance

The provenance system builds an authorship report from Quillium's local event
log. It records timestamped edits captured on this device and classifies their
origin. Reports trust the local database and cannot prove who authored the text.

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
document changes. Enabling the report later can therefore use the retained
events recorded before the flag was enabled. Missing history remains unknown.

Demo capture scripts override the flag for their authored scenes. The flag
controls access to the report, not the validity of its classifications.

## Implementation

Paths below are relative to `packages/desktop`.

| File | Purpose |
|------|---------|
| `src/lib/db/events.ts` | Event payload types and optional `provenance` field |
| `src/lib/editor/listeners.ts` | Captures provenance when persisting doc changes |
| `src/lib/provenance/classify.ts` | Pure origin classifier |
| `src/lib/provenance/report.ts` | Pure report builder + async DB wrapper |
| `src/lib/provenance/export.ts` | JSON/Markdown authorship report export |
| `src/lib/provenance/PlaybackViewer.svelte` | `/authorship` playback UI |
| `src/routes/authorship/+page.svelte` | Route wrapper for the playback viewer |

## Capturing provenance

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

## Origin mapping

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

## Report builder

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

[`generateProvenanceReport()`](../packages/desktop/src/lib/provenance/report.ts)
loads the draft's events and snapshots. It reconstructs final document length
from the latest snapshot and subsequent events, then passes the full retained
event list and `generatedAt` to the pure builder. A snapshot can establish final
text without supplying authorship evidence for its missing event prefix.

## Playback

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

## Surviving wording (text origin)

Enable **Show text origin** in Authorship Playback to inspect all surviving wording
at the selected point in the draft history, including the finished draft shown on
open. This remains behind the existing authorship feature gate.

The view marks writer wording, wording inserted by Quillium AI, writer replacements
of AI wording, and unknown origin with labeled, distinct underline patterns. An
AI suggestion does not affect wording provenance until accepted; rejecting a
suggestion changes no prose. Chosen AI revision versions are also classified using
recorded version provenance. This is a private writing aid, not an AI detector or
an authorship score.

`textOrigin.ts` maps surviving spans through exact recorded transaction changes.
It reconstructs recorded undo groups when their before/after text agrees with the
recorded undo or redo. Missing history (including snapshot prefixes), external
pastes, legacy restores, and unrecorded moves cannot establish AI wording origin.
A replacement intersecting recorded AI wording is labeled writer edits to AI
wording; this describes edit lineage, not a threshold for ownership of an idea.
Pure deletion does not relabel surviving words. External drag-and-drop is unknown. Text newly typed beside AI wording
is writer wording. A mixed revision version may provide only coarse provenance. Nested acceptance now forwards its AI request metadata through parent dispatch; older nested events that lack a source signal remain unknown.

Reopening reconstructs origin from the existing draft event log without storing
an additional origin map. Reconstruction failure or disagreement with
the canonical document replay suppresses the overlay and shows an unavailable
message. The overlay is a read-only playback view. Root and nested editing views do not
show it, and clipboard moves do not preserve origin metadata.
