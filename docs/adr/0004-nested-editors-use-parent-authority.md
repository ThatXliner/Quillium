# Treat nested editors as viewports over parent authority

The parent editor's document and annotation state are authoritative. Inline and
modal nested editors are two presentations of the same revision version and
translate edits into the parent instead of owning separate documents or undo
histories. See [DESIGN.md](../../DESIGN.md) and
[PR #265](https://github.com/ThatXliner/Quillium/pull/265).
