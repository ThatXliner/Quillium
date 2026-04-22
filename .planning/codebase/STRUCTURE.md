# Codebase Structure

**Analysis Date:** 2026-04-16

## Directory Layout

```
Quillium/
├── src/                                    # Frontend TypeScript/SvelteKit application
│   ├── hooks.client.ts                     # Global error handlers, crash backup, PostHog
│   ├── lib/                                # Reusable libraries and components
│   │   ├── ai/                             # AI sidebar, provider, streaming, multi-persona
│   │   │   ├── AISidebar.svelte           # Tab picker (Chat/Feedback/Revise/Context/Readers/Settings)
│   │   │   ├── Chat.svelte                # Chat mode UI
│   │   │   ├── Feedback.svelte            # Feedback mode routing through personas
│   │   │   ├── Revise.svelte              # Revise mode UI
│   │   │   ├── DocumentContext.svelte     # Document context reference display
│   │   │   ├── Readers.svelte             # Persona configuration panel
│   │   │   ├── AISettings.svelte          # Provider/model/API key settings
│   │   │   ├── chatFactory.ts             # Request builders, multi-persona execution
│   │   │   ├── clientStreams.ts           # Stream handlers, mode-specific helpers
│   │   │   ├── provider.ts                # Provider client creation (OpenAI, Anthropic, etc.)
│   │   │   ├── settings.svelte.ts         # AI settings store (reactive, persisted)
│   │   │   └── utils.ts                   # Shared AI helpers
│   │   ├── autoai/                         # AutoAI background review engine
│   │   │   ├── AutoAIWidget.svelte        # Bubble UI + expanded settings panel
│   │   │   ├── AutoAIFace.svelte          # Animated SVG face component
│   │   │   ├── faceAnimation.svelte.ts    # Face state machine and eye tracking
│   │   │   ├── engine.ts                  # Review orchestration, AI calls, dispatch
│   │   │   └── settings.svelte.ts         # AutoAI settings store (reactive, persisted)
│   │   ├── editor/                         # CodeMirror editor, extensions, plugins
│   │   │   ├── Editor.svelte              # Mount point, state sync, document load
│   │   │   ├── extensions.ts              # Complete extension stack (history, annotations, keymaps)
│   │   │   ├── listeners.ts               # updateListener callback, event extraction
│   │   │   ├── replay.ts                  # Event log replay with error handling
│   │   │   ├── restore.ts                 # Crash recovery, annotation re-anchoring
│   │   │   ├── dictionaryPlugin.ts        # Mod-B keymap for dictionary trigger
│   │   │   ├── dictionaryUtils.ts         # Pure dictionary helpers (for testing)
│   │   │   ├── DictionaryPopover.svelte   # Floating dictionary UI
│   │   │   ├── StatusBar.svelte           # Word count, WPM, character count
│   │   │   ├── VersionHistory.svelte      # Snapshot browser, restore, named versions
│   │   │   ├── WordCountOverlay.svelte    # Optional word count overlay
│   │   │   ├── harper/                    # Harper spell-check integration (if enabled)
│   │   │   │   └── (integration files)
│   │   │   ├── plugins/                   # CodeMirror plugins
│   │   │   │   ├── annotations/           # Complete annotation system
│   │   │   │   │   ├── models.ts          # Type defs, factory helpers, type guards
│   │   │   │   │   ├── annotationField.ts # StateField, StateEffects, undo inversion
│   │   │   │   │   ├── utils.ts           # Range mapping, active annotation queries
│   │   │   │   │   ├── diff.ts            # Diff computation for suggestions
│   │   │   │   │   ├── nestedEditor.ts    # Nested editor lifecycle helpers
│   │   │   │   │   ├── commentAi.ts       # AI prompt/stream for comment threads
│   │   │   │   │   ├── revisionModalKeyguard.ts # Prevents double keydown handling
│   │   │   │   │   ├── eventBus.ts        # Typed pub/sub for ViewPlugin → component events
│   │   │   │   │   ├── NestedEditorController.ts # Shared nested editor lifecycle
│   │   │   │   │   ├── index.ts           # Keymaps, ViewPlugins, public API
│   │   │   │   │   ├── Annotations.svelte # Right panel container, card positioning
│   │   │   │   │   ├── Comment.svelte     # Comment card (inline thread display)
│   │   │   │   │   ├── CommentModal.svelte # Full-screen comment thread modal
│   │   │   │   │   ├── PreComment.svelte  # Draft form for empty-thread comment
│   │   │   │   │   ├── Thread.svelte      # Message list inside card/modal
│   │   │   │   │   ├── ThreadMessage.svelte # Single message with inline edit
│   │   │   │   │   ├── Revision.svelte    # Revision card + inline nested editor
│   │   │   │   │   ├── RevisionModal.svelte # Full-screen nested editor overlay, FSM
│   │   │   │   │   ├── Suggestion.svelte  # Suggestion card with diff view
│   │   │   │   │   ├── DiffModal.svelte   # Full-screen diff view overlay
│   │   │   │   │   ├── TutorialGuide.svelte # In-editor tutorial callouts
│   │   │   │   │   ├── default.css        # Highlight CSS classes for all annotation types
│   │   │   │   │   └── (test files .test.ts, .fuzz.test.ts)
│   │   │   │   └── dont-use-for-now-history/ # Experimental (not used)
│   │   │   └── sampleDocument.ts          # Starter document content
│   │   ├── readers/                        # Reader personas system
│   │   │   ├── presets.ts                 # ReaderPersona type, DEFAULT_PERSONAS
│   │   │   ├── prompt.ts                  # buildPersonaPrompt() for system injection
│   │   │   ├── colors.ts                  # Persona avatar color helpers
│   │   │   └── settings.svelte.ts         # Persona store, CRUD, localStorage persistence
│   │   ├── library/                        # Document library and management
│   │   │   ├── DocumentCard.svelte        # Single card in grid
│   │   │   ├── DocumentGrid.svelte        # Grid layout
│   │   │   ├── LibraryTopBar.svelte       # Header + search + actions
│   │   │   ├── PreviewPanel.svelte        # Sidebar preview + rename/operations
│   │   │   ├── EmptyState.svelte          # Placeholder when no documents
│   │   │   └── ContinuePill.svelte        # "Continue writing" shortcut
│   │   ├── db/                             # Database command wrappers (Tauri invoke)
│   │   │   ├── index.ts                   # Typed invoke() wrappers for all Rust commands
│   │   │   ├── types.ts                   # TypeScript mirrors of Rust structs
│   │   │   └── events.ts                  # Event payload types and builders
│   │   ├── debug/                          # Development utilities
│   │   │   ├── DebugPanel.svelte          # Development-only debug overlay
│   │   │   ├── scenarios.ts               # Test scenario loaders
│   │   │   └── store.svelte.ts            # Debug panel visibility state
│   │   ├── settings/                       # App settings UI and configuration
│   │   │   ├── SettingsModal.svelte       # App-level settings overlay
│   │   │   ├── FontGuideModal.svelte      # Font descriptions, samples, guide
│   │   │   └── fonts.ts                   # Canonical FONTS array (source of truth)
│   │   ├── save/                           # Persistence UI
│   │   │   └── Save.svelte                # Save indicator (status badges)
│   │   ├── tutorial/                       # Onboarding flow
│   │   │   ├── Tutorial.svelte            # Overlay modal
│   │   │   └── steps.ts                   # Step definitions
│   │   ├── ui/                             # Reusable UI components
│   │   │   ├── Kbd.svelte                 # Keyboard shortcut display
│   │   │   └── UpdateBanner.svelte        # Auto-update notification
│   │   ├── stats/                          # Stats/analytics (if any)
│   │   │   └── (files)
│   │   ├── changelog.json                 # "What's New" entries by version
│   │   ├── constants.ts                   # App-wide constants (URLs, thresholds)
│   │   ├── errorGuard.ts                  # Suspicious change detection before persist
│   │   ├── ErrorBanner.svelte             # Error/recovery banner UI (crash vs suspicious)
│   │   ├── export.ts                      # Document export (txt, json, md, txt+json)
│   │   ├── navigation.ts                  # goToLibrary() / goToEditor() / goToHistory()
│   │   ├── posthog.ts                     # PostHog initialization and opt-out sync
│   │   ├── settings.svelte.ts             # App settings store (reactive, persisted to localStorage)
│   │   └── stores.ts                      # Global Svelte stores (editorView, annotations, modalStack, etc.)
│   └── routes/                             # SvelteKit file-based routing
│       ├── +layout.svelte                 # Root layout wrapper
│       ├── +layout.ts                     # SvelteKit layout config
│       ├── +page.svelte                   # Editor page (main three-panel layout + modals)
│       ├── history/
│       │   └── +page.svelte               # Version history browser wrapper
│       └── library/
│           └── +page.svelte               # Document library and trash
├── src-tauri/                              # Tauri backend (Rust)
│   ├── src/
│   │   ├── main.rs                        # App entry point
│   │   ├── lib.rs                         # Tauri command registration, menu building
│   │   ├── keychain.rs                    # OS keychain for API key storage
│   │   └── db/                            # SQLite database operations
│   │       ├── mod.rs                     # Module exports, shared types
│   │       ├── schema.rs                  # Schema creation, migrations, WAL setup
│   │       ├── documents.rs               # Document CRUD, metadata, trash
│   │       ├── events.rs                  # Event log append, snapshot thresholds/creation
│   │       └── load.rs                    # State reconstruction (snapshot + replay)
│   └── Cargo.toml                         # Rust dependencies
├── static/                                 # Static assets
│   ├── logo.svg                           # Quill logo (transparent background)
│   └── icon.svg                           # App icon source (hand-crafted with neumorphic design)
├── src-tauri/icons/                        # Platform-specific icons
│   ├── Quillium.png                       # Source PNG (512×512, exported from icon.svg)
│   └── (generated platform icons: .icns, .ico, Windows sizes, iOS, Android)
├── scripts/                                # Utility scripts
│   └── (build scripts, version bumps, screenshots, icon generation)
├── docs/                                   # Documentation
│   ├── omni-reference/                    # Reference docs
│   └── superpowers/                       # GSD framework specs and plans
├── screenshots/                            # App screenshots (generated, not committed)
├── .planning/                              # GSD planning artifacts
│   └── codebase/                          # Codebase analysis (this file!)
├── build/                                  # Production build output (generated)
├── .svelte-kit/                            # SvelteKit build artifacts (generated)
├── ARCHITECTURE.md                         # Complete architecture deep-dive
├── DESIGN.md                               # UX/interaction conceptual model
├── BRANDING.md                             # Brand bible (colors, typography, voice)
├── CLAUDE.md                               # Development guidance (commands, patterns)
├── CONTRIBUTING.md                         # Contribution guidelines
├── package.json                            # npm/bun dependencies (bun is preferred)
├── tsconfig.json                           # TypeScript configuration
├── vite.config.js                          # Vite build config
├── svelte.config.js                        # SvelteKit config
├── vitest.config.ts                        # Unit test config
├── playwright.config.ts                    # E2E test config
├── biome.json                              # Biome linter/formatter config (4-space, 100-char)
└── Cargo.toml                              # Rust workspace config (Tauri)
```

