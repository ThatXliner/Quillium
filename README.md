# Quillium

> Next Generation Prose.

<!--Most writing tools force you to think linearly, but human creativity is inherently non-linear. Editing itself (which writers will be spending most of their time on) is a process... -->

Quillium is the world's first non-linear editor for prose. Built on the belief that thoughts rarely emerge in perfect sequence, it lets you explore multiple versions of text as a first-class feature, track revisions as branches rather than replacements, and weave AI assistance into the creative process without losing your voice.

Read the [Manifesto](./MANIFESTO.md).

## What Makes Quillium Different

- **Non-linear editing**: Keep multiple versions of text segments alive at once. Explore different directions without losing work.
<!--- **Branching revisions**: Version history that mirrors how writers actually think - not just a simple undo/redo stack-->
- **Contextual AI assistance**: A second voice in the room — not a chatbot in a corner. The AI annotates rather than interrupts, responding to your text without pulling you out of it:
  - Review and revise with a second set of eyes
  - Find the right words for what you're trying to say
  - Get targeted feedback on grammar, clarity, conciseness, and tone
- **Annotations**: Comments, revisions, and suggestions that float beside your text — right where they belong.

All of this in a performant, focused interface. Keyboard-first.

<!--- **Real-time collaboration**: Built for the modern workflow of multiple reviewers and collaborative editing-->

## Technical Foundation

- **Frontend**: SvelteKit + TypeScript + Tailwind CSS
- **Editor**: CodeMirror 6
- **Desktop**: Tauri (cross-platform, native performance)
- **AI**: Multiple providers supported — OpenAI, Anthropic, Google

## Getting Started

### Prerequisites

- Bun
- Rust toolchain (for Tauri builds)

### Development

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

## Contributing

We welcome contributions. See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

### Code Commands

```bash
# Format and lint
bun run format    # Format with Biome
bun run lint      # Lint with Biome
bun run biome     # Run both

# Type checking
bun run check           # One-time check
bun run check:watch     # Watch mode
```

### Recommended Editor Setup

[VS Code](https://code.visualstudio.com/) with:
- [Svelte](https://marketplace.visualstudio.com/items?itemName=svelte.svelte-vscode)
- [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode)
- [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## Project Status

### Current

- ✅ Core editor with CodeMirror 6 integration
- ✅ Basic annotation system (comments and revisions)
- ✅ AI integration framework
- ✅ Cross-platform desktop app via Tauri

### Near-term

- **Robust data persistence**: Never lose work, even during crashes
- **Enhanced revision system**: True non-linear editing with branching histories
- **Improved AI integration**: Multiple providers with configurable behavior
<!--- **Offline-first architecture**: Work without internet connectivity-->

### Long-term

- **Collaboration tools**: Real-time collaborative editing
- **Mind mapping**: Visual representation of document structure
- **Advanced analytics**: Writing insights, productivity metrics, style analysis
- **Plugin ecosystem**: Extensible architecture for community contributions

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed technical documentation.

## License

MIT © [ThatXliner](https://github.com/ThatXliner)
