import { defineConfig, devices } from "@playwright/test";
import { resolveWebPreviewEnvironment } from "./tests/webPreviewEnv";

const host = "127.0.0.1";
const port = Number(process.env.E2E_LANDING_PORT ?? 4174);
const baseURL = process.env.E2E_LANDING_BASE_URL ?? `http://${host}:${port}`;
const webPreviewEnvironment = resolveWebPreviewEnvironment(process.env);
const ci = Boolean(process.env.CI);
const canonicalVisualPlatform = process.platform === "linux";
const compareNoncanonicalSnapshots = process.env.E2E_COMPARE_NONCANONICAL_SNAPSHOTS === "1";
const supabaseUrl = webPreviewEnvironment.url || process.env.PUBLIC_SUPABASE_URL || "";
const publishableKey =
    webPreviewEnvironment.publishableKey || process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";

const devCommand = `bun run --cwd ../landing dev -- --host ${host} --port ${port} --strictPort`;
const previewCommand =
    `bun run --cwd ../landing build && bun run --cwd ../landing preview -- --host ${host} ` +
    `--port ${port} --strictPort`;

if (ci && !canonicalVisualPlatform) {
    throw new Error("Web Preview visual CI must run on Linux, the canonical snapshot platform");
}

export default defineConfig({
    testDir: "./tests",
    testMatch: "**/*.pw.ts",
    timeout: 45_000,
    expect: {
        timeout: 8_000,
    },
    fullyParallel: false,
    forbidOnly: ci,
    failOnFlakyTests: ci,
    // Keep semantic browser coverage active on every OS without generating or
    // comparing noncanonical platform images. Developers can opt in when they
    // specifically need a Darwin/Windows diagnostic snapshot.
    ignoreSnapshots: !canonicalVisualPlatform && !compareNoncanonicalSnapshots,
    retries: ci ? 2 : 0,
    reporter: ci
        ? [
              ["list"],
              ["json", { outputFile: "test-results/results.json" }],
              ["html", { open: "never" }],
          ]
        : webPreviewEnvironment.required
          ? [["list"], ["html", { open: "never" }]]
          : "list",
    use: {
        baseURL,
        deviceScaleFactor: 1,
        locale: "en-US",
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
        timezoneId: "UTC",
    },
    projects: [
        {
            name: "chromium",
            use: { ...devices["Desktop Chrome"] },
        },
    ],
    webServer: {
        command: process.env.E2E_LANDING_WEB_SERVER_COMMAND ?? (ci ? previewCommand : devCommand),
        url: baseURL,
        reuseExistingServer: !ci,
        timeout: 120_000,
        env: {
            ...process.env,
            // Seeding stays in the Playwright worker. The landing child only receives public data.
            E2E_SUPABASE_SERVICE_ROLE_KEY: "",
            PUBLIC_SUPABASE_URL: supabaseUrl,
            PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey,
        },
    },
});