---

## Directory Purposes

**`src/`** — Frontend source root.
- **Contains:** SvelteKit pages, components, libraries, client-side TypeScript
- **Key files:** `hooks.client.ts` (global handlers), `lib/stores.ts` (state), `routes/` (pages)

**`src/lib/`** — Reusable libraries, organized by feature.
- **Purpose:** Shared components and utilities consumed by pages and each other
- **Pattern:** Each feature directory is self-contained (ai, editor, library, etc.) with internal organization. Cross-feature imports are minimal; state passes through global stores.

**`src/lib/editor/`** — CodeMirror editor engine and plugins.
- **Purpose:** All editor state, extensions, listeners, and annotation system
- **Key:** `Editor.svelte` (mount point), `extensions.ts` (full stack), `plugins/annotations/` (entire annotation system)
- **Pattern:** Plugins organized by functionality (annotations is the largest). Test files co-located with source.

**`src/lib/editor/plugins/annotations/`** — Complete annotation system (comments, suggestions, revisions).
- **Purpose:** Non-linear editing model with all related components and state management
- **Key:** `annotationField.ts` (StateField with 3-phase update), `models.ts` (types), `NestedEditorController.ts` (nested editor lifecycle), index.ts (keymaps + plugins)
- **Components:** `Comment.svelte`, `Revision.svelte`, `Suggestion.svelte` (cards), `CommentModal.svelte`, `RevisionModal.svelte`, `DiffModal.svelte` (overlays)

