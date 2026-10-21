import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    allowedPath,
    checkManifest,
    compareVersions,
    publishRelease,
    releaseIdentity,
    validateSource,
} from "./frontend-ota.mjs";

const options = {
    sourceSha: "a".repeat(40),
    nativeSha: "b".repeat(40),
    nativeTag: "v0.25.3",
    version: "0.0.2",
};
const identity = releaseIdentity(options);
for (const path of [
    "packages/desktop/src/lib/ui/Button.svelte",
    "packages/desktop/src/routes/+page.svelte",
    "packages/desktop/src/app.css",
    "packages/share/src/cards/CommentCard.svelte",
    "packages/desktop/static/marker.txt",
    "docs/frontend-ota.md",
    "packages/desktop/tests/ota.test.ts",
])
    assert(allowedPath(path), `Expected presentation lane to allow ${path}`);
for (const path of [
    "packages/desktop/src-tauri/src/lib.rs",
    "crates/tauri-plugin-hot-update/src/machine.rs",
    "packages/desktop/src-tauri/capabilities/default.json",
    "packages/desktop/src-tauri/tauri.conf.json",
    "packages/desktop/package.json",
    "packages/share/package.json",
    "bun.lock",
    "Cargo.lock",
    "packages/desktop/src/lib/editor/replay.ts",
    "packages/desktop/src/lib/editor/persistentHistory.ts",
    "packages/desktop/src/lib/editor/extensions.ts",
    "packages/desktop/src/lib/editor/restore.ts",
    "packages/desktop/src/lib/editor/listeners.ts",
    "packages/desktop/src/lib/editor/plugins/annotations/models.ts",
    "packages/share/src/core/annotations.css",
    "packages/share/src/core/models.ts",
    "packages/share/src/collab-contract/index.ts",
    "packages/desktop/src/lib/db/index.ts",
    "packages/desktop/src/lib/collab/View.svelte",
    "packages/desktop/src/lib/updater/UpdatePrompt.svelte",
    "packages/desktop/src/lib/provenance/Badge.svelte",
    "packages/desktop/src/lib/events/foo.css",
    ".github/workflows/build.yml",
    "packages/desktop/vite.config.js",
    "packages/desktop/src/lib/ui/../../db/evil.svelte",
    "packages/desktop/src//evil.css",
    "packages/desktop/src/lib/ui/Bad.svelte.ts",
    "packages/desktop/src\\lib\\ui\\Bad.svelte",
])
    assert(!allowedPath(path), `Expected native release for ${path}`);
for (const version of [
    "1",
    "01.0.0",
    "1.0.0-beta.1",
    "1.0.0+build",
    "1.0.0\n",
    "9007199254740992.0.0",
]) {
    assert.throws(() => releaseIdentity({ ...options, version }));
}
for (const changed of [
    { sourceSha: "main" },
    { nativeSha: "A".repeat(40) },
    { nativeTag: "mas-v0.25.3" },
    { nativeTag: "v0.25.3;id" },
]) {
    assert.throws(() => releaseIdentity({ ...options, ...changed }));
}
assert.equal(compareVersions("0.0.1", "0.25.3"), -1);
assert.equal(compareVersions("1.0.0", "0.99.99"), 1);
assert.equal(compareVersions("0.0.10", "0.0.2"), 1);
assert.equal(compareVersions("0.0.2", "0.0.2"), 0);

const archive = Buffer.from("signed archive fixture");
const manifest = {
    version: identity.version,
    minShellVersion: identity.nativeVersion,
    baseVersion: identity.nativeVersion,
    contract: identity.contract,
    archive: {
        url: `${identity.baseUrl}/bundle-${identity.version}.tar.gz`,
        sha256: createHash("sha256").update(archive).digest("hex"),
        size: archive.length,
    },
};
checkManifest(manifest, identity, { version: "0.0.1" });
for (const previous of ["0.0.2", "0.0.3", "0.25.3"])
    assert.throws(() => checkManifest(manifest, identity, { version: previous }));
for (const key of Object.keys(identity.contract)) {
    assert.throws(() =>
        checkManifest(
            { ...manifest, contract: { ...manifest.contract, [key]: "wrong" } },
            identity,
        ),
    );
}
for (const patch of [
    { baseVersion: null },
    { minShellVersion: "0.25.2" },
    { version: "0.0.3" },
    { archive: { ...manifest.archive, url: "https://evil.test/bundle.tar.gz" } },
]) {
    assert.throws(() => checkManifest({ ...manifest, ...patch }, identity));
}

