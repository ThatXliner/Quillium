# External Integrations

**Analysis Date:** 2026-04-16

## APIs & External Services

**LLM Providers:**
- OpenAI (GPT-4o, GPT-4o-mini, etc.)
  - SDK: `@ai-sdk/openai` 2.0.102
  - Auth: API key stored in system keychain
  - Access point: `src/lib/ai/provider.ts` (`createModel` function)
  - Streaming: Via Vercel AI SDK `generateObject` and `useChat`

- Anthropic (Claude models)
  - SDK: `@ai-sdk/anthropic` 3.0.69
  - Auth: API key stored in system keychain
  - Access point: `src/lib/ai/provider.ts`
  - Streaming: Via Vercel AI SDK

- Google Gemini
  - SDK: `@ai-sdk/google` 3.0.62
  - Auth: API key stored in system keychain
  - Access point: `src/lib/ai/provider.ts`
  - Streaming: Via Vercel AI SDK

**OpenAI OAuth Proxy:**
- Service: Optional local OAuth proxy (npx openai-oauth)
- Purpose: Browser-based OAuth flow for personal OpenAI accounts
- Implementation: `src/lib/ai/provider.ts` routes "openai-codex" provider through `http://127.0.0.1:10531/v1`
- Status: User-initiated optional setup (not required for API key authentication)

**Analytics & Monitoring:**
- PostHog (Product Analytics + Session Replay)
  - Init: `src/lib/posthog.ts`
  - Key: `PUBLIC_POSTHOG_KEY` (environment variable)
  - Host: `PUBLIC_POSTHOG_HOST` (environment variable, default `https://us.posthog.com`)
  - Features:
    - Session recording with document content masking (privacy-first)
    - Exception tracking (unhandled errors, promise rejections)
    - Custom event capture via `capture(event, props)`
    - Opt-in/opt-out control via `appSettings.analyticsEnabled`
  - Selective redaction: Properties in `REDACTED_KEYS` set stripped when `shareDocumentAnalytics` is disabled
  - Session masking selectors: `.cm-content`, `.annotation-card`, `#ai-sidebar`, etc. (all editor content hidden)
  - CORS handling: Patches stylesheet crossOrigin to work with Tauri's `tauri://localhost` protocol

**GitHub (Distribution/Updates):**
- Service: GitHub Releases
- Purpose: App auto-updater endpoint
- Configuration: `src-tauri/tauri.conf.json`
  - Updater pubkey: Base64-encoded minisign public key
  - Endpoint: `https://github.com/ThatXliner/quillium-releases/releases/latest/download/latest.json`
- Implementation: Tauri updater plugin automatically checks for new releases

## Data Storage

**Databases:**
- SQLite 3 (bundled via `rusqlite 0.31`)
  - Location: `{app-data}/Quillium/quillium.db` (Tauri manages app data directory)
  - Connection: Rust backend in `src-tauri/src/db/` via Tauri commands
  - Client: rusqlite (synchronous, blocking)
  - Mode: WAL (write-ahead logging), foreign keys ON, NORMAL synchronous
  - Tables:
    - `documents` - Document metadata (title, timestamps, word count, preview, tags)
    - `drafts` - Document drafts (versions of a document)
    - `events` - Event log for persistence (undo/redo, annotation changes)
    - `snapshots` - Saved document snapshots (labeled versions)
    - `_meta` - App metadata (trash retention, snapshot retention)
  - Indexes: `idx_events_draft`, `idx_snapshots_draft` for query performance
  - See: `src-tauri/src/db/schema.rs`

**File Storage:**
- Local filesystem only
- Tauri file plugin (`@tauri-apps/plugin-fs`)
  - Used for document export (txt, json, md, txt+json formats)
  - See: `src/lib/export.ts`
- Tauri dialog plugin (`@tauri-apps/plugin-dialog`)
  - Native file save dialogs for exports

**In-Memory Caching:**
- CodeMirror EditorView state (in `$lib/stores.ts`)
- Svelte stores for AI settings, document context, app settings
- No explicit caching layer; relies on SQLite disk cache

