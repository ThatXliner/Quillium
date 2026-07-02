# Monorepo Guide

Quillium is a Bun workspace monorepo. All packages live under `packages/*`; the
repository root owns dependency installation, shared tooling, Supabase migrations,
and cross-package scripts.

## Package Layout

| Path | Package | Purpose |
|------|---------|---------|
| `packages/desktop` | `@quillium/desktop` | Tauri + SvelteKit desktop app |
| `packages/landing` | `@quillium/landing` | Public SvelteKit site deployed on Vercel |
| `packages/relay` | `@quillium/relay` | Omni WebSocket relay deployed with Fly/Docker |
| `packages/share` | `@quillium/share` | Shared wire types, rendering utilities, and read-only share UI |
| `supabase` | n/a | Single source for Omni schema and migrations |

## Dependency Rules

Run `bun install` from the repository root. The root `bun.lock` is the only Bun
lockfile that should be committed.

Add dependencies to the package that imports them, then run root `bun install`.
Use `workspace:*` for local package dependencies such as `@quillium/share`.

Do not commit generated package outputs such as `.svelte-kit`, `.vercel`, `build`,
`dist`, `coverage`, or `packages/desktop/src-tauri/target`.

## Common Commands

Run commands from the root unless a package README says otherwise:

```bash
bun run desktop:dev
bun run desktop:tauri:dev
bun run landing:dev
bun run relay:dev

bun run check:all
bun run build:all
bun run test:all
```

Target one package with its root script:

```bash
bun run desktop:check
bun run landing:build
bun run relay:typecheck
bun run share:test:run
```

For package-local one-offs, use `bun run --cwd packages/<name> <script>`.

## Shared Package

`@quillium/share` is intentionally app-neutral. It can contain:

- Serialized annotation and document wire types.
- Pure fingerprinting, paragraph segmentation, annotation ordering, and revision
  rendering utilities.
- Read-only Svelte components for public share pages.

It must not import Supabase, PostHog, Tauri APIs, CodeMirror, or app-specific
stores. Desktop keeps CodeMirror-specific serialization in `packages/desktop`.

The read-only Svelte UI should visually track the desktop annotation components
first. Use these desktop files as the source of truth when changing shared share
components:

- `packages/desktop/src/lib/editor/plugins/annotations/Comment.svelte`
- `packages/desktop/src/lib/editor/plugins/annotations/Suggestion.svelte`
- `packages/desktop/src/lib/editor/plugins/annotations/Revision.svelte`
- `packages/desktop/src/lib/editor/plugins/annotations/Thread.svelte`
- `packages/desktop/src/lib/editor/plugins/annotations/ThreadMessage.svelte`

Port the read-only markup and styling into `packages/share` rather than importing
desktop components directly; the desktop components are interactive and depend on
CodeMirror, stores, analytics, and mutation callbacks.

## Environment Files

Runtime env examples live with the package that consumes them:

- `packages/desktop/.env.example`
- `packages/landing/.env.example`
- `packages/relay/.env.example`

The repository root `.env.example` is only an index. Use
`PUBLIC_SUPABASE_PUBLISHABLE_KEY` for browser-safe Supabase keys.

## Deployments

Vercel should point the `quillium-landing` project at `packages/landing` as its
project root. The landing package imports `@quillium/share` through the Bun
workspace.

Fly deploys the relay from the monorepo root so `packages/relay/Dockerfile` can
install the filtered workspace. Run Fly commands from the root and keep
`packages/relay/fly.toml` pointed at `packages/relay/Dockerfile`.

Supabase migrations stay in the root `supabase` directory. Do not create
package-local schema sources.

## Verification Checklist

Before merging monorepo-affecting changes, run the smallest relevant set:

```bash
bun install
bun run check:all
bun run test:all
```

For deployment-sensitive changes, also run:

```bash
bun run desktop:build
bun run landing:build
bun run relay:build
```

Smoke the relay locally with `/health` when relay code, Docker, Fly config, or
environment handling changes.
