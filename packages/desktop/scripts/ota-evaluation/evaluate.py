#!/usr/bin/env python3
"""evaluate.py runs pinned upstream OTA suites and Quillium probes outside the workspace."""

import argparse
import hashlib
import io
import json
import os
import platform
import signal
import subprocess
import tarfile
import tempfile
import urllib.request
from pathlib import Path


HERE = Path(__file__).resolve().parent
PROCESS_TIMEOUT_SECONDS = 30 * 60
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
    print(f"{cwd.name}: {' '.join(command)} -> {log}", flush=True)
    with log.open("w") as output:
        process = subprocess.Popen(
            command,
            cwd=cwd,
            env=env,
            stdout=output,
            stderr=subprocess.STDOUT,
            start_new_session=os.name == "posix",
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
        )
        try:
            return process.wait(timeout=PROCESS_TIMEOUT_SECONDS)
        except (subprocess.TimeoutExpired, KeyboardInterrupt) as error:
            if os.name == "nt":
                subprocess.run(
                    ["taskkill", "/F", "/T", "/PID", str(process.pid)],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.STDOUT,
                    timeout=10,
                    check=True,
                )
            else:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            process.wait()
            if isinstance(error, KeyboardInterrupt):
                raise
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
    if name == "development":
        (root / "Cargo.lock").write_bytes((HERE / "development.Cargo.lock").read_bytes())
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
            lock = root / "Cargo.lock"
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
