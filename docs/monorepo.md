# Monorepo guide

Quillium is a Bun workspace monorepo. All packages live under `packages/*`; the
repository root owns dependency installation, shared tooling, Supabase migrations,
and cross-package scripts.

Architecture decision: [app-neutral editor capabilities](./adr/0009-app-neutral-editor-capabilities.md).

## Package layout

| Path | Package | Purpose |
|------|---------|---------|
| `packages/desktop` | `@quillium/desktop` | Tauri + SvelteKit desktop app |
| `packages/landing` | `@quillium/landing` | Public SvelteKit site deployed on Vercel |
| `packages/relay` | `@quillium/relay` | Omni WebSocket relay deployed with Fly/Docker |
| `packages/share` | `@quillium/share` | Canonical annotation core, shared UI, rendering utilities, and wire contracts |
| `packages/e2e` | `@quillium/e2e` | Cross-package integration and browser tests |
| `supabase` | n/a | Single source for Omni schema and migrations |

## Dependency rules

Run `bun install` from the repository root. The root `bun.lock` is the only Bun
lockfile that should be committed.

Add dependencies to the package that imports them, then run root `bun install`.
Use `workspace:*` for local package dependencies such as `@quillium/share`.

Do not commit generated package outputs such as `.svelte-kit`, `.vercel`, `build`,
`dist`, `coverage`, or `packages/desktop/src-tauri/target`.

## Common commands

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
`test:all` runs the default Vitest suites; service-backed and browser verification
have additional setup and commands in [packages/e2e/README.md](../packages/e2e/README.md).

## Shared package

`@quillium/share` is intentionally app-neutral. It can contain:

- Serialized annotation, document, and Live Room wire types.
- Pure fingerprinting, paragraph segmentation, annotation ordering, and revision
  rendering utilities.
- The canonical CodeMirror annotation fields/models plus the app-neutral
  read-only extension stack and editor host.
- Capability-driven Svelte presentation used by both desktop and public share
  pages (cards, threads, breadcrumbs, context viewports, diff content, and
  annotation-panel shells).

It must not import Supabase, PostHog, Tauri APIs, or app-specific stores. Desktop
adapters retain mutations, analytics, persistence, and modal-stack navigation;
shared components receive those capabilities through callbacks or snippets.
CodeMirror state serialization at the desktop/Supabase boundary remains in the
desktop package, while state restoration and read-only rendering are shared.

### Shared editor surface architecture

Shared presentation lives in `packages/share/src/core`, `cards`, `modals`, and
`layout`. Desktop adapters supply mutation, persistence, analytics, and
modal-stack navigation. `Readonly*` adapters compose the same presentation for
Web Preview and Version History without persistence or mutation capabilities.
Selection, modal navigation, and revision-version previews remain available.

Keep neutral presentation in the shared package and app services in desktop
adapters. Do not copy a desktop card into a second read-only implementation.
`ReadonlyDocument` and `ReadonlyEditorHost` compose shared components; they do
not subclass the desktop editor. See
[ADR-0009](adr/0009-app-neutral-editor-capabilities.md).

