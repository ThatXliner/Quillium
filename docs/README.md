# Developer guide

Quillium lets a writer keep several versions of a passage and edit them inside
the surrounding prose. Most of the codebase exists to make that behave like one
document, including selection, undo, saving, and collaboration.

## Start here

1. [Run the app](quickstart.md). Create a document, edit a revision, and reopen it.
2. [Follow an edit through the architecture](architecture-overview.md). Learn
   where state lives and how the desktop, shared UI, and relay fit together.
3. [Understand the CodeMirror/Svelte boundary](state-management.md). This explains
   why a visible UI change can fail to change the saved document.
4. Pick a system below. Use the [code map](file-structure.md) to jump into its
   implementation and [CONTRIBUTING.md](../CONTRIBUTING.md) to verify your change.

You do not need to read every system guide before contributing. The
[glossary](../CONTEXT.md) distinguishes draft, revision, version, and snapshot;
keep it nearby as you read. [DESIGN.md](../DESIGN.md) explains the intended writing
experience, and [BRANDING.md](../BRANDING.md) covers visual design and copy.

## Choose a system

| What you are trying to understand or change | Read |
|---|---|
| Comments, suggestions, alternate versions, annotation undo | [Annotations](annotations.md) |
| Editing inside a revision card or modal | [Nested editors](nested-editors.md) |
| Highlights, cursor boundaries, collapsed revisions | [View plugins](view-plugins.md) |
| Save/load, event replay, SQLite migrations, persisted undo | [Persistence](persistence.md) |
| Tabs, draft runs, iteration, branching, locks | [Tabs and drafts](tabs-and-drafts.md) |
| Document grid, navigation, trash | [Library](library.md) |
| Full-text and semantic search | [Search](search.md) |
| Historical snapshots, document activity, restore | [Version history](version-history.md) |
| Suspicious edits, recovery, error banners | [Error handling](error-handling.md) |
| Live Rooms, owner/joiner behavior, Web Preview publishing | [Collaboration](collaboration.md) |
| Accounts, sign-in, guest sessions | [Auth](auth.md) |
| AI context, providers, streaming, tools, cancellation | [AI request pipeline](ai-sidebar.md) |
| Background review scheduling and status | [AutoAI](autoai.md) |
| College application prompts, presets, and tab briefs | [College applications](college-applications.md) |
| Feedback from multiple reader perspectives | [Reader personas](reader-personas.md) |
| Authorship classification, playback, report export | [Provenance](provenance.md) |
| Preferences and fonts | [Settings](settings.md) |
| Native menus, keychain, updater, exports | [Native integration](native-integration.md) |

## Reference

| Question | Read |
|---|---|
| Where does this code belong? | [Code map](file-structure.md), [package boundaries](monorepo.md) |
| Why was it designed this way? | [Architecture decision records](adr/README.md) |
| How do I run the browser suites and review image differences? | [Visual regression and CI](visual-regression.md), [cross-package E2E](../packages/e2e/README.md) |
| Which shortcuts exist? | [Keybindings](keybindings.md) |
| How do I add or find analytics events? | [PostHog events](posthog-events.md) |
| How do I write release notes and capture a feature? | [Changelog guide](changelog.md) |
| Which constraints should I check before investigating? | [Known limitations](known-limitations.md) |
| Where are proposed changes tracked? | [GitHub Issues](https://github.com/ThatXliner/Quillium/issues) |

## Keep the docs useful

Put setup steps in the quickstart, contribution rules in CONTRIBUTING.md, and
implementation details in the owning system guide. Link between them instead of
copying a command catalog or source tree into each page. Explain the user action
and state ownership before introducing implementation names.

When behavior changes, update the affected guide and its source links. Add a new
ADR when a resolved architectural decision needs a durable explanation. The
older [decision log](../DECISION.md) and [refactoring suggestions](refactoring-suggestions.md)
provide historical context; verify their claims against current code and ADRs.
