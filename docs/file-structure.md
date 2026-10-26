# Code map

Use this page to find the implementation for a task. Paths link directly to code;
for the relationships between these pieces, read the
[architecture walkthrough](architecture-overview.md).

## Package boundaries

| Location | Owns |
|---|---|
| [packages/desktop/src](../packages/desktop/src/) | Desktop SvelteKit app |
| [packages/desktop/src-tauri/src](../packages/desktop/src-tauri/src/) | Rust commands and local SQLite storage |
| [packages/share/src](../packages/share/src/) | Shared annotation state, UI, and wire contracts |
| [packages/landing/src](../packages/landing/src/) | Website, auth-link handling, and public preview routes |
| [packages/relay/src](../packages/relay/src/) | Live Room WebSocket service |
| [packages/e2e](../packages/e2e/README.md) | Cross-package and service-backed tests |
| [supabase](../supabase/) | Omni database configuration and migrations |

Run dependency installs from the root. See [the monorepo guide](monorepo.md) for
which dependencies and capabilities may cross these boundaries.

## Open a document and mount the editor

Read these files in order to follow desktop startup:

1. [src/routes/+page.svelte](../packages/desktop/src/routes/+page.svelte) mounts
   the workspace and app-wide overlays.
2. [Editor.svelte](../packages/desktop/src/lib/editor/Editor.svelte) connects the
   workspace, CodeMirror instance, and Svelte mirrors.
3. [documentLoader.ts](../packages/desktop/src/lib/editor/documentLoader.ts)
   coordinates document/draft loading and switching.
4. [extensions.ts](../packages/desktop/src/lib/editor/extensions.ts) assembles
   the editable extension stack and saved fields.
5. [listeners.ts](../packages/desktop/src/lib/editor/listeners.ts) registers
   persistence and other update listeners.

Other pages live under desktop [routes](../packages/desktop/src/routes/), including
Library, Version History, and authorship playback. [navigation.ts](../packages/desktop/src/lib/navigation.ts)
coordinates page transitions. The shared reactive values are in
[stores.ts](../packages/desktop/src/lib/stores.ts).

## Change annotations or revision behavior

| Task | Start here |
|---|---|
| Types, schemas, factories, type guards, version identity | [Shared models.ts](../packages/share/src/core/models.ts) |
| Annotation reducer, effects, commands, undo inversion | [Shared annotationField.ts](../packages/share/src/core/annotationField.ts) |
| Linked revision-version groups | [Shared versionGroupField.ts](../packages/share/src/core/versionGroupField.ts) |
| Shared range and selection queries | [Shared utils.ts](../packages/share/src/core/utils.ts) |
| Desktop commands, keymaps, view plugins | [Desktop annotations/index.ts](../packages/desktop/src/lib/editor/plugins/annotations/index.ts) |
| Editable cards and modals | [Desktop annotation adapters](../packages/desktop/src/lib/editor/plugins/annotations/) |
| Nested editor lifecycle and parent synchronization | [NestedEditorController.ts](../packages/desktop/src/lib/editor/plugins/annotations/NestedEditorController.ts) |
| Nested coordinate translation and parent undo | [nestedEditor.ts](../packages/desktop/src/lib/editor/plugins/annotations/nestedEditor.ts) |
| Shared card visuals and threads | [share/src/cards](../packages/share/src/cards/) |
| Shared modal and annotation-column layout | [share/src/modals](../packages/share/src/modals/), [share/src/layout](../packages/share/src/layout/) |
| Read-only editor orchestration | [ReadonlyEditorHost.svelte](../packages/share/src/ReadonlyEditorHost.svelte) |

Desktop `models.ts` and `annotationField.ts` only re-export the shared
implementations. Put core changes in the shared files above. Read
[annotations](annotations.md), [nested editors](nested-editors.md), or
[view plugins](view-plugins.md) before changing their invariants.

## Save, load, recover, and browse history