const fixture = await mkdtemp(join(tmpdir(), "quillium-ota-test-"));
try {
    const repo = join(fixture, "repo");
    await mkdir(repo);
    const git = (args) =>
        execFileSync("git", args, {
            cwd: repo,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
            env: {
                ...process.env,
                GIT_AUTHOR_NAME: "OTA test",
                GIT_AUTHOR_EMAIL: "ota@example.test",
                GIT_COMMITTER_NAME: "OTA test",
                GIT_COMMITTER_EMAIL: "ota@example.test",
            },
        }).trim();
    const put = async (path, content) => {
        await mkdir(join(repo, path, ".."), { recursive: true });
        await writeFile(join(repo, path), content);
    };
    git(["init", "-b", "main"]);
    await put(
        "packages/desktop/src-tauri/tauri.conf.json",
        JSON.stringify({ version: "0.25.3", identifier: "com.bryanhu.quillium" }),
    );
    await put("packages/desktop/src/lib/editor/replay.ts", "original codec");
    git(["add", "."]);
    git(["commit", "-m", "native base"]);
    const nativeSha = git(["rev-parse", "HEAD"]);
    git(["tag", "v0.25.3"]);
    await put("packages/desktop/src/lib/ui/Button.svelte", "<button>Presentation fix</button>");
    git(["add", "."]);
    git(["commit", "-m", "frontend fix"]);
    const sourceSha = git(["rev-parse", "HEAD"]);
    git(["update-ref", "refs/remotes/origin/main", sourceSha]);
    const actualOptions = { ...options, repo, nativeSha, sourceSha };
    assert.deepEqual(validateSource(actualOptions).changedPaths, [
        "packages/desktop/src/lib/ui/Button.svelte",
    ]);
    assert.throws(() => validateSource({ ...actualOptions, nativeSha: sourceSha }));
    assert.throws(() => validateSource({ ...actualOptions, sourceSha: nativeSha }));
    git(["update-ref", "refs/remotes/origin/main", nativeSha]);
    assert.throws(() => validateSource(actualOptions), "An unmerged commit must fail");
    git(["update-ref", "refs/remotes/origin/main", sourceSha]);
    git([
        "mv",
        "packages/desktop/src/lib/editor/replay.ts",
        "packages/desktop/src/lib/editor/replay.svelte",
    ]);
    git(["commit", "-m", "rename codec"]);
    const renamedSha = git(["rev-parse", "HEAD"]);
    git(["update-ref", "refs/remotes/origin/main", renamedSha]);
    assert.throws(
        () => validateSource({ ...actualOptions, sourceSha: renamedSha }),
        /replay\.ts/,
        "Renames must check the deleted protected path",
    );

    const directory = join(fixture, "release");
    await mkdir(directory);
    await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest));
    await writeFile(join(directory, "manifest.json.minisig"), "signature fixture");
    await writeFile(join(directory, `bundle-${identity.version}.tar.gz`), archive);
    function transport({
        previous,
        publishedArchive = archive,
        draft = true,
        oldSignature = false,
    } = {}) {
        const commands = [];
        let created = false;
        return {
            commands,
            release(tag) {
                if (tag === identity.feedTag) return previous && { draft: false, assets: [] };
                if (!created) return undefined;
                return { draft, assets: [] };
            },
            run(command, args) {
                commands.push([command, ...args]);
                if (
                    args[0] === "release" &&
                    args[1] === "create" &&
                    args[2] === identity.releaseTag
                )
                    created = true;
            },
            async download(tag, name) {
                if (name.endsWith(".tar.gz")) return publishedArchive;
                if (name.endsWith(".minisig"))
                    return Buffer.from(
                        oldSignature && !commands.some((command) => command.includes("--clobber"))
                            ? "old signature"
                            : "signature fixture",
                    );
                const published = commands.some((command) => command.includes("--clobber"));
                return Buffer.from(JSON.stringify(previous && !published ? previous : manifest));
            },
        };
    }
    const first = transport();
    await publishRelease(directory, identity, first);
    const uploadArchive = first.commands.findIndex(
        (command) => command.includes("upload") && command.includes(identity.releaseTag),
    );
    const publishArchive = first.commands.findIndex(
        (command) => command.includes("edit") && command.includes(identity.releaseTag),
    );
    const uploadFeed = first.commands.findIndex((command) => command.includes("--clobber"));
    assert(uploadArchive >= 0 && publishArchive > uploadArchive && uploadFeed > publishArchive);
    assert(
        first.commands
            .filter((command) => command.includes("create") || command.includes("edit"))
            .every((command) => command.includes("--latest=false")),
        "OTA must never replace the native latest release",
    );
    assert(
        !first.commands[uploadArchive].includes("--clobber"),
        "Archive bytes must never be overwritten",
    );
    const retry = transport({ previous: manifest });
    await publishRelease(directory, identity, retry);
    assert.equal(retry.commands.length, 0, "An exact successful retry must be a read-only no-op");
    const repair = transport({ previous: manifest, oldSignature: true });
    await publishRelease(directory, identity, repair);
    assert(
        repair.commands.some((command) => command.includes("--clobber")),
        "A partial feed replacement must be repairable with the original signed artifact",
    );
    const newer = transport({ previous: { version: "0.0.1" } });
    await publishRelease(directory, identity, newer);
    assert(newer.commands.some((command) => command.includes("--clobber")));
    const stale = transport({ previous: { version: "0.0.2" } });
    await assert.rejects(publishRelease(directory, identity, stale), /must increase/);
    assert.equal(stale.commands.length, 0);
    const mismatch = transport({ publishedArchive: Buffer.from("different remote bytes") });
    await assert.rejects(
        publishRelease(directory, identity, mismatch),
        /Published archive differs/,
    );
    assert(!mismatch.commands.some((command) => command.includes("--clobber")));
    const interrupted = transport({ draft: false });
    await assert.rejects(publishRelease(directory, identity, interrupted), /incomplete/);
    assert(!interrupted.commands.some((command) => command.includes("upload")));
    await writeFile(join(directory, `bundle-${identity.version}.tar.gz`), "corrupt");
    const corrupt = transport();
    await assert.rejects(publishRelease(directory, identity, corrupt), /does not match/);
    assert.equal(corrupt.commands.length, 0);
} finally {
    await rm(fixture, { recursive: true, force: true });
}