**`src/lib/ai/`** — AI sidebar and provider integration.
- **Purpose:** Chat, feedback, revise modes; multi-persona execution; provider abstraction
- **Key:** `chatFactory.ts` (request builders, multi-persona execution), `clientStreams.ts` (stream handlers), `provider.ts` (client creation)
- **Pattern:** Mode-specific components (Chat.svelte, Feedback.svelte, Revise.svelte) route through factories.

**`src/lib/autoai/`** — AutoAI background review engine.
- **Purpose:** Autonomous AI review, face animation, settings
- **Key:** `engine.ts` (orchestration), `AutoAIWidget.svelte` (UI bubble), `faceAnimation.svelte.ts` (eye tracking FSM)

**`src/lib/db/`** — Tauri invoke() wrappers for database commands.
- **Purpose:** TypeScript interfaces to Rust SQLite operations
- **Key:** `index.ts` (all invoke wrappers), `types.ts` (Rust struct mirrors), `events.ts` (event builders)
- **Pattern:** Every Rust command has a typed TypeScript wrapper. No raw `invoke()` calls in components.

**`src/lib/library/`** — Document library UI.
- **Purpose:** Grid, search, document operations (create, rename, trash, delete)
- **Components:** `DocumentGrid.svelte`, `DocumentCard.svelte`, `PreviewPanel.svelte`

