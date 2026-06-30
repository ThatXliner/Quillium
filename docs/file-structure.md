# File Structure

Complete source tree with file purposes.

## Frontend (`src/`)

```
src/
├── hooks.client.ts            # Global error handlers, crash backup, PostHog exception capture
├── lib/
│   ├── ai/
│   │   ├── AISidebar.svelte   # Tab picker (Chat / Feedback / Revise / Context / Readers / Settings)
│   │   ├── AISettings.svelte  # Provider/model configuration
│   │   ├── Chat.svelte        # General AI chat
│   │   ├── DocumentContext.svelte # Context reference display
│   │   ├── Feedback.svelte    # AI feedback on document or selection
│   │   ├── Readers.svelte     # Reader persona configuration panel
│   │   ├── Revise.svelte      # AI-powered revision generation
│   │   ├── chatFactory.ts     # Shared AI request/streaming helpers
│   │   ├── clientStreams.ts   # Streaming response handling
│   │   ├── provider.ts        # Provider-agnostic client setup
│   │   ├── settings.svelte.ts # AI settings (reactive, persisted)
│   │   └── utils.ts           # Shared AI utilities
│   ├── auth/
│   │   ├── AuthButton.svelte    # Top-right auth/profile button
│   │   ├── AuthModal.svelte     # Sign in modal
│   │   ├── AvatarDropdown.svelte # Dropdown menu for logged-in user
│   │   ├── NameEntryModal.svelte # Anonymous user display name prompt
│   │   ├── ProfileModal.svelte   # Logged-in profile/settings modal
│   │   ├── auth.svelte.ts       # Reactive auth state store (Svelte 5 $state runes)
│   │   ├── avatarUtils.ts       # initials() and avatarColor() helpers
│   │   ├── schemas.ts           # Zod schemas for auth forms
│   │   ├── supabase.ts          # Supabase client singleton
│   │   └── index.ts             # Re-exports for public API
│   ├── autoai/
│   │   ├── AutoAIFace.svelte         # Animated face SVG component
│   │   ├── AutoAIWidget.svelte       # Bubble + expanded panel UI
│   │   ├── faceAnimation.svelte.ts   # Eye tracking + sleep/wake state
│   │   ├── engine.ts            # Review orchestration, AI calls
│   │   └── settings.svelte.ts   # AutoAI settings store
│   ├── collab/
│   │   ├── GoLiveButton.svelte    # Top-right Share button + modal
│   │   ├── annotationSchema.ts    # CM ↔ Yjs bidirectional converters
│   │   ├── awareness.ts           # Remote cursor rendering, follow mode
│   │   ├── collabPlugin.ts        # CM extension helpers
│   │   ├── index.ts               # Public API: enableCollab, disableCollab
│   │   ├── protocol.ts            # Relay protocol constants
│   │   ├── relativePosition.ts    # RelativePosition utilities
│   │   ├── share.ts               # Share link utilities
│   │   ├── sharePayload.ts        # Share payload encoding/decoding
│   │   ├── socket.ts              # Relay socket helpers
│   │   ├── store.ts               # Collab Svelte stores
│   │   ├── types.ts               # CollabSession, awareness types
│   │   ├── yjsAnnotations.ts      # Y.Map-based annotation sync
│   │   ├── yjsBinding.ts          # CodeMirror ↔ Y.Text binding
│   │   ├── yjsProvider.ts         # Y.Doc + WebsocketProvider setup
│   │   ├── yjsUndo.ts             # Unified undo stack via Y.UndoManager
│   │   ├── fuzz/                  # Fuzz testing for sync
│   │   ├── probes/                # Sync probes for debugging
│   │   └── test-helpers/
│   │       └── twoPeerHarness.ts  # Two-peer test harness
│   ├── db/
│   │   ├── index.ts           # Typed invoke() wrappers for Rust commands
│   │   ├── types.ts           # TypeScript mirrors of Rust structs
│   │   └── events.ts          # Event payload types and builders
│   ├── debug/
│   │   ├── DebugPanel.svelte  # Development-only debug overlay
│   │   ├── scenarios.ts       # Canned test scenarios
│   │   └── store.svelte.ts    # Debug panel visibility state
│   ├── editor/
│   │   ├── Editor.svelte      # CodeMirror mount point + state sync
│   │   ├── extensions.ts      # Full CodeMirror extension stack
│   │   ├── listeners.ts       # Persistence + change listeners
│   │   ├── replay.ts          # Event log replay for state reconstruction
│   │   ├── restore.ts         # Crash-recovery restore with re-anchoring
│   │   ├── dictionaryPlugin.ts # Mod-D keymap for dictionary trigger
│   │   ├── dictionaryUtils.ts # Pure helper functions for dictionary
│   │   ├── DictionaryPopover.svelte # Floating dictionary/thesaurus UI
│   │   ├── markdownFormatting.ts # Markdown keyboard shortcuts (bold, italic, etc.)
│   │   ├── richMarkdown.ts    # Rich markdown rendering (hides syntax)
│   │   ├── StatusBar.svelte   # Word count, WPM, character count
│   │   ├── VersionHistory.svelte # Full-screen snapshot browser
│   │   ├── WordCountOverlay.svelte # Bottom-left word/char pill
│   │   ├── sampleDocument.ts   # Seed content for first-run
│   │   ├── harper/
│   │   │   ├── harperLinter.ts  # Grammar-check integration
│   │   │   ├── lint.ts          # Harper issue translation
│   │   │   ├── lintKindColor.ts # Severity/color mapping
│   │   │   ├── HarperTooltip.svelte # Hover tooltip
│   │   │   └── harper.css       # Grammar-check styling
│   │   └── plugins/
│   │       └── annotations/
│   │           ├── models.ts          # Type defs, factory helpers, type guards
│   │           ├── annotationField.ts # StateField + StateEffects + undo
│   │           ├── utils.ts           # Range mapping, active annotation queries
│   │           ├── diff.ts            # Diff computation for suggestions
│   │           ├── nestedEditor.ts    # Nested editor lifecycle helpers
│   │           ├── commentAi.ts       # AI prompt/stream helpers for threads
│   │           ├── revisionModalKeyguard.ts # Modal shortcut conflict guard
│   │           ├── NestedEditorController.ts # Shared lifecycle/sync
│   │           ├── index.ts           # Keybindings, ViewPlugins, public API
│   │           ├── Annotations.svelte # Right panel container
│   │           ├── Comment.svelte     # Comment card
│   │           ├── CommentModal.svelte # Full-screen comment modal
│   │           ├── DiffModal.svelte   # Full-screen diff view
│   │           ├── PreComment.svelte  # Draft form for new comment
│   │           ├── Revision.svelte    # Revision card + inline editor
│   │           ├── RevisionModal.svelte # Full-screen nested editor
│   │           ├── Suggestion.svelte  # Suggestion card with diff
│   │           ├── Thread.svelte      # Message list inside card
│   │           ├── ThreadMessage.svelte # Single message
│   │           ├── TutorialGuide.svelte # In-editor tutorial callouts
│   │           └── default.css        # Highlight CSS classes
│   ├── events/
│   │   ├── createEventBus.ts    # Generic typed event bus primitive
│   │   ├── appEventBus.ts       # App-wide event channels
│   │   └── annotationEventBus.ts # Annotation-specific event bus
│   ├── readers/
│   │   ├── colors.ts            # Hex → tint helpers for personas
│   │   ├── presets.ts           # ReaderPersona type, DEFAULT_PERSONAS
│   │   ├── prompt.ts            # buildPersonaPrompt()
│   │   └── settings.svelte.ts   # Persona list store, persistence
│   ├── library/
│   │   ├── ContinuePill.svelte  # "Continue writing" shortcut
│   │   ├── DocumentCard.svelte  # Single document card
│   │   ├── DocumentGrid.svelte  # Grid layout
│   │   ├── EmptyState.svelte    # Empty library placeholder
│   │   ├── LibraryTopBar.svelte # Library page header
│   │   ├── PreviewPanel.svelte  # Document preview sidebar
│   │   └── tags.ts              # Document tagging system
│   ├── save/
│   │   └── Save.svelte          # Save indicator
│   ├── provenance/
│   │   ├── PlaybackViewer.svelte # Authorship/provenance playback UI
│   │   ├── classify.ts          # Event-origin classifier
│   │   ├── export.ts            # Authorship report export
│   │   └── report.ts            # Authorship report builder
│   ├── settings/
│   │   ├── SettingsModal.svelte # App-level settings overlay
│   │   ├── FontGuideModal.svelte # Font guide with samples
│   │   └── fonts.ts             # Canonical font list
│   ├── stats/
│   │   ├── compute.ts           # Writing-stats calculations
│   │   ├── StatsModal.svelte    # Full statistics modal
│   │   └── StatsInfoModal.svelte # Explainer modal
│   ├── tutorial/
│   │   ├── Tutorial.svelte      # Onboarding tutorial
│   │   └── steps.ts             # Tutorial step definitions
│   ├── ui/
│   │   ├── BetaDisclaimer.svelte # First-run beta terms
│   │   ├── BottomLeftStack.svelte # Fixed bottom-left container
│   │   ├── ChangelogModal.svelte # "What's New" overlay
│   │   ├── Kbd.svelte           # Keyboard shortcut display
│   │   ├── LicensesModal.svelte # Open-source licenses
│   │   ├── PrivacyNudgeToast.svelte # Analytics reminder
│   │   └── UpdateBanner.svelte  # Auto-update notification
│   ├── updater/
│   │   ├── schedule.ts          # Update check rate limiting
│   │   └── errors.ts            # Update error handling
│   ├── constants.ts             # App-wide constants
│   ├── errorGuard.ts            # Suspicious change detection
│   ├── ErrorBanner.svelte       # Error/recovery banner UI
│   ├── export.ts                # Document export (txt, json, md, pdf)
│   ├── navigation.ts            # Page transitions
│   ├── posthog.ts               # PostHog analytics init
│   ├── stores.ts                # Global Svelte stores
│   ├── settings.svelte.ts       # App settings (reactive)
│   └── changelog.json           # Version changelog data
├── routes/
│   ├── +layout.svelte           # Root layout
│   ├── +layout.ts               # SvelteKit layout config
│   ├── +page.svelte             # Editor page
│   ├── library/
│   │   └── +page.svelte         # Library page
│   ├── history/
│   │   └── +page.svelte         # Version history page
│   └── authorship/
│       └── +page.svelte         # Authorship/provenance playback page
```

## Tauri Backend (`src-tauri/src/`)

```
src-tauri/src/
├── lib.rs                       # Command registration + native app menu
├── main.rs                      # Entry point
├── keychain.rs                  # OS keychain for API key storage
├── pdf_export.rs                # PDF export with annotation cards
└── db/
    ├── mod.rs                   # Re-exports and shared types
    ├── schema.rs                # DB open + WAL pragmas; runs migrations
    ├── migrations.rs            # Versioned migration framework (PRAGMA user_version)
    ├── documents.rs             # Document CRUD, trash, drafts
    ├── events.rs                # Event log append, snapshot CRUD
    ├── tabs.rs                  # Tab CRUD, iterate/branch, run relocking
    ├── search.rs                # FTS5 + semantic search (query, KNN, RRF)
    └── load.rs                  # State reconstruction from snapshots
```

## Icons and Logo

| File | Purpose |
|------|---------|
| `static/logo.svg` | Quill mark on transparent background |
| `static/icon.svg` | Source of truth for app icon |
| `src-tauri/icons/Quillium.png` | Pre-rendered 512×512 PNG |
| `src-tauri/icons/*` | Generated platform icons |

To regenerate icons: `bun run icons`
