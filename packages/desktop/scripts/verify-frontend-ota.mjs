import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Disposable keys, app identifier, SQLite files, and WebKit storage isolate this run.
assert.equal(process.platform, "darwin", "This packaged harness currently requires macOS");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const desktop = join(root, "packages/desktop");
const evidence = await realpath(await mkdtemp(join(tmpdir(), "quillium-ota-packaged-")));
const target = process.env.CARGO_TARGET_DIR ?? "/tmp/quillium-ota-454-results/target";
const nativeTarget =
    process.env.QUILLIUM_OTA_VERIFICATION_TARGET ?? join(desktop, "src-tauri/target");
const crate = join(root, "crates/tauri-plugin-hot-update/Cargo.toml");
const identifier = `com.bryanhu.quillium.ota-fixture-${Date.now()}`;
const revision = "0123456789abcdef0123456789abcdef01234567";
const checks = [];
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
async function run(command, args, env = {}) {
    const child = spawn(command, args, {
        cwd: root,
        env: { ...process.env, ...env },
        stdio: "inherit",
    });
    assert.equal(await new Promise((done) => child.once("exit", done)), 0, `${command} succeeded`);
}
function check(name, actual, expected) {
    assert.deepEqual(actual, expected, name);
    checks.push(name);
    console.log(`PASS ${name}`);
}
async function until(read, accepts, label, timeout = 30000) {
    const deadline = Date.now() + timeout;
    let value;
    while (Date.now() < deadline) {
        try {
            value = await read();
            if (accepts(value)) return value;
        } catch {}
        await delay(150);
    }
    throw new Error(`Timed out waiting for ${label}. Last value ${JSON.stringify(value)}`);
}
await run(
    "cargo",
    [
        "build",
        "--locked",
        "--manifest-path",
        crate,
        "--features",
        "cli",
        "--bin",
        "hot-update-sign",
        "--example",
        "fixture-key",
    ],
    { CARGO_TARGET_DIR: target },
);
await run(join(target, "debug/examples/fixture-key"), [evidence]);
const publicKey = await readFile(join(evidence, "fixture.pub"), "utf8");
let feedDir;
const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
        const path = new URL(request.url).pathname;
        if (!feedDir || !/^\/(manifest\.json(?:\.minisig)?|bundle-[0-9.]+\.tar\.gz)$/.test(path))
            return new Response("missing", { status: 404 });
        const file = Bun.file(join(feedDir, path.slice(1)));
        return (await file.exists())
            ? new Response(file)
            : new Response("missing", { status: 404 });
    },
});
const baseUrl = `http://127.0.0.1:${server.port}`;
await run("bun", ["run", "desktop:build"], {
    QUILLIUM_ALLOW_MISSING_SUPABASE_ENV: "1",
    PUBLIC_POSTHOG_KEY: "",
    PUBLIC_POSTHOG_HOST: "",
    PUBLIC_SUPABASE_URL: "",
    PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
    PUBLIC_RELAY_URL: "",
});
const config = {
    identifier,
    build: { devUrl: null, beforeBuildCommand: "" },
    app: {
        windows: [{ label: "main", title: "Quillium OTA verification", width: 1100, height: 800 }],
    },
    bundle: { createUpdaterArtifacts: false, macOS: { signingIdentity: null } },
};
const configPath = join(evidence, "tauri.fixture.json");
await writeFile(configPath, JSON.stringify(config));
await run(
    "bun",
    [
        "run",
        "--cwd",
        "packages/desktop",
        "tauri",
        "build",
        "--debug",
        "--bundles",
        "app",
        "--no-sign",
        "--features",
        "mcp-bridge",
        "--config",
        configPath,
    ],
    {
        CARGO_TARGET_DIR: nativeTarget,
        QUILLIUM_OTA_PUBLIC_KEY: publicKey,
        QUILLIUM_OTA_MANIFEST_URL: `${baseUrl}/manifest.json`,
        QUILLIUM_OTA_NATIVE_REVISION: revision,
    },
);
const binary = await realpath(
    join(nativeTarget, "debug/bundle/macos/Quillium.app/Contents/MacOS/quillium"),
);
const originalHash = createHash("sha256")
    .update(await readFile(binary))
    .digest("hex");
