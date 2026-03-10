import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
    testDir: "./tests/e2e",
    testMatch: "**/*.pw.ts",
    timeout: 60_000,
    expect: {
        timeout: 5_000,
        toHaveScreenshot: {
            // Snapshots live in screenshots/ at the repo root (not next to test files)
            // so they're easy to reference from the README.
            snapshotPathTemplate: "screenshots/{arg}{ext}",
        },
    },
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    reporter: "list",
    use: {
        baseURL: "http://127.0.0.1:4173",
        trace: "retain-on-failure",
    },
    projects: [
        {
            name: "chromium",
            use: { ...devices["Desktop Chrome"] },
        },
    ],
    webServer: {
        command: "bun run dev -- --host 127.0.0.1 --port 4173 --strictPort",
        url: "http://127.0.0.1:4173",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
    },
});
