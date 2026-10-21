# Frontend OTA implementation

## Done predicate
A packaged desktop app uses its unchanged native binary to download a freshly signed frontend, stages it without changing the current session, activates it on a later full launch, confirms local readiness, and recovers offline after failed trials. Publishing produces a signed, compatibility-bound release without native builds. Restart is blocked until all editor windows save successfully. No merge or release publication is authorized.

## Phases
1. Ground existing native updater, persistence, and release workflow.
2. Sketch two independent designs and select the smallest safe interface.
3. Harden and test reusable upstream plugin code against the evaluation failures.
4. Implement deterministic signed bundle production and release workflow.
5. Integrate app startup, update UI, and all-window save/restart.
6. Run packaged-app verification with isolated fixture data and rollback.
7. Review, commit and update PR with verified results and platform/configuration limits.

Throughput checkpoint: one owner per code seam; root owns plugin and native bootstrap, a frontend worker owns save coordination and UI, a release worker owns artifact tooling/workflow. Parallel implementation follows selected interfaces. Each phase ends with an executable check.

## Verification outcome
Phases 1–6 passed. The packaged macOS run proves signed staging, unchanged
running assets, update-banner download, save-before-restart across two windows,
activation with an unchanged native binary, retained origin and storage, and
offline rollback after two failed trial launches. `.audit/ota-results.json`
records the observed checks. Windows and Linux packaged validation remains a
production rollout prerequisite. Independent review is complete and the implementation is committed for PR #463.
Merging and release publication remain excluded.
