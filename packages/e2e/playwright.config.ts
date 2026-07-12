import { defineConfig, devices } from "@playwright/test";
import { resolveWebPreviewEnvironment } from "./tests/webPreviewEnv";

const host = "127.0.0.1";
const port = Number(process.env.E2E_LANDING_PORT ?? 4174);
const baseURL = process.env.E2E_LANDING_BASE_URL ?? `http://${host}:${port}`;
const webPreviewEnvironment = resolveWebPreviewEnvironment(process.env);
const ci = Boolean(process.env.CI);
const supabaseUrl = webPreviewEnvironment.url || process.env.PUBLIC_SUPABASE_URL || "";
const publishableKey =
    webPreviewEnvironment.publishableKey || process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";

const devCommand = `bun run --cwd ../landing dev -- --host ${host} --port ${port} --strictPort`;
const previewCommand =
    `bun run --cwd ../landing build && bun run --cwd ../landing preview -- --host ${host} ` +
    `--port ${port} --strictPort`;

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
