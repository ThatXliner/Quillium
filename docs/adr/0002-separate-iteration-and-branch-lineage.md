# Separate iteration lineage from alternate-run lineage

Represent an iteration with `parent_draft_id` inside the same run, superseding
and locking its source. Represent a branch with `branched_from`, beginning an
alternate run without superseding its source; iterations render flat because
they are routine, while alternate runs indent to expose meaningful divergence.
See the [PR #254 decision](https://github.com/ThatXliner/Quillium/pull/254#issuecomment-4697753403).
