# Frontend OTA

[Issue #454](https://github.com/ThatXliner/Quillium/issues/454) now has a local
implementation using a hardened Tauri v2 plugin from a commit-pinned fork. Public desktop builds
can download signed frontend assets, stage them for a full restart, and recover
after two launches that fail local readiness. The native binary stays unchanged.

The implementation is in [the pinned plugin fork](https://github.com/ThatXliner/tauri-plugin-hot-update),
[the native adapter](../packages/desktop/src-tauri/src/ota.rs), and
[the release runbook](../packages/desktop/scripts/frontend-ota-release.md).
The native [Cargo dependency](../packages/desktop/src-tauri/Cargo.toml) pins the
fork to a full commit SHA. The portable fixes are proposed in [upstream PR #2](https://github.com/yanqianglu/tauri-plugin-hot-update/pull/2).
No plugin source is copied into Quillium.

A dedicated public key and feed are baked into the first supporting native
release. Builds without that configuration, MAS builds, and mobile builds keep
using their embedded frontend. No production update has been published by this
work. An independently published plugin package remains future work.

The manifest binds the application, channel, persisted format, exact native
version and source revision. Its signature covers the archive URL, digest and
size. Installed frontend versions are ordered only within that native identity.
Corrupt initialized state disables OTA and preserves the evidence. Assets never
mix embedded and downloaded files during one process. Native and frontend update
restarts require every window to save. An active collaboration session vetoes
restart because local persistence cannot prove remote writes have drained.

The reproducible macOS packaged harness is:

```sh
bun packages/desktop/scripts/verify-frontend-ota.mjs
```

It uses disposable signing keys, an isolated app identifier and data directory,
a local feed, and a debug `.app` with the development automation bridge. It does
not publish a release. Windows and Linux packaged recovery and power-loss
durability still require platform verification before production rollout.

## Original evaluation, October 20, 2026

The remainder records the unmodified upstream sources and the original probes.
Their limitations explain the fork patches; they are not claims about the
patched implementation above.

## Recommendation

Start with upstream contributions to `tauri-plugin-hot-update`, with a pinned
fork as a fallback if the required fixes cannot land upstream. Its signed
manifest and cold-launch recovery already match most of the intended design.
Reusing those mechanisms is preferable to writing a new recovery engine.
Neither the published release nor the inspected development head meets the
complete pilot contract yet.

Use cold launches for the initial desktop pilot. Preserve Tauri's native
updater for executable changes and keep App Store distribution on its current
path. No release-time or CI savings have been measured.

## Candidates and source evidence

The crates.io versions below and both public development heads were rechecked.
The crate manifests declare `MIT OR Apache-2.0` for the two self-hosted candidates.
Their repositories are not archived. Hot-update's last push was October 18,
2026. Hotswap's last push was July 13, 2026. These observations do not establish
long-term maintenance or adoption by packaged applications.

| Candidate | Source inspected | Assessment |
|---|---|---|
| `tauri-plugin-hot-update` | [Published 0.1.1](https://crates.io/crates/tauri-plugin-hot-update/0.1.1), [development d102eb1](https://github.com/yanqianglu/tauri-plugin-hot-update/tree/d102eb1a2808268f561a77db6ab293abdc70b69e) | Preferred starting point. Verification, cold-launch staging, two-trial recovery, and failed-hash suppression exist. Compatibility and request deadlines need work. |
| `tauri-plugin-hotswap` | [Published 0.0.4](https://crates.io/crates/tauri-plugin-hotswap/0.0.4), [development d68fffa](https://github.com/denniskribl/tauri-plugin-hotswap/tree/d68fffa792cf3fe172cde9d41699d71ffbb8f463) | More changes are needed for cold launches, signed compatibility metadata, and failed-release suppression. |
| CrabNebula `tauri-plugin-ota-updater` | [Published 2.1.0](https://crates.io/crates/tauri-plugin-ota-updater/2.1.0), [integration documentation](https://docs.crabnebula.dev/plugins/over-the-air-updates/) | Source inspection found signature verification but no startup-success acknowledgement or recovery from a correctly signed crashing frontend. The published manifest declares `PolyForm-Noncommercial-1.0.0`. Licensing needs clarification before reuse. The [repository API](https://api.github.com/repos/crabnebula-dev/tauri-plugin-ota-updater) returned 404. |

The development changelog labels hot-update 0.2.0 and an unreleased
`baseVersion` addition. The latest published crate remains 0.1.1. A changelog
entry alone is not an available package release.

## Reproduced behavior

The [evaluation runner](../packages/desktop/scripts/ota-evaluation/README.md)
downloads checksum-pinned source archives and runs upstream library tests plus
the probes stored beside it. Test assertions describe current behavior,
including known limitations. A passing suite does not mean the plugin is ready
to ship. Results are local macOS library evidence; Windows, Linux, and packaged
WebViews remain unverified.

The October 20 run used macOS arm64, Rust 1.95.0, and default crate features.
The runner retains the published crates' lockfiles and supplies the checked-in
[development lockfile](../packages/desktop/scripts/ota-evaluation/development.Cargo.lock)
for the development head.
All suites passed with the behavior described below.

| Source | Upstream tests | Added probes | Total passed |
|---|---:|---:|---:|
| Hot-update 0.1.1 | 140 | 3 | 143 |
| Hotswap 0.0.4 | 110 | 2 | 112 |
| Hot-update development d102eb1 | 170 | 5 | 175 |

### Hot-update has useful recovery, with limits

The signed acquisition pipeline stages an update while the running source
stays unchanged. A new launch persists a trial marker before runtime
initialization returns. One unacknowledged launch gets another trial. A second
miss restores the previous confirmed bundle and records the failed archive
SHA-256. The same offer is then refused without another archive download.

The probe uses a real signed release, loopback HTTP, on-disk state, and fresh
runtime instances per simulated launch. It also truncates `state.json`.
Recovery then serves embedded assets, but loses the failed hashes and version
watermark. The previously failed release can be staged again. This behavior
applies to both inspected hot-update sources. Corrupt-state recovery therefore
needs a durable refusal policy before claiming persistent failure suppression.

Both sources build their HTTP client with a 30-second connection timeout and
no overall deadline. The stalled-body probe accepts a connection, sends headers
and one byte, then withholds the rest. The request remains pending beyond
32 seconds until the evaluator cancels it. The source review and this finite
observation establish a missing request bound, not a measurement of all network
failure modes.

Published 0.1.1 accepts `minShellVersion` but retains only the frontend version
and archive hash in bundle metadata. The probe stages frontend `1.1.0` on native
`1.0.0`, then starts native `1.0.1`. It still serves the OTA bundle. A minimum
native version cannot express an upper compatibility boundary.

The development head improves this with optional signed `baseVersion` metadata.
The staged-bundle probe correctly falls back to embedded assets after native
`1.0.0` changes to `1.0.1`. Two additional probes expose a remaining gap. The
same bundle is still served after that upgrade if it was already a trial or
confirmed bundle. The base check covers staged promotion, while trial retry and
confirmed selection still compare the frontend version against the native version.
The example keeps frontend `1.1.0` above both native versions so that ordinary
version ordering cannot hide the missing base check.

Relevant upstream implementation is in
[download.rs](https://github.com/yanqianglu/tauri-plugin-hot-update/blob/d102eb1a2808268f561a77db6ab293abdc70b69e/src/download.rs),
[machine.rs](https://github.com/yanqianglu/tauri-plugin-hot-update/blob/d102eb1a2808268f561a77db6ab293abdc70b69e/src/machine.rs),
and [store.rs](https://github.com/yanqianglu/tauri-plugin-hot-update/blob/d102eb1a2808268f561a77db6ab293abdc70b69e/src/store.rs).

### Hotswap needs a different cold-launch lifecycle

The probes call the actual updater functions with temporary bundle directories.
`activate_version` followed by startup compatibility resolution under the default
`SingleLaunch` policy deletes an unconfirmed bundle before its first cold trial.
The documented immediate reload flow differs from downloading now and applying
on the next full launch. A grace policy changes this behavior, but needs its own
startup-marker and interrupted-write verification.

After rollback to a confirmed bundle at sequence 1, the real check function
accepts a resolver's offer for the failed sequence 2 again. There is no persisted
failed-hash suppression in that path. The test verifies availability, not a second
download or signature check. Separately, source inspection shows that bundle
signatures cover archive bytes, leaving sequence and native compatibility outside
the signature. See
[updater.rs](https://github.com/denniskribl/tauri-plugin-hotswap/blob/d68fffa792cf3fe172cde9d41699d71ffbb8f463/src/updater.rs)
and [manifest.rs](https://github.com/denniskribl/tauri-plugin-hotswap/blob/d68fffa792cf3fe172cde9d41699d71ffbb8f463/src/manifest.rs).

## Proposed plugin contract

The standalone plugin owns acquisition, verification, asset selection, and recovery.
Quillium supplies application readiness and restart coordination. The plugin must
have no dependency on Quillium's stores, editor model, authentication, or analytics.

The pilot requires the following behavior before integration:

- Verify a detached signature over raw manifest bytes before parsing trusted
  release data. Bind frontend version, archive SHA-256, exact compressed size,
  release ordering, application identity, channel, and native compatibility in
  that manifest. Keep trust keys in the native build and support overlap during
  key rotation. Verify the complete archive before extraction.
- Require an explicit exact native base for the first pilot. A future supported
  range must include an upper boundary. Missing or malformed constraints refuse
  the offer. Retain verified constraints with the bundle and recheck every source
  at startup, including trial, confirmed, and recovery candidates. A native
  upgrade must discard incompatible assets without treating them as a failed hash.
- Order frontend releases independently of native compatibility. Do not infer
  ABI compatibility from a frontend version being numerically newer. Preserve
  downgrade protection within the selected native base and release channel.
- Bound connection time, the entire request, compressed bytes, decompressed
  bytes, entry count, and extraction work. Refuse traversal, links, special files,
  duplicate paths, and archives without an entry page. Cancel and clean up partial
  downloads. An offline check failure must never block local startup.
- Extract into a private staging directory on the same filesystem as final
  bundles. Commit bundle and state changes through ordered atomic replacements.
  Test interruption before and after each replacement, disk exhaustion, and write
  refusal. File rename alone does not prove power-loss durability. Verify directory
  synchronization and replacement behavior on every supported desktop platform.
- Persist trial identity before serving its first asset. Readiness may confirm
  only the bundle actually loaded by that launch. Staging another download during
  a trial must not confirm it. Preserve the previous working bundle until the new
  trial is confirmed, with embedded assets always available offline.
- Permit the existing two-unacknowledged-launch policy for the pilot, then recover
  and persist refusal by archive hash. A corrected release needs a new hash.
  Corrupt state must fail closed to a validated backup or disable OTA until
  explicit repair, rather than silently forget refusal history and retry.
- Replace Tauri's asset provider behind its existing app protocol. Avoid a file
  URL or localhost server that changes the origin. Verify local storage, IndexedDB,
  cookies, and authentication state across update and recovery in packaged builds.
  Validate a complete bundle before activation to avoid accidental mixtures of
  downloaded and embedded assets.

These are proposed constraints, not promises of the existing candidate APIs.
Contribution targets are bounded HTTP requests, required native constraints at
all selection paths, and corrupt-state failure suppression. Keep recovery tests
independent of Quillium so other Tauri applications can reuse them. Publishing a
separate plugin waits until those contracts pass packaged-app verification.

## Quillium integration boundary

Current assets come from `frontendDist` in
[tauri.conf.json](../packages/desktop/src-tauri/tauri.conf.json). The native
[builder](../packages/desktop/src-tauri/src/lib.rs) installs Tauri's updater,
and [install.ts](../packages/desktop/src/lib/updater/install.ts) orchestrates
download and relaunch. OTA needs a native bootstrap that selects assets before
any WebView starts, rather than a frontend redirect after the app mounts.

Each editor window has its own Svelte stores and persistence queue. The shared
SQLite connection does not drain those queues. Before an update-triggered
restart, a native coordinator must establish one restart attempt, freeze new
edits and background editorial mutations, then collect explicit save results
from every live editor window. New windows must be blocked or join that attempt.
Drain nested editor changes through their parent CodeMirror transaction path,
then checkpoint each window and await its metadata writes. Cancel the restart
on an error, a missing acknowledgement, or a deadline, and release the edit
freeze. A disappearing window needs a completed save acknowledgement; its
absence is not evidence of success.

[flushPersistence()](../packages/desktop/src/lib/editor/listeners.ts) is the
existing local checkpoint entry point. It is insufficient as a success signal
by itself. An earlier event append failure sets `persistenceFailed` and is caught
by the queue. `persistPendingCheckpoint()` then returns without throwing. The
future restart integration must expose a failure-aware result from the owning
persistence module, rather than interpret a resolved promise or a mirror store
write as a successful save. Document activity and draft content history retain
their [existing separate ownership](./adr/0003-separate-activity-from-content-history.md).

Startup confirmation must depend on local health. Confirm after native database
initialization, command registration, app-shell rendering, and successful load
and replay of any restored draft. A native coordinator must bind readiness to the
current trial and its startup window roster. Authentication, network access,
update checks, and analytics must not be readiness prerequisites. A failed draft
load must leave the trial unconfirmed.

Track the native package version, frontend release version, archive hash, and
asset source separately in diagnostics. `__APP_VERSION__` currently comes from
the frontend package at build time; it must not become the authoritative native
version after OTA. Native command compatibility comes from the running Rust
package metadata. Document creator provenance remains native-owned until a
separate schema decision explicitly adds frontend provenance.

### Rollback must preserve document readability

SQLite migrations run in Rust. An OTA bundle cannot ship a native migration or
use commands absent from its declared native base. New persisted frontend shapes
can still make older code unreadable, even when the database schema is unchanged.
Rolling back assets must never reverse document writes or SQLite migrations.

For the initial pilot, require the same snapshot, annotation, transaction-replay,
and persisted-undo formats across embedded, previous working, and trial code.
Any incompatible format or native command change takes the full-app updater
path. Keep this rule in release review and verify it with saved-draft fixtures.
Unknown replay effects must not be silently dropped to make recovery appear
successful. The existing [event-log](./adr/0001-event-log-with-snapshots.md) and
[undo](./adr/0006-lossless-persisted-undo.md) decisions remain constraints.

## Packaged pilot acceptance

Run each scenario on supported macOS architectures, Windows, and Linux. Preserve
native logs, selected bundle identity, state files, and saved-draft assertions
with each result. Library tests do not replace this matrix.

| Scenario | Required observation |
|---|---|
| Offline startup and failed update check | Existing local drafts open without waiting for the update service. |
| Valid release | Download stays staged during the session. The next full launch serves and confirms the new bundle. |
| Invalid signature, hash, size, or native constraint | No unverified extraction or incompatible activation. |
| Interrupted download or staging | Restart serves the previous source and removes partial artifacts. |
| Kill before and after trial-state replacement | Every served trial has a durable marker. No interruption bypasses recovery. |
| Correctly signed frontend that cannot start | Two unacknowledged launches recover offline to a compatible previous or embedded source. |
| Repeated failed offer, including corrupt state | The failed hash cannot enter another trial without explicit repair. |
| Native upgrade with staged, trial, or confirmed OTA | Each path rechecks native compatibility and refuses assets outside their base. |
| Two editor windows with pending edits | Restart waits for both. A failed or missing save response cancels restart. |
| Nested edits, alternate revision versions, and undo | Reopened drafts retain text, annotations, stable version IDs, and their configured undo policy. |
| Write under trial, then recover | Previous and embedded code reopen every saved draft without data loss. |
| Update and recovery with existing web storage | Origin, local storage, IndexedDB, cookies, and offline authentication state persist. |

The pilot remains blocked until the plugin contract and these packaged tests
pass. A representative frontend-only release must be measured before any claim
about CI savings. Release workflow cache work remains separate from this issue.