`LegacyReadonlyDocument` handles old public payloads without serialized editor
state and valid v2 payloads with no tabs. Its removal depends on the production
compatibility checks in [issue #339](https://github.com/ThatXliner/Quillium/issues/339).
The [collaboration guide](collaboration.md#web-preview-publication) owns payload
validation and rendering behavior.

## Environment files

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

The relay build type-checks its sources and bundles the shared Live Room contract
into `dist/index.js` with Node and esbuild. The Dockerfile pins the production Node
version; the root manifest lists supported local Node versions. The Docker build
copies `packages/share/src` to resolve that workspace dependency.

Docker and release builds pin verified runtime versions and archive hashes.
[`scripts/install-secure-bun.mjs`](../scripts/install-secure-bun.mjs) owns the
local and release Bun installer. The relay Dockerfile pins the same Bun archives
for its build stage. Both use patched stable Bun 1.4.4, exact revision
`1.4.4+38afee6c8`, with version-specific URLs and pinned SHA256 values. A changed
or unavailable archive fails closed. The production relay uses Node, without Bun.

For local dependency work during this incident, use the same verified installer:

```bash
node scripts/install-secure-bun.mjs "$PWD/.tools/secure-bun"
export PATH="$PWD/.tools/secure-bun:$PATH"
bun install --frozen-lockfile
```

Fly deploys the relay from the monorepo root so `packages/relay/Dockerfile` can
install the filtered workspace. Run Fly commands from the root and keep
`packages/relay/fly.toml` pointed at `packages/relay/Dockerfile`.

Supabase migrations stay in the root `supabase` directory. Do not create
package-local schema sources.

### Release orchestration and Rust caches

[Build Release](../.github/workflows/build.yml) receives `v*` and `mas-v*` tags
and dispatches the release on the default branch. The dispatched run validates
the tag and expected commit before using signing secrets. Build jobs check out
that commit, while the workflow definition comes from the default branch. A
successful dispatch means the downstream run started, not that publication
succeeded. Rerunning an older tag's workflow retains its historical definition.

Default-branch execution lets releases reuse dependency caches across tags.
The public and Mac App Store builds share cache keys because their native Rust
dependencies and release profiles match. If a variant changes Cargo features,
flags, or profiles, separate its key or include that configuration in the key.
Compiler and dependency changes can still cause valid cache misses.

[The cache workflow](../.github/workflows/rust-cache.yml) periodically restores
existing caches without compiling or saving them, including on a miss. Releases
seed new caches. Scheduled restores reduce idle eviction but cannot prevent
storage pressure or scheduler delays. No CI usage reduction has been measured.

To validate dispatch without building or publishing, choose an existing tag and
its exact commit:

```bash
release_tag=v0.25.0
release_sha=$(git rev-parse "$release_tag^{commit}")
default_branch=$(gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name')
gh workflow run build.yml --ref "$default_branch" \
  -f release_tag="$release_tag" -f release_sha="$release_sha" -F validate_only=true
```

Local workflow checks run with `bun .github/scripts/release-workflow.test.mjs`.
After a release seeds caches, a manual `rust-cache.yml` dispatch can check actual
restores without publication. A cache miss does not prove dependency reuse.

The repository currently has no pull-request test workflow. The
[visual verification guide](visual-regression.md) describes the checked-in local
suites and report settings.

## Verification checklist

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

### Security runtime verification

The Node bootstrap and Bun installer authenticate upstream archives with pinned
SHA256 values and assert their exact runtime versions. Bun 1.4.4 is identified as
patched in [Bun's eMudhra advisory](https://github.com/oven-sh/bun/security/advisories/GHSA-26q8-h657-pf84).
The Bun archive pins match the release's
[signed checksum manifest](https://github.com/oven-sh/bun/releases/download/bun-v1.4.4/SHASUMS256.txt.asc),
verified with signer fingerprint `F3DCC08A8572C0749B3E18888EAB4D40A7B22B59`.
The public key is recorded in
[Bun's Dockerfile at the release commit](https://github.com/oven-sh/bun/blob/38afee6c84fcf48c0edb2466aa4b27d287a59c30/dockerhub/alpine/Dockerfile).
GitHub does not mark this release immutable. The local checksum pins and exact
revision check remain authoritative, so an upstream replacement fails closed.
The relay production image runs Node 22.23.4 and contains no Bun binary.

Run `node scripts/check-bun-ca-trust.mjs` and the same script with the verified
Bun executable during security verification. Both incident hosts must fail
certificate validation through native fetch and node:https, and example.com must
succeed. Network timeouts are inconclusive. These external probes are separate
from ordinary dependency installation so a diagnostic host outage cannot block
builds. The landing server also removes all four affected trust roots at startup
while the hosting provider rolls out its patched Node runtime.
