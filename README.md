# Quillium

[![codecov](https://codecov.io/gh/ThatXliner/Quillium/graph/badge.svg?token=S85cfZRfBi)](https://codecov.io/gh/ThatXliner/Quillium)

> Next Generation Prose.

<!--Most writing tools force you to think linearly, but human creativity is inherently non-linear. Editing itself (which writers will be spending most of their time on) is a process... -->

Quillium is the world's first non-linear editor for prose. Built on the belief that thoughts rarely emerge in perfect sequence, it lets you explore multiple versions of text as a first-class feature, track revisions as branches rather than replacements, and weave AI assistance into the creative process without losing your voice.

Read the [Manifesto](./MANIFESTO.md).

## Screenshots

![Editor](packages/desktop/screenshots/01-editor.png)
*Focused writing environment*

![Revision with nested editor](packages/desktop/screenshots/05-revision-active.png)
*Non-linear editing: version pills and the inline nested editor*

→ [Full screenshot gallery](./SCREENSHOTS.md)

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
- **AI**: Multiple providers supported — OpenAI, OpenAI-compatible, Anthropic,
  Google, DeepSeek

## Getting Started

### Monorepo Layout

Quillium uses one Bun workspace rooted at this repository:

- `packages/desktop` - the Tauri desktop app
- `packages/landing` - the public site deployed on Vercel
- `packages/relay` - the Omni WebSocket relay deployed with Fly/Docker
- `packages/share` - shared wire types, rendering utilities, and read-only share UI
- `supabase` - the single Omni schema and migration source

See [docs/monorepo.md](./docs/monorepo.md) for package boundaries, deployment notes,
and the verification checklist.

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
bun run desktop:dev

# Or run with Tauri for desktop development
bun run desktop:tauri:dev

# Start the landing site
bun run landing:dev

# Start the Omni relay
bun run relay:dev
```

### Building

```bash
# Build web version
bun run desktop:build

# Build desktop application
bun run desktop:tauri:build
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
bun run desktop:check   # Desktop app
bun run landing:check   # Landing app
bun run share:check     # Shared package
bun run check:all       # All package checks
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
- ✅ Infinitely nestable revision system
- ✅ AI integration framework with multiple providers
- ✅ Cross-platform desktop app via Tauri
- ✅ SQLite-backed durable data persistence layer


### Near-term

- **Enhanced revision system**: True non-linear editing with branching histories
- **Improved AI integration**: Configurable prompts
<!--- **Offline-first architecture**: Work without internet connectivity-->

### Long-term

- **Collaboration tools**: Real-time collaborative editing
- **Mind mapping**: Visual representation of document structure
- **Advanced analytics**: Writing insights, productivity metrics, style analysis
- **Plugin ecosystem**: Extensible architecture for community contributions

## Architecture

See [`docs/`](./docs/) for detailed technical documentation, or start with the [Quickstart Guide](./docs/quickstart.md).

## FAQ

Q: **Why not a website??**
A: I demand extreme robustness and durability when it comes to writing. Otherwise imagine losing hours of work to a single computer crash or network failure. Quillium is offline-first and uses SQLite to ensure maximum information integrity and durability. I will explore offering a web version later though.

Q: **Why the name?**
A: The "ium" ending makes it sound like an element. The element of creativity, the element of thought; Quillium would be the element of writing. It's a nod to the quill pen, a symbol of writing and creativity.

## License

Proprietary. Copyright © 2024–2026 [ThatXliner](https://github.com/ThatXliner). All rights reserved.
