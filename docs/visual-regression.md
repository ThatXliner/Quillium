# Visual Regression and CI Policy

Quillium's pre-merge `CI Gate` checks the behavior and presentation shared by the desktop editor,
Version History, and Omni Web Preview. It runs only for pull requests targeting `main` and does not
run again when the pull request merges.

## Pull request jobs

The workflow classifies the changed paths before starting the expensive jobs:

| Job | Runs when | Command or coverage |
|-----|-----------|------------------------------|
| Static checks | Source, configuration, or workflow code changes | `bun ci`, `bun run check:all`, `bun run landing:build` |
| Cross-package tests | Source, configuration, or workflow code changes | `bun ci`, `bun run test:all` |
| Desktop Playwright | Desktop, shared UI, dependency, or CI harness changes | Focused annotation, modal, history, and visual suite |
| Web Preview | Landing, share, publishing, Supabase, E2E, dependency, or CI harness changes | Real landing route against an ephemeral local Supabase stack |

Documentation-only changes skip those jobs. `CI Gate` still runs on the pull request and fails if
any path-selected job fails, is cancelled, or is skipped unexpectedly. Its stable name can be used
as the required status check in branch protection for `main`.

Behavioral browser jobs retain a small, finite retry budget to preserve evidence about intermittent
failures. Playwright's `failOnFlakyTests` option makes a retry-pass fail CI, so a flake cannot become
a green pull request. Desktop behavioral coverage is capped at two workers with a 60-second test
timeout; the pixel matrix runs separately with one worker and no retries to avoid contending over
its shared preview server and rendering initialization. Each browser job records its wall-clock
runtime and expected, flaky, and failed test counts in the GitHub Actions job summary.

## Canonical visual environment

Canonical image comparisons use the Bun-locked Playwright version and Chromium on Ubuntu 24.04.
Linux snapshots are canonical. A run on macOS or Windows is useful for diagnosis, but its output
must not replace the Linux baseline because font rasterization and browser rendering differ by OS.
Expected filenames retain Playwright's platform suffix (`-chromium-linux.png`); a developer run on
macOS or Windows keeps the semantic parts of each visual scenario active but ignores screenshot
comparisons by default. Set `E2E_COMPARE_NONCANONICAL_SNAPSHOTS=1` to produce separate platform
images for diagnosis; those images cannot silently overwrite the Linux baselines and must not be
committed.

The checked-in baseline sets are:

| Surface | Matrix | Expected images |
|---------|--------|-----------------|
| Desktop and Version History | Light theme at wide, tablet, and mobile sizes, plus modal and nested states; desktop does not currently expose a dark theme | `packages/desktop/tests/e2e/annotationVisualParity.pw.ts-snapshots/` |
| Omni Web Preview | Modern/legacy renderers in light/dark at wide, tablet, and mobile sizes, plus modern revision, comment, and suggestion modals | `packages/e2e/tests/webPreview.pw.ts-snapshots/` |

Dark cross-surface parity cannot be asserted until desktop exposes a dark theme. The Web Preview
dark baselines protect the dark UI that exists today without presenting duplicate light pixels as
coverage.

Animations, fixture data, clocks, generated IDs, fonts, viewport, color scheme, and device scale
factor must be fixed by the visual harness. Mask a region only when its value is genuinely
nondeterministic and irrelevant to the behavior under test. Do not mask content, layout, scroll
positions, annotation anchors, or modal geometry.

Web Preview loads the self-hosted Inter files from `@fontsource/inter`, and its visual harness pins
the document font to that family. A system-font fallback is not a valid baseline environment.

Screenshots supplement semantic assertions. Every visual scenario must retain assertions for the
state or interaction it represents; an image comparison is not a replacement for accessible names,
content, selection, scrolling, or editor-state checks.

## Running and updating baselines

Run the visual file from the repository root:

```bash
bun ci
bun run --cwd packages/desktop playwright install chromium --with-deps
CI=1 bun run --cwd packages/desktop test:e2e \
  tests/e2e/annotationVisualParity.pw.ts --workers=1 --retries=0
```

When an intentional UI change requires new expected images, run the same commands on Ubuntu 24.04
and add `--update-snapshots` to the test command:

```bash
CI=1 bun run --cwd packages/desktop test:e2e \
  tests/e2e/annotationVisualParity.pw.ts --workers=1 --retries=0 --update-snapshots
```

Review the resulting PNG diff before committing it. Baseline changes must be committed in the same
pull request as the source change and called out explicitly in the pull request description. State
which scenarios changed and why. Reviewers should inspect the old expected image, the CI actual and
diff images, and the new expected image rather than approving a filename-only change.

Web Preview baselines require the repository's ephemeral local Supabase stack and must be generated
on Ubuntu 24.04 (native or in a correctly configured container). On that Linux host, the full runner
applies local migrations and forwards the snapshot-update flag only to Playwright:

```bash
bun run --cwd packages/e2e playwright install chromium --with-deps
CI=1 bun run e2e:test:full -- --update-snapshots --retries=0
```

This produces the Linux images in `packages/e2e/tests/webPreview.pw.ts-snapshots/`. Running the same
command directly on macOS ignores screenshot assertions by default. Set
`E2E_COMPARE_NONCANONICAL_SNAPSHOTS=1` only to generate separate Darwin diagnostic images, not to
update canonical baselines. Do not use production Supabase credentials to create or update a
baseline.

Never update a baseline merely because CI produced a new actual image. First rule out missing fonts,
unfrozen time or IDs, unfinished animations, incorrect fixture state, viewport drift, clipping,
unintended responsive changes, and other harness instability.

## Acceptable differences

A baseline update is acceptable when the changed pixels are the intended result of an approved UI
or fixture change and the companion semantic assertions still pass. A rendering-engine change may
also justify an update after the whole matrix has been inspected on the canonical environment.

The parity suites currently permit at most a `0.005` changed-pixel ratio; desktop comparisons also
declare Playwright's `0.2` per-pixel color threshold explicitly. The tolerance beside each screenshot
assertion is the allowed difference. Do not raise a per-test or global threshold to hide unexplained
drift. Any threshold change needs its own review rationale and should remain as narrow as possible.
Missing content, unreadable contrast, incorrect wrapping, misplaced annotations, broken context
scrolling, and viewport-specific overflow are regressions, not acceptable baseline differences.

## Failure artifacts

On a browser failure, GitHub Actions retains an artifact for 14 days containing:

- the Playwright HTML and JSON reports;
- expected, actual, and diff images;
- the Playwright trace and failure screenshots;
- DOM snapshots attached by the visual harness; and
- the checked-in expected snapshot directory for side-by-side comparison.

Start with the HTML report, then open the trace to inspect the DOM, network, console, and action
timeline. The artifact should make the failure diagnosable without a local reproduction. If it does
not, improve the fixture or attachment rather than adding unbounded retries.
