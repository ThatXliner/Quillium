# Publish a frontend update

Use this lane to deliver presentation fixes to a specific public desktop binary.
The workflow builds static frontend assets, signs the manifest, and publishes the
archive before replacing the stable feed. It does not build a native app.

## Prepare the first native release

1. Merge the OTA bootstrap and release tooling into protected `main`.
2. Create a dedicated encrypted key with `minisign -G -p frontend-ota.pub -s frontend-ota.key`
   using the minisign command-line tool. Keep the secret key outside the repository. Do not reuse the native
   updater's Tauri key.
3. Set repository secret `FRONTEND_OTA_SIGNING_KEY` to the complete secret key
   file text. Set `FRONTEND_OTA_SIGNING_KEY_PASSWORD` if the key is encrypted.
   An absent password means an unencrypted key.
4. Set repository variable `FRONTEND_OTA_PUBLIC_KEY` to the complete public key
   file text or its `RW...` public key line.
5. Give the existing `RELEASES_REPO_PAT` access to write releases in
   `ThatXliner/quillium-releases`. The OTA workflow uses this token only in its
   publish job.
6. Configure the `frontend-ota` GitHub environment for the publish job. Add
   required reviewers if your release policy requires them.
7. Ship a public native release with the current `build.yml` workflow. Record
   the native tag and its exact source SHA. Its binary embeds the public key,
   the stable feed URL, and that SHA. A native release with an empty public key
   cannot receive frontend updates.
8. Verify that installed binary on every supported platform before publishing
   a production frontend update. Verify local draft load, cold launch, failed
   trial recovery, and saving all open windows before relaunch.

The native updater remains the path for executable changes. The MAS workflow
sets `VITE_MAS=true`, which also disables OTA in native code. Direct native
builds can use the `mas` Cargo feature for the same guard. This workflow does
not publish mobile updates.

## Check the source against its native base

Keep the native package version unchanged. Choose a separate stable frontend
version, such as `0.0.1`, and increase it for each release on that native base.
`QUILLIUM_FRONTEND_VERSION` supplies the frontend's displayed build version.
The native package version still identifies native commands and document
creation provenance.

Merge the presentation change into protected `main`. Check the exact source
commit locally, with the source commit checked out and tags fetched.

```sh
bun packages/desktop/scripts/frontend-ota.mjs validate \
	--repo . \
	--source-sha <frontend-commit-sha> \
	--native-tag v<native-version> \
	--native-sha <native-release-commit-sha> \
	--version <frontend-version> \
	--output /tmp/frontend-ota-identity.json
```

The validator requires the native base to be an ancestor of the frontend commit,
and the frontend commit to be an ancestor of `origin/main`. The native tag must
resolve to the supplied SHA. The signature binds that SHA as `nativeRevision`,
so moving a tag cannot make an older binary accept a different native base.

The first lane permits Svelte components, CSS, static assets, documentation,
and tests. It rejects changes to TypeScript, JavaScript, dependencies, lockfiles,
configuration, workflows, and native code. It protects shared core, collaboration,
updater, provenance, database, and event modules regardless of file extension.
Renaming a protected file does not bypass the check.

Review Svelte changes for persisted writes and new native command requirements.
A path check cannot prove semantic compatibility inside a component. If a change
alters draft replay, annotation models, snapshots, undo serialization, or database
writes, ship a full native release. The embedded frontend must be able to read
all writes made by an OTA frontend after rollback.

## Build signed artifacts without publication

Run the workflow from `main`. Leave `publish` false.

```sh
gh workflow run frontend-ota.yml --ref main \
	-f source_sha=<frontend-commit-sha> \
	-f native_tag=v<native-version> \
	-f native_sha=<native-release-commit-sha> \
	-f frontend_version=<frontend-version> \
	-F publish=false
```

The run requires the dedicated signing key even when publication is disabled.
Download its `frontend-ota-...` artifact. Inspect `identity.json`, `manifest.json`,
`manifest.json.minisig`, and `bundle-<frontend-version>.tar.gz`.
The signing CLI verifies the detached signature with the configured public key
before the workflow retains these files. The manifest binds the application,
stable channel, persisted format, native revision, frontend version, archive URL,
SHA-256 digest, and size.

Test the signed artifact against the intended packaged binary before rollout.
Do not infer packaged platform readiness from the frontend build or Rust tests.

## Publish the checked release

Run the same command with `-F publish=true`. The workflow checks and rebuilds the
same source, then enters the `frontend-ota` publish environment.

Publication creates `frontend-<native-version>-stable-<frontend-version>` and
uploads the archive without overwrite. It downloads those published bytes and
checks them before replacing the signed feed in
`frontend-<native-version>-stable`. Neither release becomes GitHub's latest
release, which keeps the native updater's `latest.json` route intact.

The publish job refuses a frontend version older than or equal to the current
feed. An exact retry with identical archive, manifest, and signature bytes is a
read-only success. An interrupted release can leave an unused archive. Choose a
new frontend version if a published archive has different bytes. Never overwrite
an archive to repair a release.

The manifest and detached signature are separate assets. A client that checks
between their replacements rejects the mismatch and retries later. Existing
installed assets remain available during that interval. If publication stops
between replacements, rerun with the same signed artifact bytes or publish a
newer version to finish the feed replacement.

For an approved release artifact, the underlying publication command is:

```sh
bun packages/desktop/scripts/frontend-ota.mjs publish \
	--dir <downloaded-artifact-directory> \
	--identity <downloaded-artifact-directory>/identity.json
```

Use the workflow for normal publication. Its concurrency group serializes the
feed for each native base. Do not run the publication command concurrently.
GitHub release administrators can still change hosted assets. Clients verify
signatures and archive hashes, and the publisher refuses to overwrite archives.

## Verify the packaged application

On macOS, run `bun packages/desktop/scripts/verify-frontend-ota.mjs` from the
repository root. It builds an unsigned debug `.app` with the automation bridge,
disposable signing keys, a unique application identifier, and isolated SQLite
and WebKit data. It exercises the update banner, signed download, coordinated
restart, draft and storage preservation, and offline failed-trial recovery.
It prints an evidence directory with results and screenshots. Production builds
do not enable the bridge. Windows and Linux still need packaged verification.

## Verify the release tooling

```sh
bun packages/desktop/scripts/frontend-ota-check.mjs
bun .github/scripts/release-workflow.test.mjs
```

These checks exercise real Git ancestry and rename detection, protected paths,
signed contract fields, version ordering, retry behavior, and publication order
with an in-memory GitHub transport. They do not publish a release or read secrets.
