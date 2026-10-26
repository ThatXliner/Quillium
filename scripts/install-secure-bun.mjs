import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile, chmod } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const revision = "1.4.4+38afee6c8";
const archives = {
    "darwin-arm64": ["bun-darwin-aarch64", "c240d7f0ccb90c263a849fcdb09b7ee62630d921348ed6aafda86b9d577bc510"],
    "linux-arm64": ["bun-linux-aarch64", "baa6bb36f51d6e58561e02bbea825038a9df454f673d6d776e8bbf86f8c7850e"],
    "linux-x64": ["bun-linux-x64", "bf8ccbfb2b0b80159e0f9a6d15c55317add8077534dbc6130a3edb52fccb395c"],
    "win32-x64": ["bun-windows-x64", "cd2c0fccc78f3ede1f50ca827a15f063eda13d4d150a3d0674f4f6e323d864a5"],
};
const [major, minor, patch] = process.versions.node.split(".").map(Number);
const patched = (major === 22 && (minor > 23 || (minor === 23 && patch >= 4))) ||
    (major === 24 && (minor > 22 || (minor === 22 && patch >= 1))) ||
    (major > 26 || (major === 26 && (minor > 12 || (minor === 12 && patch >= 1))));
if (!patched) throw new Error("Use patched Node 22.23.4, 24.22.1, or 26.12.1 to bootstrap Bun.");
const entry = archives[`${process.platform}-${process.arch}`];
if (!entry) throw new Error(`No verified Bun archive for ${process.platform}/${process.arch}`);
const [name, expected] = entry;
const downloadOnly = process.argv[2] === "--download-only";
const destination = downloadOnly ? process.argv[3] : (process.argv[2] || join(tmpdir(), "quillium-secure-bun"));
const archive = downloadOnly ? destination : join(destination, `${name}.zip`);
const response = await fetch(`https://github.com/oven-sh/bun/releases/download/bun-v1.4.4/${name}.zip`);
if (!response.ok) throw new Error(`Bun archive download failed: HTTP ${response.status}`);
const data = Buffer.from(await response.arrayBuffer());
const actual = createHash("sha256").update(data).digest("hex");
if (actual !== expected) throw new Error(`Bun archive SHA256 mismatch: ${actual}. Review the next patched release before changing the pin.`);
await mkdir(dirname(archive), { recursive: true });
await writeFile(archive, data);
if (!downloadOnly) {
    const executable = join(destination, process.platform === "win32" ? "bun.exe" : "bun");
    const python = process.platform === "win32" ? "python" : "python3";
    execFileSync(python, [fileURLToPath(new URL("extract-secure-bun.py", import.meta.url)), archive, executable, `${name}/${process.platform === "win32" ? "bun.exe" : "bun"}`, expected], { stdio: "inherit" });
    await chmod(executable, 0o755);
    const actualRevision = execFileSync(executable, ["--revision"], { encoding: "utf8" }).trim();
    if (actualRevision !== revision) throw new Error(`Unexpected Bun revision: ${actualRevision}`);
    if (process.env.GITHUB_PATH) await writeFile(process.env.GITHUB_PATH, `${destination}\n`, { flag: "a" });
    console.log(`Verified Bun ${revision} installed at ${executable}`);
}
