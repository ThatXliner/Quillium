# Legacy decision markers

Canonical architecture decisions live in the [ADRs](docs/adr/README.md).
Older source comments also contain phase-local `D-*` markers. Those numbers
were reused across planning phases, so a marker alone does not identify a
unique decision or establish current behavior.

## Find a marker's context

Search the current implementation and tests from the repository root:

```bash
rg -n 'D-55' packages supabase
```

Read the surrounding code, then use `git log -S 'D-55' -- <path>` to find the
change that introduced it. Some comments refer to removed planning documents
such as `PATTERNS.md` or `ROADMAP.md`. Use Git history for those documents;
they are not current implementation instructions.

## Current sources for recurring decisions

| Topic in older comments | Current explanation |
|---|---|
| Event logs, snapshots, and recovery | [Persistence](docs/persistence.md) and [ADR 0001](docs/adr/0001-event-log-with-snapshots.md) |
| Parent authority and nested undo | [Nested editors](docs/nested-editors.md) and [ADR 0004](docs/adr/0004-nested-editors-use-parent-authority.md) |
| Revision identities and wire migration | [ADR 0005](docs/adr/0005-stable-revision-version-identities.md) |
| Account identity and guest sessions | [Auth](docs/auth.md) and [ADR 0007](docs/adr/0007-supabase-collaboration-identity.md) |
| Yjs, owner-led rooms, and temporary joiner state | [Collaboration](docs/collaboration.md) and [ADR 0008](docs/adr/0008-owner-led-yjs-live-rooms.md) |

The former line-number inventory and July 2026 refactoring survey are available
in Git history. Their file paths, branch statuses, and pending work no longer
represent the current code. Track new proposals in
[GitHub Issues](https://github.com/ThatXliner/Quillium/issues).