const root = new URL("../../../", import.meta.url);
const workflow = Bun.YAML.parse(
    await readFile(new URL(".github/workflows/frontend-ota.yml", root), "utf8"),
);
const native = Bun.YAML.parse(await readFile(new URL(".github/workflows/build.yml", root), "utf8"));
assert.equal(workflow.on.workflow_dispatch.inputs.publish.default, false);
assert.equal(workflow.permissions.contents, "read");
assert.equal(workflow.concurrency["cancel-in-progress"], false);
assert.equal(workflow.jobs.publish.environment, "frontend-ota");
assert.equal(workflow.jobs.publish.needs, "build");
assert.match(workflow.jobs.publish.if, /inputs\.publish/);
assert.equal(
    workflow.jobs.build.steps.find((step) => step.name === "Check out frontend source").with.ref,
    "${{ inputs.source_sha }}",
);
const signing = workflow.jobs.build.steps.find(
    (step) => step.name === "Sign and verify release artifacts",
);
assert.match(signing.run, /--native-revision/);
assert.match(signing.run, /--public-key/);
assert.match(signing.run, /trap 'rm -f/);
assert.equal(
    signing.env.HOT_UPDATE_KEY_PASSWORD,
    "${{ secrets.FRONTEND_OTA_SIGNING_KEY_PASSWORD }}",
);
const nativeBuild = native.jobs["build-tauri"].steps.find((step) => step.name === "Build the app");
assert.equal(
    nativeBuild.env.QUILLIUM_OTA_NATIVE_REVISION,
    "${{ needs.prepare-release.outputs.sha }}",
);
assert.equal(nativeBuild.env.QUILLIUM_OTA_PUBLIC_KEY, "${{ vars.FRONTEND_OTA_PUBLIC_KEY }}");
assert.match(
    nativeBuild.env.QUILLIUM_OTA_MANIFEST_URL,
    /frontend-\{nativeVersion\}-stable\/manifest\.json$/,
);
const mas = native.jobs["build-mas"].steps.find((step) => step.name === "Build MAS app (arm64)");
assert.equal(mas.env.VITE_MAS, "true");
assert(!mas.run.includes("--features mas"), "Historical native tags must remain buildable");
assert(!mas.env.QUILLIUM_OTA_PUBLIC_KEY);
console.log(
    "Frontend OTA path, git ancestry, signed contract, publication order, and workflow checks passed.",
);