**`src/lib/readers/`** — Reader personas configuration.
- **Purpose:** Multi-persona feedback system, persona settings, persona list CRUD
- **Key:** `presets.ts` (DEFAULT_PERSONAS), `settings.svelte.ts` (store + persistence), `prompt.ts` (system prompt building)

**`src/routes/`** — SvelteKit file-based routes.
- **Purpose:** Page-level entry points
- **Structure:** `+page.svelte` (editor), `library/+page.svelte` (document grid), `history/+page.svelte` (version history)

**`src-tauri/src/`** — Rust backend.
- **Purpose:** Database operations, native menu, keychain, Tauri IPC handlers
- **Key:** `lib.rs` (command registration + menu), `db/` (schema + queries)

**`src-tauri/src/db/`** — SQLite database layer.
- **Purpose:** Schema, document/event CRUD, snapshot management, state reconstruction
- **Key:** `schema.rs` (schema + migrations), `events.rs` (append-only log), `documents.rs` (metadata), `load.rs` (replay)

**`docs/`** — Project documentation.
- **Contains:** `omni-reference/` (guides), `superpowers/` (GSD specs and plans)

**`.planning/codebase/`** — Codebase analysis documents.
- **Contains:** ARCHITECTURE.md, STRUCTURE.md (this file), CONVENTIONS.md, TESTING.md, CONCERNS.md, STACK.md, INTEGRATIONS.md (written by agents)

