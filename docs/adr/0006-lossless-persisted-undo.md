# Persist undo only when complete effects are recoverable

New documents default to session-only undo because serialized CodeMirror history
can omit Quillium's annotation effects and restore text without its revision
state. Grandfathered or opted-in documents may retain verified lossless history;
invalid legacy stacks fail closed, and collaborators use personal Yjs undo
authority. See [PR #343](https://github.com/ThatXliner/Quillium/pull/343).