let app;
let socket;
let log = "";
let sequence = 0;
const pending = new Map();
async function connect() {
    const port = await until(
        () => log.match(/WebSocket server listening on: [^:]+:(\d+)/)?.[1],
        Boolean,
        "automation endpoint",
    );
    socket = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise((done, fail) => {
        socket.addEventListener("open", done, { once: true });
        socket.addEventListener("error", fail, { once: true });
    });
    socket.addEventListener("message", ({ data }) => {
        const response = JSON.parse(data);
        pending.get(response.id)?.(response);
        pending.delete(response.id);
    });
}
async function request(command, args) {
    const id = String(++sequence);
    const result = await new Promise((done, fail) => {
        const timer = setTimeout(() => {
            pending.delete(id);
            fail(new Error("Bridge request timed out"));
        }, 20000);
        pending.set(id, (response) => {
            clearTimeout(timer);
            done(response);
        });
        socket.send(JSON.stringify({ id, command, args }));
    });
    assert.equal(result.success, true, result.error ?? "native script succeeded");
    return result.data;
}
const js = (script, windowLabel = "main") => request("execute_js", { windowLabel, script });
async function screenshot(name) {
    const data = await request("capture_native_screenshot", {
        windowLabel: "main",
        format: "png",
        maxWidth: 1400,
    });
    await writeFile(join(evidence, `${name}.png`), Buffer.from(data.split(",")[1], "base64"));
}
const invoke = (command, args = {}, windowLabel = "main") =>
    js(
        `return await window.__TAURI__.core.invoke(${JSON.stringify(command)}, ${JSON.stringify(args)});`,
        windowLabel,
    );