---

## Key File Locations

**Entry Points:**
- `src/routes/+page.svelte`: Main editor layout (three panels + modal stack)
- `src/routes/library/+page.svelte`: Document library grid
- `src/routes/history/+page.svelte`: Version history browser
- `src/lib/editor/Editor.svelte`: CodeMirror mount and state sync

**Configuration:**
- `package.json`: Dependencies (bun is package manager of choice)
- `tsconfig.json`: TypeScript config
- `vite.config.js`: Vite build, SvelteKit pre-rendering
- `svelte.config.js`: SvelteKit config (adapter, preprocess)
- `biome.json`: Linter/formatter (4-space, 100-char line width)
- `vitest.config.ts`: Unit test runner
- `playwright.config.ts`: E2E test runner
- `src-tauri/Cargo.toml`: Rust dependencies

**Core Logic:**
- `src/lib/editor/plugins/annotations/annotationField.ts`: Annotation state management (StateField, 3-phase update, undo)
- `src/lib/stores.ts`: Global Svelte stores (editorView, annotations, documentContent, modalStack, etc.)
- `src/lib/editor/listeners.ts`: updateListener callback, event extraction, persistence trigger
- `src-tauri/src/db/events.rs`: Event log append, snapshot thresholds
- `src-tauri/src/db/load.rs`: State reconstruction (snapshot + event replay)

**Persistence & Recovery:**
- `src/lib/db/index.ts`: TypeScript invoke() wrappers
- `src/lib/editor/replay.ts`: Event log replay with error handling
- `src/lib/editor/restore.ts`: Crash recovery, annotation re-anchoring
- `src/lib/errorGuard.ts`: Suspicious change detection

**AI Integration:**
- `src/lib/ai/chatFactory.ts`: Request builders, multi-persona execution, tool dispatch
- `src/lib/ai/provider.ts`: Provider client creation
- `src/lib/autoai/engine.ts`: AutoAI orchestration

---

## Naming Conventions

**Files:**
- **Svelte components:** PascalCase.svelte (e.g., `Editor.svelte`, `Comment.svelte`)
- **TypeScript utilities:** camelCase.ts (e.g., `listeners.ts`, `chatFactory.ts`)
- **Store files:** camelCase.svelte.ts (e.g., `settings.svelte.ts`, `faceAnimation.svelte.ts`) — contains Svelte 5 `$state`, `$derived`
- **Test files:** basename.test.ts or basename.fuzz.test.ts
- **Config files:** Standard names (tsconfig.json, vite.config.js, etc.)

**Directories:**
- **Feature directories:** snake_case plural when needed (e.g., `annotations/`, `readers/`)
- **Component grouping:** By feature (ai/, editor/, library/, etc.)

**Code Elements:**
- **Functions:** camelCase (e.g., `createComment()`, `setActiveRevisionVersion()`)
- **Variables/constants:** camelCase for vars, UPPER_SNAKE_CASE for constants (e.g., `STORAGE_WARN_BYTES`, `annotationField`)
- **Types:** PascalCase (e.g., `RevisionAnnotation`, `ReaderPersona`, `EditorState`)
- **Stores:** camelCase (e.g., `$annotations`, `$documentContent`, `$modalStack`)

**CSS Classes:**
- **CodeMirror decorations:** `.cm-{type}` and `.cm-{type}-active` (e.g., `.cm-comment`, `.cm-revision-active`)
- **Annotation highlight:** CSS in `src/lib/editor/plugins/annotations/default.css`

---

## Where to Add New Code

**New Feature (e.g., a new AI mode like "Brainstorm"):**

1. **Component:** Create `src/lib/ai/Brainstorm.svelte`
   - Route through the same pattern as Chat.svelte / Feedback.svelte
   - Import stream builder from chatFactory.ts
   - Dispatch annotation creation commands via existing factories