**API Key Storage:**
- System Keychain (secure)
  - Provider: keyring crate (Rust backend)
  - Service name: `com.bryanhu.quillium`
  - Backend: macOS Keychain, Windows Credential Manager, Linux Secret Service
  - Keys stored per provider (openai, anthropic, google)
  - Tauri commands: `get_api_key`, `set_api_key`, `delete_api_key`
  - See: `src-tauri/src/keychain.rs`

## Authentication & Identity

**Auth Provider:**
- Custom (no central auth service)

**Implementation:**
- LLM API key authentication:
  - User provides API key for chosen provider in `AISettings.svelte`
  - Key stored in system keychain via `set_api_key` command
  - Lazy-loaded on first AI feature access to avoid macOS keychain prompt on startup
  - Each Tauri command call includes provider name to retrieve correct key
- No user accounts or login system
- Offline-first design: All data stored locally

## Monitoring & Observability

**Error Tracking:**
- PostHog exception capture via `posthog.captureException(err)`
  - Integrated in `src/hooks.client.ts` for unhandled errors and promise rejections
  - Called with incident code (`generateIncidentCode()`) for user correlation
  - See: `src/lib/posthog.ts`

**Logs:**
- Browser console logging (development)
- PostHog console log recording (production, if session replay enabled)
- Emergency backup system: `src/lib/errorGuard.ts`
  - Saves document state before crash
  - User can restore from crash backups after restart

**Debugging:**
- TypeScript source maps enabled
- Tauri dev tools available during development

## CI/CD & Deployment

**Hosting:**
- Desktop application distributed via:
  - Direct GitHub Releases (macOS, Windows, Linux)
  - Mac App Store (conditional build via `VITE_MAS=true`)
- Updates: Tauri auto-updater checks GitHub Releases endpoint

**CI Pipeline:**
- None detected in codebase (possible GitHub Actions in separate workflows)
- Build commands:
  - `bun run build` - Frontend (Vite SSG)
  - `bun run tauri build` - Full Tauri app
  - `bun run tauri:mas` - Mac App Store build with `--no-default-features --features mas`

**Code Signing:**
- macOS:
  - Signing identity: `468EDC933124742F56059262D0D9CA04CF9576DB` (in tauri.conf.json)
  - Entitlements: `Entitlements.mac.plist`
- Updates: minisign public key for verification (Tauri updater)

## Environment Configuration

**Required env vars (public, committed):**
- `PUBLIC_POSTHOG_KEY` - PostHog project key (optional; omit to disable analytics)
- `PUBLIC_POSTHOG_HOST` - PostHog instance URL (default if key provided: `https://us.posthog.com`)
- `VITE_MAS` - Set to `true` for Mac App Store builds (Tauri feature gate)

**Optional env vars:**
- `TAURI_DEV_HOST` - Dev server host override (default: localhost)

**Secrets location:**
- API keys: System keychain (secure storage, never in env vars or config files)
- `.env.local` - Local dev overrides (gitignored)
- Environment variables loaded via SvelteKit `$env/static/public` (compile-time, type-safe)

## Webhooks & Callbacks

**Incoming:**
- None detected

**Outgoing:**
- PostHog event capture (one-way, no callbacks)
- GitHub Releases auto-updater (polling, not webhooks)
- Tauri IPC events (within-app, see `src/routes/+page.svelte` menu listeners)

## Tauri Plugin Ecosystem

**Installed Plugins:**
- `@tauri-apps/plugin-dialog` 2.7.0 - Native file/directory/message dialogs
- `@tauri-apps/plugin-fs` 2.5.0 - File system access (read/write/delete)
- `@tauri-apps/plugin-opener` 2.5.3 - Open external URLs/files
- `@tauri-apps/plugin-process` 2.3.1 - Spawn and manage subprocesses
- `@tauri-apps/plugin-updater` 2.10.1 - Auto-updater with background checks

## Cross-Origin & CORS

**Tauri Protocol:**
- Tauri serves frontend via `tauri://localhost` custom protocol (not HTTP)
- PostHog session recording: Stylesheet CORS patched to work with Tauri protocol
  - See `patchStylesheetCORS()` in `src/lib/posthog.ts`

**OpenAI OAuth Proxy:**
- Custom fetch wrapper in `src/lib/ai/provider.ts` strips User-Agent header for CORS preflight

---

*Integration audit: 2026-04-16*
