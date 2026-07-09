/**
 * webPreview.pw.ts — Full browser coverage of the Omni Web Preview path:
 * local Supabase row/RPC → SvelteKit /share/[token] load → real renderer.
 */
import { expect, test } from "@playwright/test";
import { type WebPreviewSeed, cleanupWebPreview, seedWebPreview } from "./webPreviewSupport";

const supabaseUrl = process.env.E2E_SUPABASE_URL;
const serviceRoleKey = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY;
const hasLocalSupabase = Boolean(supabaseUrl && serviceRoleKey);
const config = {
    url: supabaseUrl ?? "",
    serviceRoleKey: serviceRoleKey ?? "",
};

test.describe("Omni Web Preview", () => {
    test.skip(
        !hasLocalSupabase,
        "Set E2E_SUPABASE_URL and E2E_SUPABASE_SERVICE_ROLE_KEY for local Supabase",
    );
    test.describe.configure({ mode: "serial" });

    let seed: WebPreviewSeed;

    test.beforeAll(async () => {
        seed = await seedWebPreview(config);
    });

    test.afterAll(async () => {
        if (seed?.userId) await cleanupWebPreview(config, seed.userId);
    });

    test("renders serialized state and cascades linked revisions", async ({ page }) => {
        const response = await page.goto(`/share/${seed.modernToken}`);
        expect(response?.status()).toBe(200);

        await expect(page).toHaveTitle(`${seed.title} · Shared via Quillium`);
        await expect(page.locator('meta[name="description"]')).toHaveAttribute(
            "content",
            seed.excerpt,
        );
        await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
            "content",
            `${seed.title} · Shared via Quillium`,
        );
        await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
            "href",
            `https://quillium.bryanhu.com/share/${seed.modernToken}`,
        );

        const topbar = page.locator(".share-topbar");
        await expect(topbar).toContainText("Read-only");
        await expect(topbar).toContainText(seed.title);
        await expect(topbar).toContainText(seed.authorName);
        await expect(topbar.getByRole("link", { name: "Edit in Quillium" })).toHaveAttribute(
            "href",
            /shared-doc.*#download$/,
        );

        const editor = page.locator(".cm-content");
        await expect(editor).toHaveText(seed.content);
        await expect(editor).toHaveAttribute("contenteditable", "false");

        const cards = page.locator(".annotation-card-stack > article");
        await expect(cards).toHaveCount(4);
        await expect(page.getByRole("heading", { name: "Comment" })).toHaveCount(1);
        await expect(page.getByRole("heading", { name: "Revision" })).toHaveCount(2);
        await expect(page.getByRole("heading", { name: "AI Suggestion" })).toBeVisible();
        await expect(page.getByText("Strong opener.")).toBeVisible();
        await expect(page.getByRole("button", { name: /russet/i })).toBeVisible();

        const swiftButton = page.getByRole("button", { name: "swift", exact: true });
        await expect(swiftButton).toBeEnabled();
        await swiftButton.click();

        await expect(editor).toHaveText("The swift brown hound");
        await expect(page.getByRole("button", { name: "swift", exact: true })).toBeDisabled();
        await expect(page.getByRole("button", { name: "hound", exact: true })).toBeDisabled();

        await editor.click();
        await page.keyboard.type(" must not mutate");
        await expect(editor).toHaveText("The swift brown hound");
    });

    test("renders the pre-published_state legacy fallback", async ({ page }) => {
        const response = await page.goto(`/share/${seed.legacyToken}`);
        expect(response?.status()).toBe(200);

        await expect(page).toHaveTitle(`${seed.title} (legacy) · Shared via Quillium`);
        await expect(page.locator(".cm-editor")).toHaveCount(0);
        await expect(page.locator(".share-document")).toContainText(seed.content);
        await expect(page.locator(".annotation-card-stack > article")).toHaveCount(4);
        await expect(page.getByText("Strong opener.")).toBeVisible();
        await expect(page.getByRole("heading", { name: "Revision" })).toHaveCount(2);
        await expect(page.getByRole("heading", { name: "AI Suggestion" })).toBeVisible();
    });

    test("returns 404 for malformed and disabled share tokens", async ({ page }) => {
        const malformed = await page.goto("/share/not-a-uuid");
        expect(malformed?.status()).toBe(404);
        await expect(page.getByRole("heading", { name: "Something went wrong" })).toBeVisible();

        const disabled = await page.goto(`/share/${seed.disabledToken}`);
        expect(disabled?.status()).toBe(404);
        await expect(page.getByRole("heading", { name: "Something went wrong" })).toBeVisible();
        await expect(page.getByText(seed.title)).toHaveCount(0);
    });
});
