# Contributing to Quillium

Thank you for your interest in contributing to Quillium! This guide will help you get
started with development and understand our contribution process.

## Getting Started

### Prerequisites

Before you begin, ensure you have the following installed:
- **Bun** package manager and JavaScript runtime
- **Rust toolchain** (for Tauri desktop builds)
- **Git** for version control

### Development Setup

1. **Fork and Clone**
   ```bash
   git clone https://github.com/yourusername/Quillium.git
   cd Quillium
   ```

2. **Install Dependencies**
   ```bash
   bun install
   ```

3. **Environment Setup**

   Create a `.env.local` file in `packages/desktop`:
   ```bash
   # AI features (optional — app works without these)
   OPENAI_API_KEY=your_openai_api_key_here

   # Analytics (optional — app works without these)
   PUBLIC_POSTHOG_KEY=your_posthog_project_api_key
   PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
   ```

   > **Note**: Both AI and analytics features are optional for most development work.

   Package-specific env examples live beside the package that consumes them:
   `packages/desktop/.env.example`, `packages/landing/.env.example`, and
   `packages/relay/.env.example`.

4. **Start Development Server**
   ```bash
   # For desktop development
   bun run desktop:tauri:dev
   ```

### Development Commands

| Command | Description |
|---------|-------------|
| `bun run desktop:dev` | Start desktop web development server |
| `bun run desktop:tauri:dev` | Start Tauri development mode (desktop) |
| `bun run desktop:build` | Build desktop frontend |
| `bun run desktop:preview` | Preview desktop production build |
| `bun run desktop:check` | Desktop TypeScript type checking |
| `bun run landing:dev` | Start landing site development server |
| `bun run landing:check` | Landing TypeScript type checking |
| `bun run relay:dev` | Start Omni relay development server |
| `bun run relay:typecheck` | Relay TypeScript type checking |
| `bun run share:test:run` | Run shared package tests |
| `bun run check:all` | Type check all packages |
| `bun run format` | Format code with Biome |
| `bun run lint` | Lint code with Biome |
| `bun run biome` | Run both format and lint |

See [docs/monorepo.md](./docs/monorepo.md) for package boundaries, deployment roots,
and the verification checklist.

## Code Style & Standards

### Formatting

