# Contributing to Quillium

Thank you for your interest in contributing to Quillium! This guide will help you get started with development and understand our contribution process.

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

   Create a `.env.local` file in the project root:
   ```bash
   # AI features (optional — app works without these)
   OPENAI_API_KEY=your_openai_api_key_here

   # Analytics (optional — app works without these)
   PUBLIC_POSTHOG_KEY=your_posthog_project_api_key
   PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
   ```

   > **Note**: Both AI and analytics features are optional for most development work.

4. **Start Development Server**
   ```bash
   # For desktop development
   bun tauri dev
   ```

### Development Commands

| Command | Description |
|---------|-------------|
| `bun run dev` | Start development server (web) |
| `bun run tauri dev` | Start Tauri development mode (desktop) |
| `bun run build` | Build for production |
| `bun run preview` | Preview production build |
| `bun run check` | TypeScript type checking |
| `bun run check:watch` | Type checking in watch mode |
| `bun run format` | Format code with Biome |
| `bun run lint` | Lint code with Biome |
| `bun run biome` | Run both format and lint |

## Code Style & Standards

### Formatting

Quillium uses [Biome](https://biomejs.dev/) for consistent code formatting and linting:

- **Indentation**: 4 spaces (2 spaces for JSON files)
- **Line width**: 80 characters
- **Semicolons**: Required
- **Trailing commas**: Required where valid
- **Import organization**: Automatic sorting and grouping

**Before submitting a PR, always run:**

```bash
bun run check
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

See [architecture](./ARCHITECTURE.md)

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
   bun run check      # TypeScript validation
   bun run biome      # Format and lint
   bun run tauri build      # Ensure build works
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

PostHog is initialized once in `src/hooks.client.ts` at app boot. It also registers `app_version` as a super property (sent with every event automatically) and forwards unhandled client exceptions to PostHog.

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
| `noun_verb` | `comment_created`, `draft_scrapped` |
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
| `draft_scrapped` | — | `save/Save.svelte` |

### Feature Flags

Feature flags are evaluated with `posthog.getFeatureFlag(flagName)` at the call site — no reactive store is used.

| Flag | Variants | Purpose | Source |
|------|----------|---------|--------|
| `context-generation-format` | `"control"` (default), `"structured"` | A/B test for how document context is formatted when sent to AI | `ai/clientStreams.ts` |

### Error Tracking

Unhandled client errors are automatically forwarded to PostHog via `posthog.captureException()` in `src/hooks.client.ts`. No manual instrumentation is needed for routine error tracking.

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

1. **Start with the README** and ARCHITECTURE.md
2. **Explore the file structure** to understand organization
3. **Read through key components** like Editor.svelte
4. **Check the CLAUDE.md** file for development context

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
- **Update CHANGELOG.md** with notable changes
- **Test release candidates** when available

## Recognition

Contributors are recognized through:
- **GitHub contributors** graph
- **CHANGELOG.md** mentions for significant contributions
- **Release notes** for major features

Thank you for contributing to Quillium! Your efforts help make writing better for everyone. 🚀