| Task | Start here |
|---|---|
| Typed calls into Rust | [db/index.ts](../packages/desktop/src/lib/db/index.ts) |
| Event payload types and construction | [db/events.ts](../packages/desktop/src/lib/db/events.ts) |
| Transaction replay | [editor/replay.ts](../packages/desktop/src/lib/editor/replay.ts) |
| Persisted undo serialization | [editor/persistentHistory.ts](../packages/desktop/src/lib/editor/persistentHistory.ts) |
| SQLite setup and schema evolution | [db/schema.rs](../packages/desktop/src-tauri/src/db/schema.rs), [db/migrations.rs](../packages/desktop/src-tauri/src/db/migrations.rs) |
| Events, snapshots, state loading | [db/events.rs](../packages/desktop/src-tauri/src/db/events.rs), [db/load.rs](../packages/desktop/src-tauri/src/db/load.rs) |
| Document and tab/draft operations | [db/documents.rs](../packages/desktop/src-tauri/src/db/documents.rs), [db/tabs.rs](../packages/desktop/src-tauri/src/db/tabs.rs) |
| Draft navigation UI and state | [tabDrafts.svelte.ts](../packages/desktop/src/lib/editor/tabDrafts.svelte.ts), [DraftTreePanel.svelte](../packages/desktop/src/lib/editor/DraftTreePanel.svelte) |
| Historical browsing | [VersionHistory.svelte](../packages/desktop/src/lib/editor/VersionHistory.svelte), [editor/history](../packages/desktop/src/lib/editor/history/) |
| Suspicious edits and recovery | [errorGuard.ts](../packages/desktop/src/lib/errorGuard.ts), [editor/restore.ts](../packages/desktop/src/lib/editor/restore.ts) |

Read [persistence](persistence.md) for content history and
[tabs and drafts](tabs-and-drafts.md) for document structure.

## Work on a feature

| Feature | Code | Guide |
|---|---|---|
| AI requests | [ai/chatFactory.ts](../packages/desktop/src/lib/ai/chatFactory.ts), [ai/clientStreams.ts](../packages/desktop/src/lib/ai/clientStreams.ts) | [AI pipeline](ai-sidebar.md) |
| AI providers and connections | [ai/provider.ts](../packages/desktop/src/lib/ai/provider.ts), [ai/settings.svelte.ts](../packages/desktop/src/lib/ai/settings.svelte.ts) | [AI pipeline](ai-sidebar.md) |
| Background reviews | [autoai/engine.ts](../packages/desktop/src/lib/autoai/engine.ts) | [AutoAI](autoai.md) |
| Reader personas | [readers](../packages/desktop/src/lib/readers/) | [Reader personas](reader-personas.md) |
| Live editing and publishing | [collab](../packages/desktop/src/lib/collab/), [shared contract](../packages/share/src/collab-contract/) | [Collaboration](collaboration.md) |
| Sign-in and account UI | [auth](../packages/desktop/src/lib/auth/) | [Auth](auth.md) |
| Library and document search | [library](../packages/desktop/src/lib/library/), [db/search.rs](../packages/desktop/src-tauri/src/db/search.rs) | [Library](library.md), [search](search.md) |
| Authorship playback and export | [provenance](../packages/desktop/src/lib/provenance/) | [Provenance](provenance.md) |
| Preferences | [settings.svelte.ts](../packages/desktop/src/lib/settings.svelte.ts), [settings](../packages/desktop/src/lib/settings/) | [Settings](settings.md) |
| Native commands and registration | [src-tauri/src/lib.rs](../packages/desktop/src-tauri/src/lib.rs) | [Native integration](native-integration.md) |
| Analytics initialization and privacy | [posthog.ts](../packages/desktop/src/lib/posthog.ts), [hooks.client.ts](../packages/desktop/src/hooks.client.ts) | [PostHog events](posthog-events.md) |

## Find tests and captures

Desktop tests live in [packages/desktop/tests](../packages/desktop/tests/).
Start with [annotationField.test.ts](../packages/desktop/tests/lib/editor/plugins/annotations/annotationField.test.ts)
for state and undo examples. Browser scenarios live in
[tests/e2e](../packages/desktop/tests/e2e/). Collaboration also has
[co-located fuzz tests](../packages/desktop/src/lib/collab/fuzz/README.md).

[CONTRIBUTING.md](../CONTRIBUTING.md#verify-your-change) explains which checks to
run. [Visual regression](visual-regression.md) covers browser baselines;
[the changelog guide](changelog.md) covers feature captures.

To find files outside this map, search from the root:

```bash
rg --files packages/desktop/src/lib
rg -n 'syncStoresToEditorState|translateAndDispatch' packages/desktop/src
```
