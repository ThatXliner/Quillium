import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../../", import.meta.url);
const release = Bun.YAML.parse(
    await readFile(new URL(".github/workflows/build.yml", root), "utf8"),
);
const keepalive = Bun.YAML.parse(
    await readFile(new URL(".github/workflows/rust-cache.yml", root), "utf8"),
);
const sha = "1234567890abcdef1234567890abcdef12345678";
const repo = { owner: "ThatXliner", repo: "Quillium" };
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const dispatchScript = release.jobs["dispatch-release"].steps[0].with.script;
const prepareScript = release.jobs["prepare-release"].steps[0].with.script;

async function runScript(script, context, resolveCommit = async () => ({ data: { sha } })) {
    const dispatches = [];
    const lookups = [];
    const outputs = {};
    let summary = "";
    await new AsyncFunction("github", "context", "core", script)(
        {
            rest: {
                actions: {
                    createWorkflowDispatch: async (request) => dispatches.push(request),
                },
                repos: {
                    getCommit: async (request) => {
                        lookups.push(request);
                        return resolveCommit(request);
                    },
                },
            },
        },
        context,
        {
            setOutput: (key, value) => {
                outputs[key] = value;
            },
            summary: {
                addRaw(value) {
                    summary += value;
                    return this;
                },
                async write() {},
            },
        },
    );
    return { dispatches, lookups, outputs, summary };
}

function context(tag = "v0.25.0", commit = sha) {
    return {
        repo,
        ref: "refs/heads/main",
        sha: "f".repeat(40),
        serverUrl: "https://github.com",
        payload: {
            repository: { default_branch: "main" },
            inputs: { release_tag: tag, release_sha: commit },
        },
    };
}

for (const tag of ["v0.25.0", "mas-v0.25.0-build.7", "vpreview+1"]) {
    const push = { ...context(tag), ref: `refs/tags/${tag}`, sha };
    const dispatched = await runScript(dispatchScript, push);
    assert.deepEqual(dispatched.dispatches, [
        {
            ...repo,
            workflow_id: "build.yml",
            ref: "main",
            inputs: { release_tag: tag, release_sha: sha, validate_only: "false" },
        },
    ]);
    assert.match(dispatched.summary, /Follow release runs/);
    assert.match(dispatched.summary, /does not wait for the release/);
    const prepared = await runScript(prepareScript, context(tag));
    assert.deepEqual(prepared.outputs, { tag, sha });
    assert.deepEqual(prepared.lookups, [{ ...repo, ref: `refs/tags/${tag}` }]);
}

const annotated = await runScript(prepareScript, context(), async (request) => {
    assert.equal(request.ref, "refs/tags/v0.25.0");
    return { data: { sha, commit: { message: "Resolved annotated release tag" } } };
});
assert.deepEqual(annotated.outputs, { tag: "v0.25.0", sha });

await assert.rejects(runScript(prepareScript, { ...context(), ref: "refs/heads/feature" }));
await assert.rejects(runScript(prepareScript, { ...context(), ref: "refs/tags/v0.25.0" }));
for (const tag of [undefined, "", "main", "v", "v1/other", "v1\n", "v1;id", "v$(id)", "v`id`"]) {
    await assert.rejects(runScript(prepareScript, context(tag === undefined ? null : tag)));
}
for (const commit of [null, "", "abc123", "A".repeat(40), "g".repeat(40), `${sha}\n`]) {
    await assert.rejects(runScript(prepareScript, context("v0.25.0", commit)));
}
await assert.rejects(
    runScript(prepareScript, context(), async () => ({ data: { sha: "e".repeat(40) } })),
);
await assert.rejects(
    runScript(prepareScript, context(), async () => {
        throw new Error("Tag does not exist");
    }),
);

function condition(job, values) {
    const dependencies = [job.needs ?? []].flat();
    if (dependencies.some((name) => values.needs?.[name]?.result !== "success")) return false;
    const expression = job.if
        .replace(/^\$\{\{\s*|\s*\}\}$/g, "")
        .replace(/needs\.([\w-]+)/g, (_, name) => `needs[${JSON.stringify(name)}]`);
    return Boolean(
        new Function(
            "github",
            "inputs",
            "needs",
            "startsWith",
            "format",
            `return (${expression});`,
        )(
            values.github,
            values.inputs ?? {},
            values.needs ?? {},
            (value, prefix) => value.startsWith(prefix),
            (template, value) => template.replace("{0}", value),
        ),
    );
}