2. **Helper:** Add builder to `src/lib/ai/chatFactory.ts`
   - Export `streamBrainstorm(options)` following the pattern of `streamChat()`, etc.
   - Inject system prompt + context
   - Return streaming response

3. **Settings:** Extend `AISettings.svelte` if brainstorm has unique settings
   - Add field to `src/lib/ai/settings.svelte.ts` store

4. **Events:** Add PostHog event to `src/lib/posthog.ts` + throughout code
   - Follow existing `ai_chat_message_sent` pattern

5. **Tests:** Add `Brainstorm.test.ts` co-located with component

**New Annotation Type (e.g., "Bookmark"):**

1. **Model:** Add to `src/lib/editor/plugins/annotations/models.ts`
   - Define `BookmarkAnnotation` type
   - Add factory `createBookmark()` helper
   - Add type guard `isAnnotationOfType(annotation, "bookmark")`

2. **StateField Logic:** Update `src/lib/editor/plugins/annotations/annotationField.ts`
   - Add handling in Phase 2 (StateEffect branch)
   - Add undo inversion in `invertedAnnotationFieldEffects`
   - Handle Phase 3 if needed (unlikely for bookmark)

3. **Decoration:** Update `src/lib/editor/plugins/annotations/index.ts`
   - Add CSS class to `annotationDecorations` ViewPlugin for `.cm-bookmark`

4. **UI Component:** Create `src/lib/editor/plugins/annotations/Bookmark.svelte`
   - Render in `Annotations.svelte` right panel alongside Comment/Revision cards
   - Add card + modal if needed

5. **Keymap:** Add shortcut to `src/lib/editor/plugins/annotations/index.ts`
   - e.g., Mod-Alt-B for bookmark

6. **CSS:** Add highlight colors to `src/lib/editor/plugins/annotations/default.css`

7. **Tests:** Add `Bookmark.test.ts` in same directory

**New Utility:**

- If it's editor-related: `src/lib/editor/newUtility.ts`
- If it's general: `src/lib/newUtility.ts`
- If it's test-specific: co-locate in same directory as what it tests

**New Settings:**

- **App setting:** Add to `src/lib/settings.svelte.ts` (stored in localStorage)
  - Also add UI to `src/lib/settings/SettingsModal.svelte`
- **AI setting:** Add to `src/lib/ai/settings.svelte.ts` (stored in localStorage)
  - Also add UI to `src/lib/ai/AISettings.svelte`
- **AutoAI setting:** Add to `src/lib/autoai/settings.svelte.ts` (stored in localStorage)
  - Also add UI to `src/lib/autoai/AutoAIWidget.svelte`
- **Persona setting:** Persona list is in `src/lib/readers/settings.svelte.ts`

**New Database Command (Rust Tauri):**

1. **Rust implementation:** `src-tauri/src/lib.rs` or `src-tauri/src/db/*.rs`
   - Implement the command handler function
   - Register in `#[command]` macro

2. **TypeScript wrapper:** `src/lib/db/index.ts`
   - Export typed `invoke("command_name", { ... })`

3. **Type definitions:** `src/lib/db/types.ts` (if struct definitions needed)

**New Test File:**

- **Unit test:** `src/lib/componentOrUtility.test.ts` co-located with source
  - Use Vitest
  - Import test helpers if needed (e.g., `src/lib/editor/plugins/annotations/testHelpers.ts`)

- **Fuzz test:** `src/lib/editor/plugins/annotations/annotations.fuzz.test.ts`
  - Use `@fast-check/vitest` for property-based testing
  - Pattern: `describe("property", () => { fc.assert(fc.asyncProperty(...)) })`

- **E2E test:** `e2e/newFlow.spec.ts` (if directory exists; else in playwright config)
  - Use Playwright
  - Import fixtures from playwright.config.ts if defined

---

## Special Directories

