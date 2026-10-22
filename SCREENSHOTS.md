# Screenshot gallery

These are committed demo captures from
[`packages/desktop/screenshots`](packages/desktop/screenshots). Refresh them from
the repository root with `bun run desktop:screenshots`, then inspect the image
diff before committing. CI does not refresh this gallery on every push.

The capture script seeds mock Tauri data. These images illustrate the app; they
do not verify native persistence. For release-note images, use the
[changelog guide](docs/changelog.md). For regression baselines, use
[visual regression and CI](docs/visual-regression.md).

## Editor

![Clean writing environment](packages/desktop/screenshots/01-editor.png)
*The focused writing environment: document card, status bar, and the collapsed AI sidebar pill.*

## AI feedback

![AI feedback panel](packages/desktop/screenshots/17-ai-feedback.png)
*The Feedback panel with Structure scan, Audience fit, Recurring patterns, and the reader-persona toggle.*

## Annotations

![All annotation types](packages/desktop/screenshots/03-annotations.png)
*Comments, suggestions, and revisions floating beside the text in their resting state.*

## Comment thread

![Active comment](packages/desktop/screenshots/04-comment-active.png)
*An active comment card with a full back-and-forth thread and reply input. The yellow highlight marks the annotated text.*

## Inline revision editor

![Revision with nested editor](packages/desktop/screenshots/05-revision-active.png)
*A revision card with version pills and the inline nested CodeMirror editor open. The purple highlight marks the range.*

## Revision modal

![Revision modal](packages/desktop/screenshots/07-revision-modal.png)
*The full-screen revision modal for editing alternative text without distraction.*

## Document library

![Document library](packages/desktop/screenshots/06-library.png)
*The document library: grid view with document cards and the preview panel.*

## Editor with AI sidebar

![Full UI hero screenshot](packages/desktop/screenshots/22-full-ui.png)
*Comments and a revision beside the draft, with contextual starting points in the Chat sidebar.*

