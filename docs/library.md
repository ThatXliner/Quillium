# Library and document management

The Library lists documents, each of which contains tabs and drafts. Document
metadata includes the title, tags, word count, preview text, and timestamps.
Prose and annotations belong to each draft's event log and snapshots. See
[tabs and drafts](tabs-and-drafts.md) and [persistence](persistence.md).

## Titles and metadata

New documents start as `Untitled`.
[documentMetadata.ts](../packages/desktop/src/lib/editor/documentMetadata.ts)
derives a title from the first line once the writer adds a newline or at least
four words. The title is capped at 40 characters. SQLite applies the proposed
title only if the stored title is still `Untitled`, so a delayed content save
cannot replace a rename.

Title, tags, and content metadata use separate database operations. Renaming or
tagging leaves the indexed body unchanged. Content writes update the word count,
preview, and search body. These values describe the most recently saved draft
content, not the combined contents of every tab. Tags are a JSON array in
`documents.tags`.

## Library actions

[The Library route](../packages/desktop/src/routes/library/+page.svelte) has
Library and Trash views, a search field, document cards, and a preview panel.
The Continue control opens the most recently edited document.

Writers can create, open, rename, duplicate, trash, and restore documents.
Duplication creates an independent document with its tabs, drafts, and annotations.
Trash is a soft delete. Permanent deletion requires confirmation; configured
trash retention can also purge old trashed documents. These operations differ from
[soft-deleting a tab or draft](tabs-and-drafts.md#deleting-drafts).

The TypeScript API is in [db/index.ts](../packages/desktop/src/lib/db/index.ts),
and native document operations are in
[documents.rs](../packages/desktop/src-tauri/src/db/documents.rs). Search behavior
has its own [guide](search.md).

## Navigation and save failures

[navigation.ts](../packages/desktop/src/lib/navigation.ts) owns navigation to the
Library, editor, Version History, and authorship report. The outgoing editor
paths await `flushPersistence()` before navigation. The Library path also releases
the native open-document registration after that flush succeeds.

A failed flush keeps the editor open. Draft and tab switches use the same
persistence boundary through the loader and tab controller. Code that leaves the
editor must preserve this ordering rather than calling the router directly.
