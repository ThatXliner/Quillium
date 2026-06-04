# Technology Stack

**Analysis Date:** 2026-04-16

## Languages

**Primary:**
- TypeScript ~5.6.3 - Frontend application, SvelteKit components, configuration
- Svelte 5.55.3 - Reactive UI framework for components in `src/routes` and `src/lib`

**Secondary:**
- Rust 2021 edition - Desktop app backend via Tauri (`src-tauri/src/`)
- JavaScript - Vite build configuration, scripts in `scripts/`

## Runtime

**Environment:**
- Tauri 2.10.1 - Desktop application framework (wraps web frontend in native shell)
- Node.js - Development runtime (via bun package manager)

**Package Manager:**
- bun - Primary package manager for frontend dependencies
- Lockfile: `bun.lockb` (binary lock format used by bun)
- Cargo - Rust dependency management (`src-tauri/Cargo.lock`)

## Frameworks

**Core Frontend:**
- SvelteKit 2.57.1 - Meta-framework for Svelte with file-based routing
- Vite 6.4.2 - Build tool and dev server
- Tauri 2.10.1 - Desktop framework (native window, file dialogs, menus, updater)

**UI & Styling:**
- Tailwind CSS 4.2.2 - Utility-first CSS framework (via `@tailwindcss/vite`)
- Bits UI 1.8.0 - Headless component library for composable UI elements
- lucide-svelte 0.475.0 - SVG icon set as Svelte components
- svelte-sonner 1.1.0 - Toast notification system

**Code Editor:**
- CodeMirror 6 (`@codemirror/view` 6.41.0, `@codemirror/state` 6.6.0, etc.)
  - Commands (`@codemirror/commands` 6.10.3)
  - Markdown language support (`@codemirror/lang-markdown` 6.5.0)
  - Search functionality (`@codemirror/search` 6.6.0)
- harper.js 2.0.0 - Grammar and style linting for Markdown
- crelt 1.0.6 - Lightweight DOM creation helper

**AI & LLM Integration:**
- ai 5.0.172 - Vercel AI SDK (unified LLM client)
- @ai-sdk/openai 2.0.102 - OpenAI provider adapter
- @ai-sdk/anthropic 3.0.69 - Anthropic Claude provider adapter
- @ai-sdk/google 3.0.62 - Google Gemini provider adapter
- @ai-sdk/svelte 3.0.172 - Svelte utilities for AI streaming

**Markdown & Content Processing:**
- unified 11.0.5 - Text processing ecosystem
- remark-parse 11.0.0 - Markdown parser
- remark-gfm 4.0.1 - GitHub Flavored Markdown syntax support
- remark-rehype 11.1.2 - Markdown to HTML AST converter
- rehype-remark 10.0.1 - HTML to Markdown conversion
- rehype-stringify 10.0.1 - HTML AST to string converter
- dompurify 3.3.3 - XSS sanitizer for DOM content

**Data Validation:**
- zod 4.3.6 - TypeScript-first schema validation and parsing

**Testing:**
- Vitest 4.1.4 - Unit test runner (Vite-native, ESM-first)
- @testing-library/svelte 5.3.1 - DOM testing utilities for Svelte
- @testing-library/jest-dom 6.9.1 - Custom matchers for DOM assertions
- @vitest/coverage-v8 4.1.4 - V8-based code coverage
- fast-check 4.6.0 - Property-based testing framework
- jsdom 28.1.0 - Browser environment simulation for tests
- Playwright 1.59.1 - E2E testing framework
- pixelmatch 7.1.0 - Pixel-level image diffing (screenshot testing)
- pngjs 7.0.0 - PNG image processing

**Linting & Formatting:**
- Biome 1.9.4 - All-in-one linter, formatter, and language server
  - Replaces ESLint + Prettier

