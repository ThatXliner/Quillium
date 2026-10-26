# Persist local edits as an event log with snapshots

Persist draft changes to an append-only SQLite event log and use snapshots only
to bound replay. Snapshot-only loading previously lost edits after the last
checkpoint, so snapshot cadence is a performance policy rather than a durability
boundary. See [PR #98](https://github.com/ThatXliner/Quillium/pull/98) and
[issue #188](https://github.com/ThatXliner/Quillium/issues/188).
