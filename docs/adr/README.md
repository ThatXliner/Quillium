# Architecture decision records

These records capture decisions that are costly to reverse, easy to misread from
the code, and based on a real trade-off. `DECISION.md` remains a historical index
of phase-local markers; the files here are the canonical architecture decisions.

1. [Persist local edits as an event log with snapshots](./0001-event-log-with-snapshots.md)
2. [Separate iteration lineage from alternate-run lineage](./0002-separate-iteration-and-branch-lineage.md)
3. [Separate document activity from draft content history](./0003-separate-activity-from-content-history.md)
4. [Treat nested editors as viewports over parent authority](./0004-nested-editors-use-parent-authority.md)
5. [Give revision versions stable identities](./0005-stable-revision-version-identities.md)
6. [Persist undo only when complete effects are recoverable](./0006-lossless-persisted-undo.md)
7. [Use Supabase accounts for collaboration identity](./0007-supabase-collaboration-identity.md)
8. [Run owner-led Yjs Live Rooms with ephemeral joiners](./0008-owner-led-yjs-live-rooms.md)
9. [Share editor presentation through app-neutral capabilities](./0009-app-neutral-editor-capabilities.md)
10. [Keep public Web Preview identity document-keyed](./0010-document-keyed-web-preview.md)
