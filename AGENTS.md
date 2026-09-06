# Agent guide

Quillium is a writing app built with SvelteKit, CodeMirror, and Tauri. Writers
keep alternate versions of passages inside revisions. Local drafts persist in
SQLite; Omni adds Web Preview publishing and live collaboration.

## Before changing code

- Read [CONTRIBUTING.md](CONTRIBUTING.md) for conventions and verification.
- For an unfamiliar subsystem, use the [developer guide](docs/README.md) and
  [code map](docs/file-structure.md). Read only the relevant system guides.
- Before naming or changing domain concepts, follow
  [domain guidance](docs/agents/domain.md). Before architecture changes, read
  the relevant [ADRs](docs/adr/README.md) and surface conflicts explicitly.
- For UI changes, read [BRANDING.md](BRANDING.md). For editing behavior, read
  [DESIGN.md](DESIGN.md).
- For workspace, dependency, deployment, environment, or shared-package changes,
  read [the monorepo guide](docs/monorepo.md).
- For issues and specs, follow [issue-tracker guidance](docs/agents/issue-tracker.md).
- For release notes or feature captures, follow [the changelog guide](docs/changelog.md).

## Rules that prevent expensive mistakes

- Use `isAnnotationOfType(annotation, "revision")`; never compare `_type` directly.
- Change editor content and annotations through CodeMirror transactions and
  StateEffects. Svelte editor stores mirror that state; writing a mirror does
  not edit or persist the document.
- Add undo inversion and range mapping when adding annotation effects. Check
  replay and serialization when changing persisted state.
- Revision versions use stable IDs. Use `activeVersion()` or
  `activeVersionIndex()` to resolve them; `activeVersionId` is not an array index.
- Nested editors translate edits to their parent. Keep parent authority and
  parent undo; annotation IDs are scoped to each editor, not globally unique.
- The canonical annotation models and fields live in `packages/share/src/core/`.
  Desktop `models.ts` and `annotationField.ts` are re-export shims. Shared code
  receives app capabilities; keep Tauri, analytics, auth, and app stores in adapters.
- Draft content events and snapshots are draft-scoped. Document activity records
  structural changes. Keep those histories distinct.
- Append SQLite migrations; preserve shipped migrations so existing databases upgrade.

## Commands

Run from the repository root. Install dependencies with `bun install`; keep one
root `bun.lock`. Package scripts and versions live in the package manifests.

```bash
bun run desktop:tauri:dev    # Full desktop app
bun run desktop:check        # Desktop type check
bun run desktop:test:run     # Desktop Vitest suite
bun run check:all            # All package type checks
```

Use `bun run` to invoke Vitest scripts, not `bun test`. For a focused test:

```bash
bun run --cwd packages/desktop test:run tests/lib/editor/plugins/annotations/annotationField.test.ts
```

Choose checks from [CONTRIBUTING.md](CONTRIBUTING.md#verify-your-change), including
shared-package consumers when relevant. Root `format`, `lint`, and `biome`
scripts write files; inspect their diff before including changes.
