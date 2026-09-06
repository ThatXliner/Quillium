# Contributing to Quillium

Start with the [quickstart](docs/quickstart.md) to run the app and the
[developer guide](docs/README.md) to find the system you want to change.

## Plan and submit a change

Check [GitHub Issues](https://github.com/ThatXliner/Quillium/issues) for existing
work. Describe a bug with reproduction steps, expected behavior, and actual
behavior. Discuss new features or substantial behavior changes in an issue;
small fixes can go straight to a pull request.

Keep each change focused. In the pull request, explain the user-visible problem,
the resulting behavior, and how you verified it. Link the issue when there is one.
Include screenshots for visual changes and mention any remaining limitations.

Use descriptive commits, such as `fix(editor): preserve selection on version
switch` or `docs: explain nested editor ownership`. Review feedback should focus
on the code and make the reason for a requested change clear.

## Code conventions

[biome.json](biome.json) owns formatting rules: four-space indentation, two spaces
for JSON, a 100-character line width, semicolons, trailing commas, and organized
imports. Match the surrounding code and avoid unrelated formatting churn.

- Use TypeScript with explicit parameter and return types. Handle missing values
  deliberately; pure query helpers return `undefined` or `null` for missing
  results rather than throwing.
- Prefer named exports. Keep internal helpers private and expose only the API
  callers need. Prefix internal helpers with `_` where that is the module
  convention, and use its `index.ts` exports for the public API.
- Use `camelCase.ts` for modules, `PascalCase.svelte` for components,
  `.svelte.ts` for rune-based state, `.test.ts` for Vitest, and `.pw.ts` for
  Playwright. Prefer Svelte 5 runes for new component-local reactive state.
- Shared state belongs in the owning store or controller. Editor-derived stores
  are mirrors; edit through CodeMirror commands. Read
  [state management](docs/state-management.md) before changing that boundary.
- Use `isAnnotationOfType()` for annotation type checks. Read
  [annotations](docs/annotations.md) for effect inversion, range mapping, lifecycle,
  and stable version IDs.
- Start module comments with the filename and purpose, then explain non-obvious
  constraints and interactions. Error logs
  should include the module name and original error, such as
  `console.error("[module] save failed", error)`.

Use the [glossary](CONTEXT.md) consistently in code, tests, and documentation.
Read [DESIGN.md](DESIGN.md) before changing editing semantics and
[BRANDING.md](BRANDING.md) before changing visuals or product copy.

## Verify your change

Run commands from the repository root. Vitest is invoked through `bun run`;
`bun test` uses a different test runner.

| Change | Checks to run |
|---|---|
| Desktop TypeScript or Svelte | `bun run desktop:check` and relevant desktop tests |
| Shared state or presentation | `bun run check:all`, `bun run share:test:run`, and affected desktop/E2E tests |
| Relay | `bun run relay:typecheck` and `bun run relay:test:run` |
| Landing site | `bun run landing:check` and `bun run landing:build` |
| Rust backend | `cargo test --manifest-path packages/desktop/src-tauri/Cargo.toml` and exercise the path in Tauri |
| Workspace or deployment wiring | The [monorepo verification checklist](docs/monorepo.md#verification-checklist) |
| Documentation only | Check links, source paths, command names, and claims against current code |

For a focused annotation test:

```bash
bun run --cwd packages/desktop test:run tests/lib/editor/plugins/annotations/annotationField.test.ts
```

For the default cross-package checks:

```bash
bun run check:all
bun run test:all
```

`test:all` does not run every browser or service-backed test. Choose those from
[visual regression and CI](docs/visual-regression.md) and the
[cross-package E2E guide](packages/e2e/README.md). CI selects suites by changed
paths; documentation-only changes skip code jobs.

For editor behavior, exercise the actual user action as well as its undo and redo.
For persistence changes, reopen the draft in Tauri and inspect the restored state.
A browser test with mocked Tauri calls does not verify the native database.

The root `format`, `lint`, and `biome` scripts all write files. Use
`bunx biome check path/to/changed.ts` for a focused read-only check, or inspect the
working diff after running the write scripts.

## Update the owning documentation

Keep setup in the [quickstart](docs/quickstart.md), architecture explanations in
the relevant [system guide](docs/README.md), and package boundaries in the
[monorepo guide](docs/monorepo.md). Link to those pages instead of copying them.
Update an explanation when the code changes its assumptions.

Use [architecture decision records](docs/adr/README.md) for resolved decisions
with lasting tradeoffs. Agent rules live in [AGENTS.md](AGENTS.md); CLAUDE.md
points there so both entry points use the same instructions.

Analytics events and their conventions live in the
[PostHog catalog](docs/posthog-events.md). Release notes and screenshot capture
instructions live in the [changelog guide](docs/changelog.md).

Maintainers handle releases. Suggest a version bump in the pull request when
appropriate: major for breaking changes, minor for features, patch for fixes.
The in-app changelog gets entries for minor bumps only.
