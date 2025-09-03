# Quillium

> Next Generation Prose.

<!--Most writing tools force you to think linearly, but human creativity is inherently non-linear. Editing itself (which writers will be spending most of their time on) is a process... -->

Quillium is the world's first non-linear editor for prose. Built on the idea that thoughts rarely emerge in perfect sequence, Quillium enables you to explore multiple versions of text as a first-class feature, track revisions as branches rather than replacements, and seamlessly integrate AI assistance into the creative process whilst maintaining your voice.

Quillium is not just an app; it's a vision towards a new way of writing. Whether you're crafting an essay, drafting a proposal, or exploring ideas, Quillium provides the flexibility to develop your thoughts naturally, freely, and quickly.

## Key Innovations

- **Non-linear editing**: Maintain multiple versions of text segments and explore different directions without losing work
<!--- **Branching revisions**: Version history that mirrors how writers actually think - not just a simple undo/redo stack-->
- **Contextual AI assistance**: AI integration without the context switching. This includes:
  - Acting as a second set of eyes for review and revisions, offering insights into what your audience may perceive
  - Helping you figure out the right words to express what you're trying to say
  - Providing relevant suggestions and feedback for a variety of goals and styles, including but not limited to grammar, conciseness, clarity, and tone
- **Annotations**: A familiar comments and suggestions system that layer onto your text without disrupting flow


...and all of this packaged into a performant, friendly, and efficient interface. Keyboard-first!

<!--- **Real-time collaboration**: Built for the modern workflow of multiple reviewers and collaborative editing-->

## Technical Foundation

Built with modern web technologies for cross-platform compatibility:
- **Frontend**: SvelteKit + TypeScript + Tailwind CSS
- **Editor**: CodeMirror 6 for robust text editing
- **Desktop**: Tauri for native performance
- **AI**: Flexible integration supporting multiple providers (OpenAI, Anthropic, Google)

## Getting Started

### Prerequisites
- Bun
- Rust toolchain (for Tauri builds)

### Development Setup

```bash
# Clone the repository
git clone https://github.com/ThatXliner/Quillium.git
cd Quillium

# Install dependencies
bun install

# Start development server
bun run dev

# Or run with Tauri for desktop development
bun run tauri dev
```

### Building

```bash
# Build web version
bun run build

# Build desktop application
bun run tauri build
```

## Development Environment

For the best development experience, we recommend:

[VS Code](https://code.visualstudio.com/) with the following extensions:
- [Svelte](https://marketplace.visualstudio.com/items?itemName=svelte.svelte-vscode)
- [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode)
- [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines on how to get involved.

### Development Commands

```bash
# Format and lint code
bun run format    # Format with Biome
bun run lint      # Lint with Biome
bun run biome     # Run both format and lint

# Type checking
bun run check           # One-time check
bun run check:watch     # Watch mode
```

## Project Vision

### Current State

Quillium is in active development, focusing on building robust foundations:
- ✅ Core editor with CodeMirror 6 integration
- ✅ Basic annotation system (comments and revisions)
- ✅ AI integration framework
- ✅ Cross-platform desktop app via Tauri

### Near-term Goals
- **Robust data persistence**: Never lose your work, even during crashes
- **Enhanced revision system**: True non-linear editing with branching histories
- **Improved AI integration**: Support for multiple AI providers with configurable behavior
<!--- **Offline-first architecture**: Work without internet connectivity-->

### Long-term Vision
- **Better collaboration tools**: Real-time collaborative editing
- **Mind mapping integration**: Visual representation of document structure and relationships
- **Advanced analytics**: Writing insights, productivity metrics, and style analysis
- **Plugin ecosystem**: Extensible architecture for community contributions

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed technical documentation.

## License

MIT © [ThatXliner](https://github.com/ThatXliner)
