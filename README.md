# Quillium

> A modern writing application that reimagines how we create and edit prose

Quillium explores what writing could be if we weren't constrained by the linear nature of traditional text editors. Built on the idea that thoughts rarely emerge in perfect sequence, Quillium enables writers to explore multiple versions, track revisions as branches rather than replacements, and seamlessly integrate AI assistance into their creative process.

At its core, Quillium addresses a fundamental limitation: most writing tools force you to think linearly, but human creativity is inherently non-linear. Whether you're crafting an essay, drafting a proposal, or exploring ideas, Quillium provides the flexibility to develop your thoughts naturally while maintaining a clear path back to any previous state.

## Key Innovations

- **Non-linear editing**: Maintain multiple versions of text segments and explore different directions without losing work
- **Branching revisions**: Version history that mirrors how writers actually think - not just a simple undo/redo stack
- **Contextual AI assistance**: AI integration that understands your document's context and provides relevant suggestions
- **Annotation system**: Comments, suggestions, and revisions that layer onto your text without disrupting flow
- **Real-time collaboration**: Built for the modern workflow of multiple reviewers and collaborative editing

## Technical Foundation

Built with modern web technologies for cross-platform compatibility:
- **Frontend**: SvelteKit + TypeScript + Tailwind CSS
- **Editor**: CodeMirror 6 for robust text editing
- **Desktop**: Tauri for native performance
- **AI**: Flexible integration supporting multiple providers (OpenAI, Anthropic, Google)

## Getting Started

### Prerequisites
- Node.js 18+ and npm/bun
- Rust toolchain (for Tauri builds)

### Development Setup

```bash
# Clone the repository
git clone https://github.com/ThatXliner/Quillium.git
cd Quillium

# Install dependencies
npm install

# Start development server
npm run dev

# Or run with Tauri for desktop development
npm run tauri dev
```

### Building

```bash
# Build web version
npm run build

# Build desktop application
npm run tauri build
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
npm run format    # Format with Biome
npm run lint      # Lint with Biome
npm run biome     # Run both format and lint

# Type checking
npm run check           # One-time check
npm run check:watch     # Watch mode
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
- **Offline-first architecture**: Work without internet connectivity
- **Better collaboration tools**: Real-time collaborative editing

### Long-term Vision
- **Mind mapping integration**: Visual representation of document structure and relationships
- **Advanced analytics**: Writing insights, productivity metrics, and style analysis
- **Plugin ecosystem**: Extensible architecture for community contributions
- **Cross-document linking**: Connect ideas across multiple documents

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed technical documentation.

## License

MIT © [ThatXliner](https://github.com/ThatXliner)
