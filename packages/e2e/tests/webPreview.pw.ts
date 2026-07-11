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

        const cards = page.locator("[data-annotation-card-view]");
        await expect(cards).toHaveCount(4);
        await expect(page.locator('[data-annotation-card-view="comment"]')).toHaveCount(1);
        await expect(page.locator('[data-annotation-card-view="revision"]')).toHaveCount(2);
        await expect(page.locator('[data-annotation-card-view="suggestion"]')).toHaveCount(1);
        await expect(page.getByRole("heading", { name: "Comment" })).toHaveCount(1);
        await expect(page.getByRole("heading", { name: "Revision" })).toHaveCount(2);
        await expect(page.getByRole("heading", { name: "AI Suggestion" })).toBeVisible();
        await expect(page.getByText("Strong opener.")).toBeVisible();
        await expect(
            page
                .locator('[data-annotation-card-view="suggestion"] button')
                .filter({ hasText: "russet" }),
        ).toBeVisible();

        const revisionThread = page
            .locator('[data-annotation-card-view="revision"] [data-annotation-thread]')
            .first();
        await expect(revisionThread).toHaveCSS("padding-left", "12px");
        await expect(revisionThread).toHaveCSS("padding-right", "12px");
        await expect(revisionThread).toHaveCSS("padding-top", "10px");
        await expect(revisionThread).toHaveCSS("padding-bottom", "10px");

        const linked = page.getByTitle('Linked — group "Formal voice" (2 versions)');
        await expect(linked).toHaveCount(2);
        await expect(page.locator("[data-version-group-id]")).toHaveCount(2);
        await expect(page.getByRole("button", { name: "Link version" })).toHaveCount(0);
        await expect(page.getByText("New Version", { exact: true })).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Branch instead" })).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Apply", exact: true })).toHaveCount(0);
        await expect(cards.getByRole("textbox")).toHaveCount(0);

        const suggestionCard = page.locator(
            '.annotation-card:has([data-annotation-card-view="suggestion"])',
        );
        await expect(suggestionCard).toHaveCount(1);
        await expect
            .poll(() =>
                suggestionCard.evaluate((element) =>
                    Number.isFinite(Number.parseFloat((element as HTMLElement).style.top)),
                ),
            )
            .toBe(true);
        const initialSuggestionTop = (await suggestionCard.boundingBox())?.y;
        expect(initialSuggestionTop).toBeDefined();
        const transition = await suggestionCard.evaluate((element) => {
            const style = getComputedStyle(element);
            return {
                property: style.transitionProperty,
                duration: style.transitionDuration,
                timing: style.transitionTimingFunction,
            };
        });
        expect(transition.property).toContain("top");
        expect(transition.duration).toBe("0.3s");
        expect(transition.timing).toBe("cubic-bezier(0.25, 0.46, 0.45, 0.94)");

        // Activate a later card through the same non-interactive card surface
        // used by desktop. The shared layout must move it to its document
        // anchor and repack every neighbor without overlap.
        await suggestionCard.getByRole("heading", { name: "AI Suggestion" }).click();
        await expect(
            suggestionCard.locator('[data-annotation-card-view="suggestion"]'),
        ).toHaveAttribute("data-active", "true");

        const expectedSuggestionTop = await editor.evaluate((content, docOffset) => {
            const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
            let remaining = docOffset;
            let node = walker.nextNode();
            while (node) {
                const length = node.textContent?.length ?? 0;
                if (remaining <= length) {
                    const range = document.createRange();
                    range.setStart(node, remaining);
                    range.setEnd(node, remaining);
                    return range.getBoundingClientRect().top - 10;
                }
                remaining -= length;
                node = walker.nextNode();
            }
            throw new Error(`Could not resolve document offset ${docOffset}`);
        }, 10);

        await expect
            .poll(async () => {
                const box = await suggestionCard.boundingBox();
                return box ? Math.abs(box.y - expectedSuggestionTop) : Number.POSITIVE_INFINITY;
            })
            .toBeLessThanOrEqual(2);
        const activeSuggestionTop = (await suggestionCard.boundingBox())?.y;
        expect(activeSuggestionTop).toBeDefined();
        expect(Math.abs((activeSuggestionTop ?? 0) - (initialSuggestionTop ?? 0))).toBeGreaterThan(
            10,
        );

        await expect
            .poll(async () => {
                const boxes = await page.locator(".annotation-card").evaluateAll((elements) =>
                    elements
                        .map((element) => element.getBoundingClientRect())
                        .sort((a, b) => a.top - b.top)
                        .map((box) => ({ top: box.top, bottom: box.bottom })),
                );
                return boxes.every(
                    (box, index) => index === 0 || box.top >= boxes[index - 1].bottom + 7,
                );
            })
            .toBe(true);

        const swiftButton = page.getByRole("button", { name: /^swift, linked in / });
        await expect(swiftButton).toBeEnabled();
        await swiftButton.click();

        await expect(editor).toHaveText("The swift brown hound");
        await expect(page.getByRole("button", { name: /^swift, linked in / })).toBeDisabled();
        await expect(page.getByRole("button", { name: /^hound, linked in / })).toBeDisabled();

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
        await expect(page.locator("[data-annotation-card-view]")).toHaveCount(4);
        await expect(page.getByText("Strong opener.")).toBeVisible();
        await expect(page.getByRole("heading", { name: "Revision" })).toHaveCount(2);
        await expect(page.getByRole("heading", { name: "AI Suggestion" })).toBeVisible();
        // Newly serialized flat payloads retain group presentation metadata even
        // when `published_state` is unavailable. Truly old rows simply omit it.
        await expect(page.locator("[data-version-group-id]")).toHaveCount(2);
    });

    test("falls back only when the measured annotation column is too narrow", async ({ page }) => {
        await page.setViewportSize({ width: 1_200, height: 900 });
        await page.goto(`/share/${seed.modernToken}`);
        await expect(page.locator("[data-annotation-column]")).toHaveCount(0);
        await expect(page.locator("aside.annotation-column")).toBeVisible();

        await page.setViewportSize({ width: 1_240, height: 900 });
        await expect(page.locator("[data-annotation-column]")).toBeVisible();
        await expect(page.locator("aside.annotation-column")).toHaveCount(0);
        await expect
            .poll(() =>
                page
                    .locator("[data-annotation-column]")
                    .evaluate((element) => Number.parseFloat(getComputedStyle(element).width)),
            )
            .toBeGreaterThanOrEqual(150);
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
