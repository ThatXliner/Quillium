# Design Notes

## Revision editing experience
- The inline revision card keeps the alternative text anchored inside the document so users can see their change in context while version pills above the card describe every saved variant.
- When a user wants to edit a revision, we open a nested editor (inline or modal) so their keystrokes do not accidentally touch the parent document. The modal is the heavier tool: it can store its own undo stack, let people annotate within a version, and keep a breadcrumb trail for nested edits. The inline nested editor is intentionally lightweight so the document never feels disconnected from the surrounding prose.
- We lean on this split to balance immediacy (edit inline when changes are small) and depth (open the modal when the revision needs independent treatment). Users see the active version in real time, while the UI keeps the underlying versions discoverable via pills and breadcrumbs.

## Version navigation & undo
- Version pills are the primary navigation control. Tapping a pill swaps the revision text in the main document and instantly highlights the selected pill, so users understand which version is authoritative without leaving the page.
- Undo and redo respect both the text and the pill state in lockstep: when you step back, the document rewinds to the previous version and the pill selection follows. This preserves the mental model of a single linear revision stack, even though each version is a branching point internally.
- Keyboard shortcuts like `Ctrl-[`/`Ctrl-]` are mirrored inside nested editors so people can navigate history without leaving the revision surface. We mirror the parent controls here on purpose to avoid surprises when moving between inline and modal editing.

## Annotation lifecycle
- Comments and suggestions vanish as soon as their text is deleted; they are tied to live stretches of content. Revisions behave differently: closing their text down keeps the annotation around so people can reopen the version later without losing the branch point.
- Pending comments are signaled by the empty-thread placeholder (`thread.length === 0`) so the UI can show “draft” styling until the user submits the first message. Applying or converting suggestions to revisions updates the surrounding card rather than replacing the entire annotation object, keeping transitions smooth.
- We only allow one pending comment UI at a time to avoid duplicated drafts. When a user tries to flip between threads, the UI nudges them to finish or discard the draft before opening another card.

## Feedback & AI interactions
- The AI sidebar keeps contextual prompts, feedback, and revision generation grouped together so users can switch modes (Chat / Feedback / Revise) without losing locations in the document.
- AI responses appear in the same conversation flow that comments and suggestions use, reinforcing the idea that AI suggestions are just another annotation type rather than a separate modal.
- Quick prompts and model/provider controls live in the sidebar so users can experiment freely, and we surface PostHog events (like `ai_feedback_requested`) in the architecture doc for instrumentation rather than the interface text.
