# Move the OTA plugin into a pinned fork

1. Create the user's fork and move the existing app-neutral plugin changes there.
2. Run the fork's full Rust suite and review its upstream diff.
3. Open an upstream PR with reproducible tests and the portable compatibility/recovery changes.
4. Pin Quillium's Cargo dependency to the fork's full commit SHA. Build release tools and packaged verification from that same revision.
5. Remove the vendored crate, update documentation and source checks, and verify the real Git dependency and packaged app.
6. Commit and push the migration to #463, then check CI. Stop before merging either PR.

The Cargo git URL and full revision are the dependency identity. The native Cargo manifest is the single source for the app, signer, and verification tools. No branch or mutable tag is a production dependency.

Throughput checkpoint: root owns fork creation and dependency migration. Independent review checks the upstream patch, tool source consistency, and deletion of the local crate before final push. Existing application logic stays unchanged.

## Result
The fork is ThatXliner/tauri-plugin-hot-update at
037129ec3ee9b5a42f84d041f0f197a814b459f1. Upstream PR #2 contains the portable
plugin changes, tests, and API documentation. The fork-only child commit retains
the verification lockfile and disposable-key example.

The local source copy is removed. The signer reads the dependency revision from
the targeted native release commit, while packaged verification uses the current
native Cargo declaration. A real Git-history regression covers policy pin drift.
The fork passed 186 tests in an isolated target directory. The consumer passed
112 native unit tests, 22 integration tests, and all 19 packaged OTA checks with
the fetched Git dependency. Independent migration review found no open issues.
Neither upstream nor consumer PR is to be merged in this task.
