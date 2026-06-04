import { expect, test } from "@playwright/test";
import { QuilliumPage } from "./QuilliumPage";

test.describe("error banner — crash type", () => {
    test("crash banner appears with correct buttons on editor page", async ({ page }) => {
        const qp = new QuilliumPage(page);
        await qp.init();

        // Seed a backup in localStorage and trigger an error
        await page.evaluate(() => {
            localStorage.setItem(
                "quillium_backup_crash",
                JSON.stringify({
                    timestamp: Date.now(),
                    documentTitle: "My Document",
                    documentText: "important text here",
                    reason: "test crash",
                }),
            );
            window.dispatchEvent(
                new ErrorEvent("error", {
                    message: "Test crash",
                    error: new Error("Test crash"),
                }),
            );
        });

        const banner = page.locator("[role='alert']");
        await expect(banner).toBeVisible({ timeout: 5_000 });
        await expect(banner).toContainText("Something went wrong");
        await expect(banner).toContainText("backed up");

        // On the editor page with a backup, crash banner shows all buttons
        await expect(page.getByRole("button", { name: "Restore previous" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Save as .txt" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Save as .json" })).toBeVisible();
        await expect(page.getByText("Version history")).toBeVisible();
        await expect(page.getByRole("button", { name: "Reload app" })).toBeVisible();
    });

    test("crash banner without backup hides restore and download buttons", async ({ page }) => {
        const qp = new QuilliumPage(page);
        await qp.init();

        // Trigger error without seeding a backup
        await page.evaluate(() => {
            window.dispatchEvent(
                new ErrorEvent("error", {
                    message: "No backup crash",
                    error: new Error("No backup crash"),
                }),
            );
        });

        const banner = page.locator("[role='alert']");
        await expect(banner).toBeVisible({ timeout: 5_000 });

        // No backup → no Restore or download buttons
        await expect(page.getByRole("button", { name: "Restore previous" })).not.toBeVisible();
        await expect(page.getByRole("button", { name: "Save as .txt" })).not.toBeVisible();
        await expect(page.getByRole("button", { name: "Save as .json" })).not.toBeVisible();
        // Version history and Reload should still show
        await expect(page.getByText("Version history")).toBeVisible();
        await expect(page.getByRole("button", { name: "Reload app" })).toBeVisible();
    });

    test("show/hide details toggle works", async ({ page }) => {
        const qp = new QuilliumPage(page);
        await qp.init();

        await page.evaluate(() => {
            window.dispatchEvent(
                new ErrorEvent("error", {
                    message: "DetailedError: something broke",
                    error: new Error("DetailedError: something broke"),
                }),
            );
        });

        const banner = page.locator("[role='alert']");
        await expect(banner).toBeVisible({ timeout: 5_000 });

        // Details hidden by default
        const detailsPre = banner.locator("pre");
        await expect(detailsPre).not.toBeVisible();

        // Show details
        await banner.getByText("Show details").click();
        await expect(detailsPre).toBeVisible();
        await expect(detailsPre).toContainText("DetailedError");

        // Hide details
        await banner.getByText("Hide details").click();
        await expect(detailsPre).not.toBeVisible();
    });

    test("dismiss button hides the crash banner", async ({ page }) => {
        const qp = new QuilliumPage(page);
        await qp.init();

        await page.evaluate(() => {
            window.dispatchEvent(
                new ErrorEvent("error", {
                    message: "Dismiss test",
                    error: new Error("Dismiss test"),
                }),
            );
        });

        const banner = page.locator("[role='alert']");
        await expect(banner).toBeVisible({ timeout: 5_000 });

        await page.getByRole("button", { name: "Dismiss error banner" }).click();
        await expect(banner).not.toBeVisible();
    });
});

test.describe("error banner — suspicious deletion type", () => {
    test("suspicious deletion banner shows version history button, not restore", async ({
        page,
    }) => {
        const qp = new QuilliumPage(page);
        await qp.init();

        // Simulate the suspicious deletion banner by programmatically setting the
        // errorBanner store. The detection logic is tested in unit tests — this
        // e2e test verifies the UI shows the correct buttons for backupType="auto".
        await page.evaluate(() => {
            // Access the errorBanner store through the app's module system.
            // Since SvelteKit has already loaded, we can dynamically import the stores module.
            // @ts-expect-error Vite serves /src modules in the browser during this e2e run.
            return import("/src/lib/stores.ts").then((mod) => {
                mod.errorBanner.set({
                    message:
                        "A large deletion was detected. A recovery snapshot has been saved to your version history.",
                    hasBackup: false,
                    backupType: "auto",
                });
            });
        });

        const banner = page.locator("[role='alert']");
        await expect(banner).toBeVisible({ timeout: 5_000 });
        await expect(banner).toContainText("large deletion");

        // Suspicious deletion: shows "View version history" but NOT restore/download
        await expect(page.getByRole("button", { name: "View version history" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Restore previous" })).not.toBeVisible();
        await expect(page.getByRole("button", { name: "Save as .txt" })).not.toBeVisible();
        await expect(page.getByRole("button", { name: "Save as .json" })).not.toBeVisible();
    });
});
