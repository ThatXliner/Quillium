import { defineConfig, devices } from "@playwright/test";

const host = "127.0.0.1";
const port = Number(process.env.E2E_LANDING_PORT ?? 4174);
const baseURL = process.env.E2E_LANDING_BASE_URL ?? `http://${host}:${port}`;
const supabaseUrl = process.env.E2E_SUPABASE_URL ?? process.env.PUBLIC_SUPABASE_URL ?? "";
const publishableKey =
    process.env.E2E_SUPABASE_PUBLISHABLE_KEY ??
    process.env.E2E_SUPABASE_ANON_KEY ??
    process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    "";

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
    forbidOnly: Boolean(process.env.CI),
    retries: process.env.CI ? 2 : 0,
    reporter: "list",
    use: {
        baseURL,
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
    },
    projects: [
        {
            name: "chromium",
            use: { ...devices["Desktop Chrome"] },
        },
    ],
    webServer: {
        command:
            process.env.E2E_LANDING_WEB_SERVER_COMMAND ??
            (process.env.CI ? previewCommand : devCommand),
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: {
            ...process.env,
            PUBLIC_SUPABASE_URL: supabaseUrl,
            PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey,
        },
    },
});
