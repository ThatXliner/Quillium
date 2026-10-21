# Reproduce the frontend OTA evaluation

Run the upstream library suites and Quillium's characterization probes for
[issue #454](https://github.com/ThatXliner/Quillium/issues/454).
The [evaluation and proposed contract](../../../../docs/frontend-ota.md)
explain the findings and the remaining pilot requirements.

You need Python 3.12 or newer, Rust, Cargo, network access, and the
[Tauri desktop prerequisites](https://v2.tauri.app/start/prerequisites/)
for your operating system. No signing credentials or Quillium user data are used.

From the repository root, run:

```bash
python3 packages/desktop/scripts/ota-evaluation/evaluate.py
```

The runner prints a temporary output directory and each command's log path.
First compilation downloads Rust dependencies and can take several minutes.
Each hot-update suite also holds an HTTP response open for 32 seconds to test
the client's connection-only timeout.

To run one candidate and retain results at a chosen location, run:

```bash
python3 packages/desktop/scripts/ota-evaluation/evaluate.py \
	--candidate development --output /tmp/quillium-ota-development
```

The output path must not exist. Candidate names are `hot-update`, `hotswap`,
and `development`. The default `all` runs them sequentially with a shared
Cargo target directory. Each run leaves sources, Cargo lockfiles, complete
test logs, and `results.json` with source checksums, toolchain, platform, and
exit codes. Remove the output directory when you no longer need those files.

Each Cargo command has a 30-minute deadline. A timeout or keyboard interrupt
terminates its process tree before the runner continues or exits.

To check the runner's command output and timeout cleanup without compiling Rust, run:

```bash
python3 -B -m unittest discover -s packages/desktop/scripts/ota-evaluation -p 'test_*.py'
```

Sources are pinned by archive SHA-256. The runner adds test modules only in
the temporary copies. Both published crates include their own Cargo lockfiles.
The development head uses the checked-in `development.Cargo.lock` from the
October 20 evaluation. Every suite runs with `--locked`. To repeat a suite with
that same dependency graph, run from its extracted source directory:

```bash
cargo test --locked --lib -- --test-threads=1
```

A zero exit code means the observed behavior matches the probes. Several
probes deliberately assert a limitation, including re-offering a failed
release or serving a bundle after its native base changes. Passing these
tests does **not** qualify a candidate for production. If upstream behavior
changes, update both the assertions and the evaluation after investigating.

These are library tests with real files, signing, and loopback HTTP where
the candidate provides them. The hotswap re-offer probe uses a deterministic
resolver and calls the real updater check function. No probe launches a
packaged WebView, kills an OS process, or simulates a power failure. Run the
packaged-app matrix in the evaluation before enabling a pilot.