Quillium uses [Biome](https://biomejs.dev/) for consistent code formatting and linting:

- **Indentation**: 4 spaces (2 spaces for JSON files)
- **Line width**: 100 characters
- **Semicolons**: Required
- **Trailing commas**: Required where valid
- **Import organization**: Automatic sorting and grouping

**Before submitting a PR, always run:**

```bash
bun run check:all
bun run lint
```

### TypeScript

- **Strict mode**: Enabled across the project
- **Type annotations**: Required for function parameters and return types
- **Interface usage**: Prefer interfaces over types for object shapes
- **Null safety**: Handle null/undefined cases explicitly

### Svelte-specific Guidelines

- **Component naming**: PascalCase for component files
- **Prop definitions**: Use TypeScript interfaces for complex prop types
- **Store usage**: Follow reactive statement patterns for store subscriptions
- **Event handling**: Use proper event typing

### File Organization

See [docs/monorepo.md](./docs/monorepo.md) for package layout and
[docs/architecture-overview.md](./docs/architecture-overview.md) for system architecture.

## Contribution Workflow

### 1. Planning Your Contribution

Before starting work:
- **Check existing issues** to avoid duplicate work
- **Open an issue** for new features or significant changes
- **Discuss approach** with maintainers for complex features

### 2. Development Process

1. **Create a feature branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes**
   - Follow the code style guidelines
   - Write clear, descriptive commit messages
   - Test your changes thoroughly

3. **Run quality checks**
   ```bash
   bun run check:all             # TypeScript validation
   bun run biome                 # Format and lint
   bun run desktop:tauri:build   # Build the desktop package
   ```

### 3. Commit Guidelines

Use clear, descriptive commit messages following this pattern:
```
type(scope): brief description

- More detailed explanation if needed
- List key changes
- Reference issues with #123
```

**Types:**
- `feat`: New features
- `fix`: Bug fixes
- `docs`: Documentation changes
- `style`: Code style/formatting changes
- `refactor`: Code restructuring without behavior changes
- `test`: Test additions or modifications
- `chore`: Build process or tool changes

**Examples:**
```bash
feat(editor): add keyboard shortcut for annotation creation

fix(ai): handle API timeout errors gracefully

docs(contributing): update development setup instructions
```

### 4. Pull Request Process

1. **Create Pull Request**
   - Use our PR template (created automatically)
   - Provide clear description of changes
   - Link related issues
   - Add screenshots for UI changes

2. **PR Requirements**
   - [ ] All checks pass (TypeScript, linting, build)
   - [ ] Code follows style guidelines
   - [ ] No breaking changes without discussion
   - [ ] Documentation updated if needed
   - [ ] Self-review completed

3. **Review Process**
   - Maintainers will review your PR
   - Address feedback promptly
   - Keep discussions focused and constructive
   - Be patient - reviews take time

## Types of Contributions

### 🐛 Bug Fixes
- **Small fixes**: Feel free to submit directly
- **Complex bugs**: Open an issue first to discuss approach
- **Include**: Steps to reproduce, expected vs actual behavior
- **Test**: Verify fix works and doesn't break existing functionality

### ✨ New Features
- **Always open an issue first** for feature requests
- **Consider**: How does this align with Quillium's vision?
- **Design**: Think about user experience and technical approach
- **Scope**: Start small, iterate and improve

### 📚 Documentation
- **Code comments**: Document complex logic and architectural decisions
- **API documentation**: Keep interfaces and types well-documented
- **User guides**: Help users understand how to use features
- **Architecture docs**: Explain design decisions and patterns

### 🎨 UI/UX Improvements
- **Consistency**: Follow existing design patterns
- **Accessibility**: Ensure features work with screen readers and keyboards
- **Responsiveness**: Test across different screen sizes
- **Performance**: Consider impact on editor performance

## Analytics (PostHog)

Quillium uses [PostHog](https://posthog.com) for product analytics. Events are captured with `posthog.capture()` directly in components — no wrapper or store abstraction is used.

### Setup

PostHog is initialized once in `packages/desktop/src/hooks.client.ts` at app boot. It
also registers `app_version` as a super property (sent with every event automatically)
and forwards unhandled client exceptions to PostHog.

Add these to your `.env.local` for analytics to work locally:

```bash
PUBLIC_POSTHOG_KEY=your_project_api_key
PUBLIC_POSTHOG_HOST=https://us.i.posthog.com  # or your self-hosted URL
```

Both variables must be prefixed with `PUBLIC_` to be exposed to the client by SvelteKit. Analytics are non-critical — the app works fine without them.

### Adding a New Event

1. **Import PostHog** at the top of the component (if not already imported):
   ```typescript
   import posthog from "posthog-js";
   ```

2. **Call `posthog.capture()`** at the point of the user action:
   ```typescript
   posthog.capture("event_name", {
       property_one: value,
       property_two: value,
   });
   ```

3. **Add a row** to the event inventory table below.

### Event Naming Convention

Use `snake_case` with the pattern `noun_verb` or `noun_verb_qualifier`:

| Pattern | Example |
|---------|---------|
| `noun_verb` | `comment_created`, `draft_deleted` |
| `noun_verb_qualifier` | `ai_feedback_requested`, `revision_version_created` |
| `noun_noun_verb` | `comment_ai_suggestion_requested` |

Group related events under the same noun prefix (e.g., `ai_*`, `annotation_*`, `comment_*`, `revision_*`, `suggestion_*`).

### Property Conventions

Include contextual properties that make events useful for analysis:

- **`type`** — discriminate among annotation types: `"comment"`, `"revision"`, `"suggestion"`
- **`has_selection`** — boolean, whether text was selected at the time of the action
- **`trigger`** — how the action was initiated: `"manual"` or `"quick_action"`
- **`mode`** — AI sidebar tab that was open: `"chat"`, `"feedback"`, `"revise"`, etc.
- **Word/length counts** — `word_count`, `message_length`, `comment_length`, `prompt_length`, `output_length`
- **Counts** — `thread_length`, `version_count`, `replacement_count`, `total_steps`

### Current Event Inventory

#### App

| Event | Properties | Source |
|-------|-----------|--------|
| `app_session_started` | `word_count` | `editor/Editor.svelte` |
| `focus_mode_entered` | — | `routes/+page.svelte` |
| `focus_mode_exited` | — | `routes/+page.svelte` |

#### AI

| Event | Properties | Source |
|-------|-----------|--------|
| `ai_sidebar_opened` | `mode` | `ai/AISidebar.svelte` |
| `ai_chat_message_sent` | `has_selection`, `message_length` | `ai/Chat.svelte` |
| `ai_feedback_requested` | `has_selection`, `trigger` | `ai/Feedback.svelte` |
| `ai_revise_requested` | `has_selection`, `trigger` | `ai/Revise.svelte` |
| `ai_revise_quick_prompt_used` | `prompt`, `has_selection` | `ai/Revise.svelte` |
| `ai_settings_provider_changed` | `provider` | `ai/AISettings.svelte` |
| `ai_settings_model_changed` | `provider`, `model` | `ai/AISettings.svelte` |
| `ai_message_sent` | `mode`, `has_document_context`, `has_selected_text`, `document_length` | `ai/chatFactory.ts` |

#### Document Context

| Event | Properties | Source |
|-------|-----------|--------|
| `context_generated` | `variant`, `prompt_length`, `output_length` | `ai/clientStreams.ts` |
| `context_cleared` | — | `ai/DocumentContext.svelte` |

#### Annotations (shared)

| Event | Properties | Source |
|-------|-----------|--------|
| `annotation_created` | `type` (`"comment"`/`"suggestion"`/`"revision"`), plus `replacement_count` or `version_count` | `ai/chatFactory.ts` |
| `annotation_deleted` | `type`, `thread_length`/`version_count`/`replacement_count` | `Comment/Revision/Suggestion.svelte` |

#### Comments

| Event | Properties | Source |
|-------|-----------|--------|
| `comment_created` | `has_selection`, `comment_length` | `annotations/PreComment.svelte` |
| `comment_ai_suggestion_requested` | `thread_length`, `has_selection` | `annotations/Comment.svelte` |

#### Revisions

| Event | Properties | Source |
|-------|-----------|--------|
| `revision_version_created` | `version_count` | `annotations/Revision.svelte` |

#### Suggestions

| Event | Properties | Source |
|-------|-----------|--------|
| `suggestion_diff_viewed` | `replacement_index`, `replacement_count` | `annotations/Suggestion.svelte` |
| `suggestion_diff_modal_opened` | `replacement_count` | `annotations/Suggestion.svelte` |
| `suggestion_branched` | `replacement_count` | `annotations/Suggestion.svelte` |
| `suggestion_applied` | `replacement_index`, `replacement_count` | `annotations/Suggestion.svelte` |

#### Tutorial & Lifecycle

| Event | Properties | Source |
|-------|-----------|--------|
| `tutorial_skipped` | `step_reached`, `total_steps` | `tutorial/Tutorial.svelte` |
| `tutorial_completed` | `total_steps` | `tutorial/Tutorial.svelte` |

### Feature Flags

Feature flags are evaluated with `posthog.getFeatureFlag(flagName)` at the call site — no reactive store is used.

| Flag | Variants | Purpose | Source |
|------|----------|---------|--------|
| `context-generation-format` | `"control"` (default), `"structured"` | A/B test for how document context is formatted when sent to AI | `ai/clientStreams.ts` |
| `novel-november` | boolean | Enables the seasonal writing feature suite | `featureFlags.svelte.ts` |

### Error Tracking

Unhandled client errors are automatically forwarded to PostHog via
`posthog.captureException()` in `packages/desktop/src/hooks.client.ts`. No manual
instrumentation is needed for routine error tracking.

---

## Testing

### Manual Testing

Since Quillium doesn't currently have automated tests, thorough manual testing is crucial:

1. **Core functionality**
   - Text editing and formatting
   - Annotation creation and management
   - AI chat interactions
   - File operations

2. **Cross-platform testing**
   - Web version (multiple browsers)
   - Desktop version (if applicable to your changes)

3. **Edge cases**
   - Large documents
   - Empty states
   - Error conditions
   - Network failures (for AI features)

### Performance Testing

- **Editor responsiveness**: Type lag, scroll performance
- **Memory usage**: Monitor for memory leaks
- **Build size**: Avoid adding unnecessary dependencies

## Issue Reporting

### Bug Reports

Use our bug report template and include:
- **Steps to reproduce** the issue
- **Expected behavior** vs **actual behavior**
- **Environment** (OS, browser, version)
- **Screenshots/recordings** if applicable
- **Console errors** or log output

### Feature Requests

- **Use case**: Explain the problem you're trying to solve
- **Proposed solution**: Your idea for implementation
- **Alternatives**: Other approaches you considered
- **Impact**: Who would benefit from this feature?

## Community Guidelines

### Code of Conduct

We follow the [Contributor Covenant Code of Conduct](./CODE_OF_CONDUCT.md). Please read it before participating.

### Communication

- **Be respectful** and constructive in all interactions
- **Ask questions** if anything is unclear
- **Share knowledge** and help other contributors
- **Focus on the code**, not the person

### Getting Help

- **GitHub Issues**: For bugs and feature requests
- **Discussions**: For questions and general discussion
- **Code comments**: For specific technical questions

## Development Tips

### Understanding the Codebase

1. **Start with the README**, [docs/monorepo.md](./docs/monorepo.md), and ARCHITECTURE.md
2. **Explore the file structure** to understand organization
3. **Read through key components** like `packages/desktop/src/lib/editor/Editor.svelte`
4. **Check AGENTS.md** for development context

### Working with CodeMirror

- **State fields**: Understand how editor state is managed
- **Extensions**: Learn the extension API for adding features
- **Updates**: Handle document changes properly
- **Performance**: Be mindful of update frequency

### AI Integration

- **Optional dependency**: Ensure features work without AI
- **Error handling**: Handle API failures gracefully
- **Context management**: Understand how document context is passed
- **Streaming**: Work with streaming responses properly

### State Management

- **Two-way sync**: Understand CodeMirror ↔ Svelte store sync
- **Reactivity**: Use Svelte's reactive patterns effectively
- **Performance**: Avoid unnecessary updates and re-renders

## Release Process

Quillium follows semantic versioning:
- **Major** (1.0.0): Breaking changes
- **Minor** (0.1.0): New features, backward compatible
- **Patch** (0.0.1): Bug fixes

Maintainers handle releases, but contributors can:
- **Suggest version bumps** in PRs
- **Update changelog entries** with notable changes (see below)
- **Test release candidates** when available

### Writing Changelog Entries

Quillium shows a "What's New" modal on startup after minor version bumps. Changelog entries live in `packages/desktop/src/lib/changelog.json`, keyed by `major.minor` version:

```json
{
    "0.12": {
        "date": "April 2026",
        "content": "Markdown content here..."
    }
}
```

**Content guidelines:**

- **Conversational prose, not bullet points.** Write short paragraphs with **bold keywords** for scannability — think Discord's "What's New" style, not GitHub release notes.
- **One paragraph per notable change.** Each paragraph should explain what changed and why a writer would care.
- **Never mention AI features.** Writers are often AI-averse. AI-related changes (new models, persona features, sidebar improvements, prompt changes) should be completely omitted from changelogs.
- **Say what the user gets, not what we did.** "You can now hide suggestions" not "Added a hide-suggestions toggle to the settings store."
- **Privacy/legal changes get their own paragraph** noting that nothing functional changed.
- **Keep it short.** 2–5 paragraphs per release. If you can't summarize a change in one paragraph, the changelog isn't the right place for it.
- **Only add entries for minor bumps** — patch releases don't get changelog entries.

**Adding a feature image (optional but encouraged for visual features):**

Entries can embed a screenshot. The modal renders the `content` as Markdown, so add an image with standard Markdown syntax inside the `content` string:

```json
"content": "Quillium now tracks **how a document was written**…\n\n![Authorship playback](/changelog/0.20.png)\n\nOpen it from the status bar…"
```

Don't hand-craft screenshots. Use the reproducible harness, which boots the app, mocks Tauri, seeds realistic state, and crops a clean, modal-sized PNG into `packages/desktop/static/changelog/<version>.png` (served at `/changelog/<version>.png`):

```bash
# A built-in scene (full-screen scenes self-size to avoid dead space):
bun run desktop:changelog:shot --version 0.20 --scene authorship-playback

# Or crop to a specific element of a scene, with padding:
bun run desktop:changelog:shot --version 0.21 --scene editor --crop "#editor-document" --pad 24
```

Run `bun run desktop:changelog:shot` with no args to list available scenes. Pass `--crop` to frame a single element, or `--width`/`--height` to trim a full-screen capture — full 1440px app chrome reads poorly in the modal.

**Creating a custom scene.** A "scene" leaves the app in a captureable state (the right page open, the right state seeded, the right element on screen). When the built-in scenes don't fit your feature, you have two options.

_Option A — add it to the `SCENES` map (preferred when the scene will recur across releases)._ In `packages/desktop/scripts/changelog-shot.ts`, add an entry keyed by scene name. `needs` is the boot config (mock flags + an optional `viewport` to size full-screen captures); `run` drives the page into the shot. The harness exports `applyDebugScenario(page, id)` to seed state via any `screenshot-*` scenario in `packages/desktop/src/lib/debug/scenarios.ts`, and the app exposes DEV bridges on `window` (e.g. `__goToAuthorship__`, `__runScenario__`):

```ts
const SCENES: Record<string, { needs: BootOptions; run: Scene }> = {
    // …existing scenes…
    "export-menu": {
        needs: {}, // e.g. { fakeApiKey: true } or { viewport: { width: 900, height: 470 } }
        run: async (page) => {
            await waitForEditor(page);
            await applyDebugScenario(page, "screenshot-full-ui");
            await page.locator("[data-testid='export-button']").click();
            await page.waitForTimeout(400); // let the dropdown settle
        },
    },
};
```

Then capture it like any built-in scene:

```bash
bun run desktop:changelog:shot --version 0.21 --scene export-menu --crop ".export-dropdown" --pad 16
```

_Option B — a throwaway driver (for a true one-off you won't reuse)._ Import the helper API in a small script, run it, then delete it. `boot()` starts/reuses the dev server and returns `{ page, … }`; `cropShot()` writes `packages/desktop/static/changelog/<version>.png`; `shutdown()` tears everything down:

```ts
// scripts/_my-shot.ts  — delete after running
import { boot, cropShot, shutdown, applyDebugScenario } from "./changelog-shot";

const h = await boot({ fakeApiKey: true });
try {
    await applyDebugScenario(h.page, "screenshot-full-ui");
    await h.page.getByRole("button", { name: "Readers" }).click();
    await h.page.waitForTimeout(500);
    await cropShot(h.page, { version: "0.21", crop: "#ai-sidebar", pad: 20 });
} finally {
    await shutdown(h);
}
```

```bash
bun scripts/_my-shot.ts   # then: rm scripts/_my-shot.ts
```

Either way, the crop selector should target the smallest element that frames the feature cleanly. When a feature has no single wrapping element (e.g. a full-screen viewer with controls pinned to the viewport edges), set a compact `viewport` in `needs` and capture without `--crop` instead — that's what the `authorship-playback` scene does.

## Recognition

Contributors are recognized through:
- **GitHub contributors** graph
- **CHANGELOG.md** mentions for significant contributions
- **Release notes** for major features

Thank you for contributing to Quillium! Your efforts help make writing better for everyone. 🚀