**TypeScript & SvelteKit Support:**
- svelte-check 4.4.6 - SvelteKit type checker
- @sveltejs/adapter-static 3.0.10 - SSG adapter for Tauri (prerender to HTML)
- @sveltejs/vite-plugin-svelte 5.1.1 - Vite plugin for Svelte

**Fonts:**
- @fontsource packages (8 fonts) - Self-hosted font families:
  - Inter, Lora, Raleway, Caveat, Courier Prime, EB Garamond, IA Writer Quattro, OpenDyslexic, Nunito

**Utilities:**
- lodash-es 4.18.1 - Functional utility library
- diff 7.0.0 - Unified diff generation and parsing
- paneforge 1.0.2 - Resizable pane divider system

**Analytics & Monitoring:**
- posthog-js 1.367.0 - Product analytics with session replay
  - Configured in `src/lib/posthog.ts`
  - Session recording masks document content by default
  - Opt-in/opt-out support via `appSettings.analyticsEnabled`

## Configuration

**Environment:**
- Frontend config via `$env/static/public` (SvelteKit)
  - `PUBLIC_POSTHOG_KEY` - PostHog API key
  - `PUBLIC_POSTHOG_HOST` - PostHog instance URL
  - Loaded from `.env` files (not committed; use `.env.local`)

**Build:**
- `vite.config.js` - Vite configuration (SvelteKit + Tailwind plugins)
  - Dev port: 1420, HMR port: 1421
  - Test config: Vitest globals, jsdom environment, `tests/setup.ts`
- `svelte.config.js` - SvelteKit config with static adapter (Tauri doesn't support SSR)
- `tsconfig.json` - TypeScript strict mode, source maps, path aliases
- `biome.json` - Linting and formatting rules (4-space indent, 100-char line width)
- `tauri.conf.json` - Tauri app config (`src-tauri/tauri.conf.json`)
  - App window: 1373x1170 (min 900x600)
  - Updater endpoints: GitHub Releases
- `src-tauri/Cargo.toml` - Rust dependencies (see Rust section below)

**TypeScript:**
- Strict mode enabled: `forceConsistentCasingInFileNames`, `resolveJsonModule`, etc.
- Source maps enabled for debugging
- SvelteKit extends `./.svelte-kit/tsconfig.json` (auto-generated)

## Rust Backend (Tauri)

**Runtime:**
- Rust 2021 edition

**Key Dependencies:**
- tauri 2 - Desktop framework
- rusqlite 0.31 - SQLite driver with bundled SQLite library
- keyring 3 - System keychain integration
  - Apple native, Windows native, sync secret service backends
- serde 1 + serde_json 1 - Serialization/deserialization
- uuid 1 - UUID generation
- tauri-plugin-updater 2 - App auto-updater
- tauri-plugin-opener 2 - Open URLs/files in default applications
- tauri-plugin-process 2 - Subprocess management
- tauri-plugin-dialog 2.7.0 - Native file/save dialogs
- tauri-plugin-fs 2.5.0 - File system operations

**Data Persistence:**
- SQLite 3 (bundled via rusqlite) - Local database at `{app-data}/Quillium/quillium.db`
  - WAL mode, foreign keys enabled, NORMAL synchronous mode
  - Tables: documents, drafts, events, snapshots, _meta
  - See `src-tauri/src/db/schema.rs` for schema

**System Integration:**
- Keyring crate - Stores API keys in system keychain (not SQLite)
  - macOS: Keychain
  - Windows: Credential Manager
  - Linux: Secret Service

## Platform Requirements

**Development:**
- Node.js with bun installed
- Rust 2021 edition toolchain (for Tauri compilation)
- macOS/Linux/Windows (Tauri supports all)
- Code signing identity for macOS builds (Tauri)

**Production:**
- Deployment: macOS (.app), Windows (.exe), Linux (.AppImage)
- Tauri bundles app with built SvelteKit frontend (`build/` directory)
- Auto-updater via GitHub Releases

---

*Stack analysis: 2026-04-16*