const cases = [
    ["push", "v0.25.0", false, "success", "success", [true, false, false, false, false]],
    ["push", "mas-v0.25.0", false, "success", "success", [true, false, false, false, false]],
    ["workflow_dispatch", "v0.25.0", false, "success", "success", [false, true, true, true, true]],
    [
        "workflow_dispatch",
        "mas-v0.25.0",
        false,
        "success",
        "skipped",
        [false, true, false, true, false],
    ],
    [
        "workflow_dispatch",
        "v0.25.0",
        true,
        "success",
        "skipped",
        [false, true, false, false, false],
    ],
    [
        "workflow_dispatch",
        "mas-v0.25.0",
        true,
        "success",
        "skipped",
        [false, true, false, false, false],
    ],
    [
        "workflow_dispatch",
        "v0.25.0",
        false,
        "failure",
        "skipped",
        [false, true, false, false, false],
    ],
    ["workflow_dispatch", "v0.25.0", false, "success", "failure", [false, true, true, true, false]],
    [
        "workflow_dispatch",
        "v0.25.0",
        false,
        "success",
        "cancelled",
        [false, true, true, true, false],
    ],
];
const jobNames = [
    "dispatch-release",
    "prepare-release",
    "build-tauri",
    "build-mas",
    "publish-release",
];
for (const [event, tag, validateOnly, prepared, built, expected] of cases) {
    const values = {
        github: { event_name: event },
        inputs: { validate_only: validateOnly },
        needs: {
            "prepare-release": { result: prepared, outputs: { tag } },
            "build-tauri": { result: built },
        },
    };
    assert.deepEqual(
        jobNames.map((name) => condition(release.jobs[name], values)),
        expected,
    );
}

for (const name of ["build-tauri", "build-mas"]) {
    const checkout = release.jobs[name].steps.find((step) =>
        step.uses?.startsWith("actions/checkout@"),
    );
    assert.equal(checkout.with.ref, "${{ needs.prepare-release.outputs.sha }}");
}
const publicBuild = release.jobs["build-tauri"];
assert.equal(
    publicBuild.steps.find((step) => step.uses?.startsWith("tauri-apps/tauri-action@")).with
        .tagName,
    "${{ needs.prepare-release.outputs.tag }}",
);
assert.equal(publicBuild.env.RELEASE_TAG, "${{ needs.prepare-release.outputs.tag }}");
const publish = release.jobs["publish-release"];
assert.equal(publish.env.RELEASE_TAG, "${{ needs.prepare-release.outputs.tag }}");
assert.equal(
    publish.steps.find((step) => step.name === "Build latest.json").env.TAG,
    "${{ needs.prepare-release.outputs.tag }}",
);
assert(!JSON.stringify(release.jobs).includes("github.ref_name"));
assert(!JSON.stringify(release.jobs).includes("GITHUB_REF_NAME"));
assert.equal(release.on.workflow_dispatch.inputs.validate_only.default, false);
assert.equal(release.on.workflow_dispatch.inputs.validate_only.type, "boolean");
assert.equal(release.on.workflow_dispatch.inputs.release_tag.required, true);
assert.equal(release.on.workflow_dispatch.inputs.release_sha.required, true);

const restore = keepalive.jobs.restore;
const cache = (job) => job.steps.find((step) => step.uses?.startsWith("swatinem/rust-cache@"));
const toolchain = (job) =>
    job.steps.find((step) => step.uses?.startsWith("dtolnay/rust-toolchain@"));
for (const name of ["build-tauri", "build-mas"]) {
    const buildCache = cache(release.jobs[name]);
    const restoreCache = cache(restore);
    assert.equal(buildCache.uses, restoreCache.uses);
    for (const input of ["workspaces", "prefix-key", "shared-key"]) {
        assert.equal(buildCache.with[input], restoreCache.with[input]);
    }
    assert.equal(buildCache.with["cache-on-failure"], true);
    assert.equal(toolchain(release.jobs[name]).uses, toolchain(restore).uses);
}
assert.deepEqual(toolchain(publicBuild).with, toolchain(restore).with);
assert.deepEqual(
    restore.strategy.matrix.platform,
    publicBuild.strategy.matrix.include.map(({ platform }) => platform),
);
assert.equal(cache(restore).with["save-if"], false);
assert(restore.steps.every((step) => !step.run));
assert(!JSON.stringify(restore).includes("secrets."));
assert.equal(keepalive.on.schedule[0].cron, "23 8 */5 * *");
assert(restore["timeout-minutes"] > 0);
for (const event of ["schedule", "workflow_dispatch"]) {
    for (const branch of ["main", "feature"]) {
        assert.equal(
            condition(restore, {
                github: {
                    event_name: event,
                    ref: `refs/heads/${branch}`,
                    event: { repository: { default_branch: "main" } },
                },
            }),
            branch === "main",
        );
    }
}

console.log(
    "Release dispatch, validation, publication gates, and restore-only cache checks passed.",
);
