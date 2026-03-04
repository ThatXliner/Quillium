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

   For AI features, create a `.env` file in the project root:
   ```bash
   OPENAI_API_KEY=your_openai_api_key_here
   ```

   > **Note**: AI features are optional for most development work. The app will function without API keys.

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

### Event Naming Convention

Use `snake_case` with the pattern `noun_verb` or `noun_verb_qualifier`:

| Pattern | Example |
|---------|---------|
| `noun_verb` | `comment_created`, `draft_scrapped` |
| `noun_verb_qualifier` | `ai_feedback_requested`, `revision_version_created` |
| `noun_noun_verb` | `comment_ai_suggestion_requested` |

Group related events under the same noun prefix (e.g., `ai_*`, `comment_*`, `revision_*`, `suggestion_*`).

### Property Conventions

Include contextual properties that make events useful for analysis:

- **`type`** — discriminate among annotation types: `"comment"`, `"revision"`, `"suggestion"`
- **`has_selection`** — boolean, whether text was selected at the time of the action
- **`trigger`** — how the action was initiated: `"manual"` or `"quick_action"`
- **Word/length counts** — `word_count`, `message_length`, `comment_length`, `reply_length`
- **Counts** — `thread_length`, `version_count`, `replacement_count`

### Current Event Inventory

| Event | Properties | Location |
|-------|-----------|----------|
| `app_session_started` | `word_count` | `Editor.svelte` |
| `ai_sidebar_opened` | `mode` | `AISidebar.svelte` |
| `ai_chat_message_sent` | `has_selection`, `message_length` | `Chat.svelte` |
| `ai_feedback_requested` | `has_selection`, `trigger` | `Feedback.svelte` |
| `ai_revise_requested` | `has_selection`, `trigger` | `Revise.svelte` |
| `ai_revise_quick_prompt_used` | `prompt`, `has_selection` | `Revise.svelte` |
| `ai_settings_provider_changed` | `provider` | `AISettings.svelte` |
| `ai_settings_model_changed` | `provider`, `model` | `AISettings.svelte` |
| `annotation_deleted` | `type`, `thread_length`/`version_count`/`replacement_count` | `Comment/Revision/Suggestion.svelte` |
| `comment_created` | `has_selection`, `comment_length` | `PreComment.svelte` |
| `comment_reply_sent` | `thread_length`, `reply_length` | `Comment.svelte` |
| `comment_ai_suggestion_requested` | `thread_length`, `has_selection` | `Comment.svelte` |
| `revision_version_created` | `version_count` | `Revision.svelte` |
| `revision_nested_editor_toggled` | `opened`, `version_count` | `Revision.svelte` |
| `revision_modal_opened` | `version_count` | `Revision.svelte` |
| `suggestion_diff_viewed` | `replacement_index`, `replacement_count` | `Suggestion.svelte` |
| `suggestion_diff_modal_opened` | `replacement_count` | `Suggestion.svelte` |
| `suggestion_branched` | `replacement_count` | `Suggestion.svelte` |
| `suggestion_applied` | `replacement_index`, `replacement_count` | `Suggestion.svelte` |
| `tutorial_skipped` | `step_reached`, `total_steps` | `Tutorial.svelte` |
| `tutorial_completed` | `total_steps` | `Tutorial.svelte` |
| `draft_scrapped` | — | `Save.svelte` |

### Error Tracking

Unhandled errors are automatically captured via `posthog.captureException()` in `src/hooks.client.ts`. No manual instrumentation is needed for error tracking.

### Environment Variables

```bash
PUBLIC_POSTHOG_KEY=your_project_api_key
PUBLIC_POSTHOG_HOST=https://us.i.posthog.com  # or your self-hosted URL
```

These must be prefixed with `PUBLIC_` to be exposed to the client by SvelteKit.

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