**`build/`** — Production build output.
- **Generated:** Yes (by `bun run build`)
- **Committed:** No
- **When needed:** Not typically read by developers; used by Tauri build process

**`.svelte-kit/`** — SvelteKit build artifacts.
- **Generated:** Yes (by SvelteKit during dev/build)
- **Committed:** No
- **Contains:** Type stubs, pre-generated routes, build cache

**`node_modules/`** — npm/bun dependencies.
- **Generated:** Yes (by bun install)
- **Committed:** No (use bun.lock instead)

**`static/`** — Static assets.
- **Generated:** No (hand-crafted)
- **Committed:** Yes
- **Purpose:** Logo, icon, fonts, public assets

**`src-tauri/icons/`** — Platform-specific app icons.
- **Generated:** Mostly (by `bun run icons` from `Quillium.png`)
- **Committed:** Yes (regenerate when `static/icon.svg` changes)
- **Manual steps:** Re-export `icon.svg` to `Quillium.png` (via browser or Inkscape), then run `bun run icons`

**`.planning/`** — GSD planning artifacts.
- **Generated:** Partially (codebase maps by agents, plans/specs by user)
- **Committed:** Yes
- **Purpose:** Persistent project knowledge for Claude Code workflows

**`docs/superpowers/`** — GSD framework specs and plans.
- **Generated:** No (user-created phase specs)
- **Committed:** Yes
- **Purpose:** Implementation guidance for specific features

**`screenshots/`** — App screenshots.
- **Generated:** Yes (by `bun run screenshots`)
- **Committed:** No
- **Purpose:** Documentation, marketing

---

## How to Navigate the Codebase

**To find the editor:** Start at `src/lib/editor/Editor.svelte`. This is the mount point for CodeMirror. It handles:
- Loading document state via `loadDocumentState()`
- Creating the EditorView
- Setting up the `updateListener` callback
- Syncing to Svelte stores

**To find annotation logic:** `src/lib/editor/plugins/annotations/` is everything.
- Types and factories: `models.ts`
- StateField (the core): `annotationField.ts`
- UI components: `Comment.svelte`, `Revision.svelte`, etc.
- Nested editor lifecycle: `NestedEditorController.ts`
- Keymaps and ViewPlugins: `index.ts`

**To find AI features:** `src/lib/ai/` is AI sidebar + integration; `src/lib/autoai/` is background review.
- Multi-persona execution: `src/lib/ai/chatFactory.ts`
- Stream handlers: `src/lib/ai/clientStreams.ts`
- Reader personas: `src/lib/readers/presets.ts` and `settings.svelte.ts`

**To find persistence logic:** Three layers:
- Frontend: `src/lib/editor/listeners.ts` (triggers append), `src/lib/editor/replay.ts` (loads)
- Bridge: `src/lib/db/index.ts` (Tauri wrappers)
- Rust: `src-tauri/src/db/events.rs` (append), `load.rs` (reconstruction)

**To find state management:** `src/lib/stores.ts` is the global hub. Check the store definitions there first. For feature-specific stores, look in subdirectories:
- `src/lib/settings.svelte.ts` (app settings)
- `src/lib/ai/settings.svelte.ts` (AI settings)
- `src/lib/readers/settings.svelte.ts` (personas)
- `src/lib/autoai/settings.svelte.ts` (AutoAI settings)

**To find UI components:** Navigate to the feature directory:
- Editor UI: `src/lib/editor/`
- AI UI: `src/lib/ai/`
- Library UI: `src/lib/library/`
- Annotations UI: `src/lib/editor/plugins/annotations/`

**To find tests:** Test files co-locate with source, with `.test.ts` or `.fuzz.test.ts` suffix. Run via:
- `bun run test:run` (single run)
- `bun run test` (watch mode)
- `bun run test:e2e` or `bun run test:e2e:headed` (E2E)

---

*Structure analysis: 2026-04-16*
