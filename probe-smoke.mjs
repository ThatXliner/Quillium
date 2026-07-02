// probe-smoke.mjs — load / with the smoke-test Tauri mock and capture errors
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";

const smokeSrc = readFileSync("tests/e2e/app.smoke.pw.ts", "utf8");

const browser = await chromium.launch();
const page = await browser.newPage();

page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") {
        console.log(`[console.${msg.type()}]`, msg.text());
    }
});
page.on("pageerror", (err) => {
    console.log("[pageerror]", err.stack || err.message);
});

// Replicate installTauriMock inline (same init script as the smoke suite)
await page.addInitScript(() => {
    localStorage.setItem("quillium_tutorial_seen", "1");
    localStorage.setItem("quillium_beta_accepted", "true");
    localStorage.setItem("quillium_changelog_seen", "999.999");
    localStorage.setItem(
        "quillium-app-settings",
        JSON.stringify({ autoVersionOnRevisionCreate: false }),
    );

    let nextCallbackId = 1;
    const callbacks = new Map();
    const invokeCalls = [];
    window.__TAURI_MOCK__ = { invokeCalls };
    window.__TAURI_INTERNALS__ = {
        metadata: {
            currentWindow: { label: "main" },
            currentWebview: { label: "main", windowLabel: "main" },
        },
        invoke: async (cmd, args) => {
            invokeCalls.push({ cmd, args });
            if (cmd === "cmd_list_documents")
                return [
                    {
                        id: "doc-test-1",
                        title: "Untitled",
                        createdAt: 0,
                        updatedAt: 0,
                        wordCount: 0,
                        previewText: "",
                        tags: "[]",
                    },
                ];
            if (cmd === "cmd_create_document") return "doc-test-1";
            if (cmd === "cmd_create_draft") return "draft-test-1";
            if (cmd === "cmd_list_drafts")
                return [
                    {
                        id: "draft-test-1",
                        documentId: "doc-test-1",
                        label: "Draft",
                        createdAt: 0,
                        isActive: true,
                    },
                ];
            if (cmd === "cmd_load_document_state")
                return { snapshotStateJson: null, snapshotEventId: -1, eventsSince: [] };
            if (cmd === "cmd_append_event") return { eventId: 0, needsSnapshot: false };
            if (cmd === "cmd_create_snapshot") return null;
            if (cmd === "cmd_update_document_meta") return null;
            if (cmd === "get_api_key") return null;
            if (cmd === "plugin:event|listen") return 1;
            if (cmd === "plugin:event|unlisten") return null;
            return null;
        },
        transformCallback: (callback) => {
            const id = nextCallbackId;
            nextCallbackId += 1;
            callbacks.set(id, callback);
            return id;
        },
        unregisterCallback: (id) => {
            callbacks.delete(id);
        },
        convertFileSrc: (p) => p,
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
});

await page.goto("http://127.0.0.1:4173/");
await page.waitForTimeout(6000);

const banner = page.locator("div[role='alert']");
if (await banner.count()) {
    console.log("--- banner visible ---");
    // expand details if present
    const details = page.getByRole("button", { name: "Show details" });
    if (await details.count()) {
        await details.click();
        await page.waitForTimeout(300);
    }
    console.log(await banner.innerText());
}

const cmds = await page.evaluate(() => window.__TAURI_MOCK__.invokeCalls.map((x) => x.cmd));
console.log("--- invoked commands ---");
console.log([...new Set(cmds)].join("\n"));

await browser.close();
