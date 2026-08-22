# Separate document activity from draft content history

Store prose events and snapshots per draft and structural activity per document,
then interleave both in the document-wide Version History. Restoring history
seeds a new run head instead of rewriting or deleting later history. See
[PR #282](https://github.com/ThatXliner/Quillium/pull/282).
