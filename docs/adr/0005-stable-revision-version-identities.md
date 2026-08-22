# Give revision versions stable identities

Give every revision version a stable string ID, store display order separately,
and select the active version by ID because array indexes change meaning when
versions are inserted, removed, or reordered. Persisted and Yjs data migrate to
the ID-native schema while readers remain tolerant of legacy data. See
[PR #271](https://github.com/ThatXliner/Quillium/pull/271) and
[PR #336](https://github.com/ThatXliner/Quillium/pull/336).
