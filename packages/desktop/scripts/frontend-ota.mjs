// frontend-ota.mjs validates the presentation-only release lane and publishes signed artifacts.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APPLICATION_ID = "com.bryanhu.quillium";
const STATE_FORMAT = "quillium-persisted-v1";
const RELEASE_REPO = "ThatXliner/quillium-releases";
const SHA = /^[0-9a-f]{40}$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function versionParts(value) {
    if (typeof value !== "string" || !VERSION.test(value)) {
        throw new Error("Use a stable x.y.z version without leading zeroes");
    }
    const parts = value.split(".").map(Number);
    if (!parts.every(Number.isSafeInteger)) throw new Error("Version component is too large");
    return parts;
}

export function compareVersions(left, right) {
    const a = versionParts(left);
    const b = versionParts(right);
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
    }
    return 0;
}

export function allowedPath(path) {
    if (
        !path ||
        path.includes("\\") ||
        path.split("/").some((part) => !part || part === ".." || part === ".")
    )
        return false;
    if (/^(?:docs\/|packages\/(?:desktop|share)\/tests\/)/.test(path)) return true;
    if (path.startsWith("packages/desktop/static/")) return true;
    if (/^packages\/desktop\/src\/lib\/(?:db|collab|updater|provenance|events)\//.test(path))
        return false;
    if (/^packages\/share\/src\/(?:core|collab-contract)\//.test(path)) return false;
    return /^packages\/(?:desktop|share)\/src\/.+\.(?:svelte|css)$/.test(path);
}

export function releaseIdentity({ sourceSha, nativeSha, nativeTag, version }) {
    if (!SHA.test(sourceSha ?? "") || !SHA.test(nativeSha ?? ""))
        throw new Error("Full lowercase source and native SHAs are required");
    if (typeof nativeTag !== "string" || !nativeTag.startsWith("v"))
        throw new Error("A public vX.Y.Z native tag is required");
    const nativeVersion = nativeTag.slice(1);
    versionParts(nativeVersion);
    versionParts(version);
    const feedTag = `frontend-${nativeVersion}-stable`;
    const releaseTag = `${feedTag}-${version}`;
    return {
        sourceSha,
        nativeSha,
        nativeTag,
        nativeVersion,
        version,
        feedTag,
        releaseTag,
        baseUrl: `https://github.com/${RELEASE_REPO}/releases/download/${releaseTag}`,
        contract: {
            applicationId: APPLICATION_ID,
            channel: "stable",
            stateFormat: STATE_FORMAT,
            nativeRevision: nativeSha,
        },
    };
}

export function validateSource(
    options,
    git = (args) => execFileSync("git", args, { cwd: options.repo, encoding: "utf8" }).trim(),
) {
    const identity = releaseIdentity(options);
    if (git(["rev-parse", "HEAD"]) !== identity.sourceSha)
        throw new Error("Checkout differs from source SHA");
    if (git(["rev-parse", `refs/tags/${identity.nativeTag}^{commit}`]) !== identity.nativeSha)
        throw new Error("Native tag differs from pinned SHA");
    git(["merge-base", "--is-ancestor", identity.nativeSha, identity.sourceSha]);
    git(["merge-base", "--is-ancestor", identity.sourceSha, options.mainRef ?? "origin/main"]);
    const nativeConfig = JSON.parse(
        git(["show", `${identity.nativeSha}:packages/desktop/src-tauri/tauri.conf.json`]),
    );
    if (
        nativeConfig.version !== identity.nativeVersion ||
        nativeConfig.identifier !== APPLICATION_ID
    )
        throw new Error("Native tag does not match application identity");
    const changedPaths = git([
        "diff",
        "--no-renames",
        "--name-only",
        "-z",
        identity.nativeSha,
        identity.sourceSha,
    ])
        .split("\0")
        .filter(Boolean);
    const forbidden = changedPaths.filter((path) => !allowedPath(path));
    if (forbidden.length)
        throw new Error(
            `Full native release required for protected paths:\n${forbidden.join("\n")}`,
        );
    return { ...identity, changedPaths };
}

export function checkManifest(manifest, identity, previous) {
    if (
        manifest.version !== identity.version ||
        manifest.minShellVersion !== identity.nativeVersion ||
        manifest.baseVersion !== identity.nativeVersion
    )
        throw new Error("Manifest versions differ from release identity");
    for (const [key, value] of Object.entries(identity.contract)) {
        if (manifest.contract?.[key] !== value)
            throw new Error(`Manifest contract differs at ${key}`);
    }
    if (manifest.archive?.url !== `${identity.baseUrl}/bundle-${identity.version}.tar.gz`)
        throw new Error("Archive URL is not the immutable release URL");
    if (
        !/^[0-9a-f]{64}$/.test(manifest.archive.sha256 ?? "") ||
        !Number.isSafeInteger(manifest.archive.size) ||
        manifest.archive.size <= 0
    )
        throw new Error("Invalid archive digest or size");
    if (previous && compareVersions(manifest.version, previous.version) <= 0)
        throw new Error("Frontend version must increase within the native base");
}

function run(command, args, options = {}) {
    return execFileSync(command, args, { encoding: "utf8", ...options });
}

function release(tag) {
    try {
        return JSON.parse(run("gh", ["api", `repos/${RELEASE_REPO}/releases/tags/${tag}`]));
    } catch (error) {
        if (/HTTP 404/.test(error.stderr?.toString() ?? "")) return undefined;
        throw error;
    }
}

async function download(tag, pattern, directory) {
    run("gh", [
        "release",
        "download",
        tag,
        "--repo",
        RELEASE_REPO,
        "--pattern",
        pattern,
        "--dir",
        directory,
        "--clobber",
    ]);
    return readFile(join(directory, pattern));
}

export async function publishRelease(
    directory,
    releaseInput,
    transport = { run, release, download },
) {
    // Recompute names and URLs rather than trusting a modified identity artifact.
    const identity = releaseIdentity(releaseInput);
    const manifestBytes = await readFile(join(directory, "manifest.json"));
    const manifest = JSON.parse(manifestBytes);
    checkManifest(manifest, identity);
    const archiveName = `bundle-${identity.version}.tar.gz`;
    const archive = await readFile(join(directory, archiveName));
    if (
        archive.length !== manifest.archive.size ||
        createHash("sha256").update(archive).digest("hex") !== manifest.archive.sha256
    )
        throw new Error("Archive does not match signed manifest");
    if (!(await readFile(join(directory, "manifest.json.minisig"), "utf8")).trim())
        throw new Error("Missing manifest signature");
    const temporary = await mkdtemp(join(tmpdir(), "quillium-ota-publish-"));
    try {
        const feed = transport.release(identity.feedTag);
        if (feed) {
            const previousBytes = await transport.download(
                identity.feedTag,
                "manifest.json",
                temporary,
            );
            const previous = JSON.parse(previousBytes);
            if (previous.version === manifest.version && previousBytes.equals(manifestBytes)) {
                const previousSignature = await transport.download(
                    identity.feedTag,
                    "manifest.json.minisig",
                    temporary,
                );
                const previousArchive = await transport.download(
                    identity.releaseTag,
                    archiveName,
                    temporary,
                );
                if (!previousArchive.equals(archive)) {
                    throw new Error("Existing archive differs from retry artifacts");
                }
                if (
                    previousSignature.equals(
                        await readFile(join(directory, "manifest.json.minisig")),
                    )
                )
                    return;
            } else {
                checkManifest(manifest, identity, previous);
            }
        }

        let bundleRelease = transport.release(identity.releaseTag);
        if (!bundleRelease) {
            transport.run("gh", [
                "release",
                "create",
                identity.releaseTag,
                "--repo",
                RELEASE_REPO,
                "--draft",
                "--latest=false",
                "--title",
                `Quillium frontend ${identity.version}`,
                "--notes",
                `Native ${identity.nativeTag} (${identity.nativeSha}). Frontend source ${identity.sourceSha}.`,
            ]);
            bundleRelease = transport.release(identity.releaseTag);
        }
        const existing = bundleRelease.assets.find((asset) => asset.name === archiveName);
        if (!existing) {
            if (!bundleRelease.draft)
                throw new Error(
                    "Published archive release is incomplete; use a new frontend version",
                );
            transport.run("gh", [
                "release",
                "upload",
                identity.releaseTag,
                "--repo",
                RELEASE_REPO,
                join(directory, archiveName),
            ]);
        }
        if (bundleRelease.draft)
            transport.run("gh", [
                "release",
                "edit",
                identity.releaseTag,
                "--repo",
                RELEASE_REPO,
                "--draft=false",
                "--latest=false",
            ]);
        const remoteArchive = await transport.download(identity.releaseTag, archiveName, temporary);
        if (!remoteArchive.equals(archive))
            throw new Error("Published archive differs; immutable assets are never overwritten");
        if (!feed)
            transport.run("gh", [
                "release",
                "create",
                identity.feedTag,
                "--repo",
                RELEASE_REPO,
                "--latest=false",
                "--title",
                `Quillium frontend feed for ${identity.nativeVersion}`,
                "--notes",
                "Signed stable frontend manifest. Native updater releases remain separate.",
            ]);
        // A reader between these replacements rejects the mismatched signature and retries later.
        transport.run("gh", [
            "release",
            "upload",
            identity.feedTag,
            "--repo",
            RELEASE_REPO,
            "--clobber",
            join(directory, "manifest.json.minisig"),
            join(directory, "manifest.json"),
        ]);
        const remoteManifest = await transport.download(
            identity.feedTag,
            "manifest.json",
            temporary,
        );
        const remoteSignature = await transport.download(
            identity.feedTag,
            "manifest.json.minisig",
            temporary,
        );
        if (
            !remoteManifest.equals(manifestBytes) ||
            !remoteSignature.equals(await readFile(join(directory, "manifest.json.minisig")))
        )
            throw new Error("Published feed differs from local artifacts");
    } finally {
        await rm(temporary, { recursive: true, force: true });
    }
}

async function main() {
    const [command, ...args] = process.argv.slice(2);
    const options = {};
    const flags = new Map([
        ["--repo", "repo"],
        ["--source-sha", "sourceSha"],
        ["--native-tag", "nativeTag"],
        ["--native-sha", "nativeSha"],
        ["--version", "version"],
        ["--main-ref", "mainRef"],
        ["--output", "output"],
        ["--dir", "directory"],
        ["--identity", "identity"],
    ]);
    for (let i = 0; i < args.length; i += 2) {
        const key = flags.get(args[i]);
        if (!key || !args[i + 1] || options[key] !== undefined)
            throw new Error(`Invalid argument ${args[i]}`);
        options[key] = args[i + 1];
    }
    if (command === "validate") {
        const identity = validateSource(options);
        const json = `${JSON.stringify(identity, null, 2)}\n`;
        if (options.output) await writeFile(options.output, json);
        process.stdout.write(json);
    } else if (command === "publish" && options.directory && options.identity) {
        await publishRelease(
            resolve(options.directory),
            JSON.parse(await readFile(options.identity, "utf8")),
        );
    } else {
        throw new Error(
            "Use validate --repo DIR --source-sha SHA --native-tag vX.Y.Z --native-sha SHA --version X.Y.Z [--output FILE], or publish --dir DIR --identity FILE",
        );
    }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
}
