# Contributing to Quillium

Thank you for your interest in contributing to Quillium! This guide will help you get started with development and understand our contribution process.

## Getting Started

### Prerequisites

Before you begin, ensure you have the following installed:
- **Node.js** (version 18 or higher)
- **npm** or **bun** package manager  
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
   npm install
   # or if you prefer bun
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
   npm run dev
   # Opens web version at http://localhost:5173
   
   # For desktop development
   npm run tauri dev
   ```

### Development Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server (web) |
| `npm run tauri dev` | Start Tauri development mode (desktop) |
| `npm run build` | Build for production |
| `npm run preview` | Preview production build |
| `npm run check` | TypeScript type checking |
| `npm run check:watch` | Type checking in watch mode |
| `npm run format` | Format code with Biome |
| `npm run lint` | Lint code with Biome |
| `npm run biome` | Run both format and lint |

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
npm run biome
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

```
src/lib/
├── editor/           # Core editor functionality
│   ├── plugins/     # Editor plugins and extensions
│   └── components/  # Editor-specific components
├── ai/              # AI integration components
├── components/      # Shared UI components
├── stores/          # Global state management
└── utils/           # Utility functions
```

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
   npm run check      # TypeScript validation
   npm run biome      # Format and lint
   npm run build      # Ensure build works
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