async function launch(healthy = true) {
    log = "";
    app = spawn(binary, [], {
        cwd: desktop,
        detached: true,
        env: { ...process.env, QUILLIUM_DATA_DIR: join(evidence, "data") },
        stdio: ["ignore", "pipe", "pipe"],
    });
    app.stdout.on("data", (data) => {
        log += data;
    });
    app.stderr.on("data", (data) => {
        log += data;
    });
    await connect();
    if (healthy)
        await until(
            () => js("return !!document.querySelector('.cm-editor');"),
            Boolean,
            "loaded native editor",
        );
    else
        await until(
            () => js("return typeof window.__OTA_FIXTURE === 'string';"),
            Boolean,
            "failed trial window",
        );
}
async function stop() {
    socket?.close();
    if (app) {
        try {
            process.kill(-app.pid, "SIGTERM");
        } catch {}
        await delay(400);
        try {
            process.kill(-app.pid, "SIGKILL");
        } catch {}
        app = undefined;
    }
}
async function publish(version, healthy) {
    const dist = join(evidence, `dist-${version}`);
    await cp(join(desktop, "build"), dist, { recursive: true });
    const index = join(dist, "index.html");
    const html = healthy
        ? (await readFile(index, "utf8")).replace(
              "<head>",
              `<head><script>window.__OTA_FIXTURE=${JSON.stringify(version)}</script>`,
          )
        : `<html><head><script>window.__OTA_FIXTURE=${JSON.stringify(version)};throw new Error('intentional failed frontend');</script></head><body>Intentional failed OTA fixture</body></html>`;
    await writeFile(index, html);
    feedDir = join(evidence, `release-${version}`);
    await mkdir(feedDir);
    await run(
        join(target, "debug/hot-update-sign"),
        [
            "--dist",
            dist,
            "--version",
            version,
            "--min-shell",
            "0.25.3",
            "--base-version",
            "0.25.3",
            "--application-id",
            identifier,
            "--channel",
            "stable",
            "--state-format",
            "quillium-persisted-v1",
            "--native-revision",
            revision,
            "--key",
            join(evidence, "fixture.key"),
            "--public-key",
            join(evidence, "fixture.pub"),
            "--base-url",
            baseUrl,
            "--out",
            feedDir,
        ],
        { HOT_UPDATE_KEY_PASSWORD: "" },
    );
}
try {
    await publish("0.25.4", true);
    await launch();
    await until(
        () =>
            js(
                "return [...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'Skip tour');",
            ),
        Boolean,
        "initial onboarding",
    );
    // These flags suppress first-launch prompts only in this disposable profile.
    await js(
        "localStorage.setItem('quillium_beta_accepted', 'true'); localStorage.setItem('quillium_changelog_seen', '0.25'); [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Skip tour').click(); return true;",
    );
    const fixtureDocument = await invoke("cmd_create_document", { title: "OTA fixture draft" });
    await js(`location.href = '/?doc=' + ${JSON.stringify(fixtureDocument)}; return true;`);
    await until(
        () =>
            js(
                "return { id: new URL(location.href).searchParams.get('doc'), content: document.querySelector('.cm-content')?.textContent };",
            ),
        (value) => value.id === fixtureDocument && value.content === "",
        "empty fixture draft",
    );
    check("embedded source", (await invoke("cmd_ota_status")).source, "embedded");
    check("native trust configured", (await invoke("cmd_ota_status")).enabled, true);
    const origin = await js(
        "localStorage.setItem('ota-fixture', 'retained'); return location.origin;",
    );
    const text = "A draft survives frontend OTA and rollback.";
    await js(
        `const content = document.querySelector('.cm-content'); content.focus(); document.execCommand('insertText', false, ${JSON.stringify(text)}); return content.textContent;`,
    );
    await until(
        () => js("return document.querySelector('.cm-content').textContent;"),
        (value) => value.includes(text),
        "fixture draft text",
    );
    const documentId = fixtureDocument;
    const secondId = await invoke("cmd_create_document", { title: "OTA second window" });
    await invoke("cmd_open_in_new_window", { docId: secondId });
    const windows = await js(
        "return (await window.__TAURI__.webviewWindow.getAllWebviewWindows()).map(w => w.label);",
    );
    check("secondary window opened after readiness", windows.length, 2);
    await until(
        () =>
            js(
                "return [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Update' && b.parentElement.textContent.includes('0.25.4'));",
            ),
        Boolean,
        "frontend update banner",
    );
    await screenshot("available");
    await js(
        "[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Update' && b.parentElement.textContent.includes('0.25.4')).click(); return true;",
    );
    await until(
        () => invoke("cmd_ota_status"),
        (value) => value.stagedVersion === "0.25.4",
        "downloaded frontend",
    );
    check("verified download stages", (await invoke("cmd_ota_status")).stagedVersion, "0.25.4");
    await screenshot("staged");
    check(
        "download leaves running source unchanged",
        (await invoke("cmd_ota_status")).source,
        "embedded",
    );
    const secondLabel = windows.find((label) => label !== "main");
    await until(
        () => js("return !!document.querySelector('.cm-content');", secondLabel),
        Boolean,
        "secondary editor",
    );
    const pendingText = " Pending at relaunch.";
    const secondaryText = "Second window pending at relaunch.";
    await js(
        `const content = document.querySelector('.cm-content'); content.focus(); document.execCommand('selectAll'); document.execCommand('insertText', false, ${JSON.stringify(secondaryText)}); return true;`,
        secondLabel,
    );
    await js(
        `const content = document.querySelector('.cm-content'); content.focus(); const selection = getSelection(); selection.selectAllChildren(content); selection.collapseToEnd(); document.execCommand('insertText', false, ${JSON.stringify(pendingText)}); return true;`,
    );
    log = "";
    void invoke("cmd_update_restart").catch(() => {});
    await until(
        () => log.match(/WebSocket server listening on: [^:]+:(\d+)/)?.[1],
        Boolean,
        "coordinated full restart",
        30000,
    );
    socket.close();
    await connect();
    await until(() => js("return !!document.querySelector('.cm-editor');"), Boolean, "OTA editor");
    check("new frontend is active", await js("return window.__OTA_FIXTURE;"), "0.25.4");
    check("native reports OTA source", (await invoke("cmd_ota_status")).source, "ota");
    check("origin retained", await js("return location.origin;"), origin);
    check(
        "WebKit storage retained",
        await js("return localStorage.getItem('ota-fixture');"),
        "retained",
    );
    check(
        "draft text retained",
        (await js("return document.querySelector('.cm-content').textContent;")).includes(text),
        true,
    );
    check(
        "draft identity retained",
        await invoke("cmd_is_doc_open_elsewhere", {
            docId: documentId,
            windowLabel: "fixture-observer",
        }),
        true,
    );
    check(
        "pending main-window edit saved by restart barrier",
        (await js("return document.querySelector('.cm-content').textContent;")).includes(
            pendingText,
        ),
        true,
    );
    await invoke("cmd_open_in_new_window", { docId: secondId });
    const reopened = await js(
        "return (await window.__TAURI__.webviewWindow.getAllWebviewWindows()).map(w => w.label).find(label => label !== 'main');",
    );
    await until(
        () => js("return document.querySelector('.cm-content')?.textContent;", reopened),
        (value) => value?.includes(secondaryText),
        "saved secondary draft",
    );
    check(
        "pending secondary-window edit saved by restart barrier",
        (await js("return document.querySelector('.cm-content').textContent;", reopened)).includes(
            secondaryText,
        ),
        true,
    );
    await screenshot("active");
    await publish("0.25.5", false);
    check("broken signed candidate stages", (await invoke("cmd_ota_download")).status, "staged");
    server.stop(true);
    await stop();
    await launch(false);
    check("first failed trial active offline", await js("return window.__OTA_FIXTURE;"), "0.25.5");
    await stop();
    await launch(false);
    check("second failed trial active offline", await js("return window.__OTA_FIXTURE;"), "0.25.5");
    await stop();
    await launch();
    check(
        "offline recovery restores confirmed frontend",
        await js("return window.__OTA_FIXTURE;"),
        "0.25.4",
    );
    check(
        "draft survives failed trials",
        (await js("return document.querySelector('.cm-content').textContent;")).includes(text),
        true,
    );
    check(
        "native binary unchanged",
        createHash("sha256")
            .update(await readFile(binary))
            .digest("hex"),
        originalHash,
    );
    await writeFile(
        join(evidence, "results.json"),
        JSON.stringify({ checks, binary, nativeSha256: originalHash }, null, 2),
    );
    console.log(`Evidence ${evidence}`);
} finally {
    await stop();
    server.stop(true);
    await writeFile(join(evidence, "last-app.log"), log);
}
