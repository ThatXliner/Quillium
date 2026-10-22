# Visual regression and verification

The checked-in Playwright suites compare the desktop editor, Version History,
and Web Preview. The repository currently has release-build and Rust-cache
workflows, but no pull-request test workflow or `CI Gate`. Run the relevant
checks before merging; a pull request with no checks is not evidence of a pass.
See [CONTRIBUTING.md](../CONTRIBUTING.md#verify-your-change) for nonvisual checks.

## Canonical images

Linux is the canonical snapshot platform. Use Ubuntu 24.04 with Chromium from
the Bun-locked Playwright dependency. Rendering differs by OS, so macOS or
Windows images must not replace the Linux baselines.

| Suite | Coverage | Expected images |
|---|---|---|
| Desktop and Version History | Light theme at wide, tablet, and mobile sizes, including modal and nested states | `packages/desktop/tests/e2e/annotationVisualParity.pw.ts-snapshots/` |
| Web Preview | Modern and legacy rendering in light and dark themes at the same widths, plus revision, comment, and suggestion modals | `packages/e2e/tests/webPreview.pw.ts-snapshots/` |

Desktop does not currently expose a dark theme. Its Playwright configuration
does not skip image comparisons on other operating systems; non-Linux runs may
report missing platform-specific images. Web Preview keeps its semantic checks
but skips screenshots on macOS and Windows by default.
`E2E_COMPARE_NONCANONICAL_SNAPSHOTS=1` enables diagnostic images for Web Preview
only. Do not commit those images. Web Preview rejects `CI=1` on non-Linux hosts.

The fixtures fix time, IDs, viewport, color scheme, scale, and animations. Web
Preview uses self-hosted Inter fonts. Missing fonts or unfinished rendering
invalidate a baseline. Keep semantic assertions beside screenshots so missing
content, selection behavior, scrolling, and editor state are checked directly.

## Run the suites

Run commands from the repository root after the
[desktop environment setup](quickstart.md#install-and-configure).
Install the locked dependencies and browser:

```bash
bun install --frozen-lockfile
bun run --cwd packages/desktop playwright install chromium --with-deps
```

On the canonical Linux host, run the desktop visual matrix with one worker and
no retries:

```bash
CI=1 bun run --cwd packages/desktop test:e2e \
  tests/e2e/annotationVisualParity.pw.ts --workers=1 --retries=0
```

`CI=1` uses a production frontend build. Production builds require public
Supabase configuration. For an intentionally offline desktop fixture run,
prefix the command with `QUILLIUM_ALLOW_MISSING_SUPABASE_ENV=1`; keep the public
variable names defined as described in the quickstart.

Web Preview requires a local Supabase stack. Install Chromium for that package
and use the full runner on the Linux host:

```bash
bun run --cwd packages/e2e playwright install chromium --with-deps
CI=1 bun run e2e:test:full -- --retries=0
```

The [E2E README](../packages/e2e/README.md) covers Docker, Supabase CLI setup,
required environment variables, and the service-backed checks run before the
browser suite. Use disposable local data, never production credentials.

Both Playwright configs enable `failOnFlakyTests` under `CI=1`, so a retry-pass
still fails that run. Desktop limits CI workers to two and uses a 60-second
test timeout. The visual command above further limits workers and retries for
repeatable rendering.

## Update an intentional visual change

Add `--update-snapshots` to the corresponding command on the canonical Linux
host. The full E2E runner forwards arguments after `--` only to Playwright.

Inspect the old expected image, new actual image, and diff. Commit changed
baselines with the source change and explain which scenarios changed. First
rule out missing fonts, changing clocks or IDs, animations, incorrect fixture
state, viewport drift, and clipping. A new actual image alone does not justify
replacing the baseline.

Both suites currently allow a `0.005` changed-pixel ratio with a `0.2` per-pixel
color threshold. The options beside each screenshot assertion own those values.
Do not raise tolerances to hide unexplained differences. Missing content,
unreadable contrast, incorrect wrapping, misplaced annotations, broken context
scrolling, and overflow are regressions.

## Inspect failures

Playwright retains traces and screenshots on failure. The visual tests also
attach DOM snapshots. With `CI=1`, both configs produce JSON and HTML reports:

- Desktop writes `packages/desktop/playwright-results.json` and
  `packages/desktop/playwright-report/`.
- Web Preview writes `packages/e2e/test-results/results.json` and
  `packages/e2e/playwright-report/`.

Start with the HTML report, then use the trace to inspect the DOM, network,
console, and action timeline. Artifact uploads and retention need an automation
workflow; the repository currently does not configure them for these suites.
