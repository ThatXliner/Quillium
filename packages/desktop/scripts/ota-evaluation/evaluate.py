#!/usr/bin/env python3
"""Run pinned upstream OTA tests and Quillium probes outside the app workspace."""

import argparse
import hashlib
import io
import json
import os
import platform
import subprocess
import tarfile
import tempfile
import urllib.request
from pathlib import Path


HERE = Path(__file__).resolve().parent
DEVELOPMENT = "d102eb1a2808268f561a77db6ab293abdc70b69e"
CANDIDATES = {
    "hot-update": (
        "https://static.crates.io/crates/tauri-plugin-hot-update/tauri-plugin-hot-update-0.1.1.crate",
        "bb042f3946091427eb4d4aceba2154a0e1c8b4431435915c48e742bd550e8130",
        ["hot_update.rs", "published.rs"],
    ),
    "hotswap": (
        "https://static.crates.io/crates/tauri-plugin-hotswap/tauri-plugin-hotswap-0.0.4.crate",
        "b3550b0b6727104637a12c6c1c5270714d4a8d935de3b2b71a5fe5a111d7ffc5",
        ["hotswap.rs"],
    ),
    "development": (
        f"https://codeload.github.com/yanqianglu/tauri-plugin-hot-update/tar.gz/{DEVELOPMENT}",
        "e8f0768f5a863c327ae1d35f7066a91521b53460fddeff5a7b1825a1ac33c2ce",
        ["hot_update.rs", "development.rs"],
    ),
}


def run(command, cwd, log, env):
    """Keep complete output on disk and return a failing status on timeout."""
    print(f"{cwd.name}: {' '.join(command)} -> {log}", flush=True)
    with log.open("w") as output:
        try:
            return subprocess.run(
                command,
                cwd=cwd,
                env=env,
                stdout=output,
                stderr=subprocess.STDOUT,
                timeout=1800,
                check=False,
            ).returncode
        except subprocess.TimeoutExpired:
            output.write("\nEvaluation exceeded the 30-minute process limit.\n")
            return 124


def prepare(name, output):
    url, checksum, probes = CANDIDATES[name]
    request = urllib.request.Request(url, headers={"User-Agent": "Quillium-OTA-evaluation"})
    with urllib.request.urlopen(request, timeout=60) as response:
        archive = response.read(10 * 1024 * 1024 + 1)
    if len(archive) > 10 * 1024 * 1024:
        raise ValueError(f"{name}: source archive exceeds 10 MiB")
    if hashlib.sha256(archive).hexdigest() != checksum:
        raise ValueError(f"{name}: source archive checksum mismatch")
    destination = output / name
    destination.mkdir()
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as source:
        source.extractall(destination, filter="data")
    (root,) = destination.iterdir()
    (root / "src/quillium_probe.rs").write_text(
        "\n".join((HERE / probe).read_text() for probe in probes)
    )
    with (root / "src/lib.rs").open("a") as source:
        source.write('\n#[cfg(test)]\nmod quillium_probe;\n')
    return root


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidate", choices=["all", *CANDIDATES], default="all")
    parser.add_argument("--output", type=Path, help="New directory for sources, locks, and logs")
    args = parser.parse_args()
    if args.output:
        output = args.output.resolve()
        output.mkdir(parents=True, exist_ok=False)
    else:
        output = Path(tempfile.mkdtemp(prefix="quillium-ota-evaluation-"))
    print(f"Results: {output}", flush=True)
    env = dict(os.environ, CARGO_TARGET_DIR=str(output / "target"))
    result = {
        "platform": platform.platform(),
        "rustc": subprocess.check_output(["rustc", "-Vv"], text=True),
        "cargo": subprocess.check_output(["cargo", "-V"], text=True).strip(),
        "candidates": {},
    }
    names = CANDIDATES if args.candidate == "all" else [args.candidate]
    for name in names:
        entry = {"url": CANDIDATES[name][0], "sha256": CANDIDATES[name][1]}
        result["candidates"][name] = entry
        try:
            root = prepare(name, output)
            # Published hot-update includes a lock; other sources need resolution.
            # Save that lock with the evidence so subsequent tests use the same graph.
            lock = root / "Cargo.lock"
            if not lock.exists():
                status = run(
                    ["cargo", "generate-lockfile"], root, output / f"{name}-resolve.log", env
                )
                if status:
                    raise RuntimeError(f"dependency resolution exited {status}")
            entry["lock_sha256"] = hashlib.sha256(lock.read_bytes()).hexdigest()
            entry["exit_code"] = run(
                ["cargo", "test", "--locked", "--lib", "--", "--test-threads=1"],
                root,
                output / f"{name}-tests.log",
                env,
            )
        except Exception as error:
            entry["error"] = str(error)
            entry["exit_code"] = 1
        (output / "results.json").write_text(json.dumps(result, indent=2) + "\n")
        print(f"{name}: {entry}", flush=True)
    return int(any(entry["exit_code"] for entry in result["candidates"].values()))


if __name__ == "__main__":
    raise SystemExit(main())
