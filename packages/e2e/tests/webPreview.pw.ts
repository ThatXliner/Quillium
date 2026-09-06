/**
 * webPreview.pw.ts — Full browser coverage of the Omni Web Preview path:
 * isolated Supabase row/RPC → SvelteKit /share/[token] load → real renderer.
 */
import { type Page, expect, test } from "@playwright/test";
import { VISUAL_FIXTURE_IDS, VISUAL_FIXTURE_TIME } from "./fixtures";
import { resolveWebPreviewEnvironment } from "./webPreviewEnv";
import { type WebPreviewSeed, cleanupWebPreview, seedWebPreview } from "./webPreviewSupport";

const webPreviewEnvironment = resolveWebPreviewEnvironment(process.env);
const config = {
    url: webPreviewEnvironment.url,
    serviceRoleKey: webPreviewEnvironment.serviceRoleKey,
};

const VISUAL_VIEWPORTS = [
    { name: "wide", width: 1_440, height: 1_000 },
    { name: "tablet", width: 1_024, height: 900 },
    { name: "mobile", width: 390, height: 844 },
] as const;
const VISUAL_THEMES = ["light", "dark"] as const;
const VISUAL_RENDERERS = ["modern", "legacy"] as const;
const VISUAL_SCREENSHOT_OPTIONS = {
    animations: "disabled" as const,
    caret: "hide" as const,
    maxDiffPixelRatio: 0.005,
    scale: "css" as const,
    threshold: 0.2,
};
const VISUAL_STABILITY_CSS = `
    html {
        --doc-font-family: "Inter", sans-serif;
        scroll-behavior: auto !important;
    }
    *, *::before, *::after {
        animation: none !important;
        caret-color: transparent !important;
        transition: none !important;
    }
`;

async function settleVisualPage(
    page: Page,
    expectedAnnotationCards: number | null = 6,
): Promise<void> {
    await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
    });
    if (expectedAnnotationCards !== null) {
        await expect(page.locator("[data-annotation-card-view]")).toHaveCount(
            expectedAnnotationCards,
        );
    }
    await expect
        .poll(() =>
            page.evaluate(
                () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
            ),
        )
        .toBeLessThanOrEqual(1);
}

async function openVisualShare(
    page: Page,
    options: {
        token: string;
        renderer: (typeof VISUAL_RENDERERS)[number];
        theme: (typeof VISUAL_THEMES)[number];
        title: string;
    },
): Promise<void> {
    await page.emulateMedia({ colorScheme: options.theme, reducedMotion: "reduce" });
    await page.clock.setFixedTime(VISUAL_FIXTURE_TIME);
    await page.addInitScript(() => localStorage.setItem("cookie_consent", "declined"));
    const response = await page.goto(`/share/${options.token}`);
    expect(response?.status()).toBe(200);
    await page.addStyleTag({ content: VISUAL_STABILITY_CSS });
    await expect(page.locator(".share-topbar")).toContainText(options.title);
    expect(await page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches)).toBe(
        options.theme === "dark",
    );

    if (options.renderer === "modern") {
        await expect(page.locator(".cm-content")).toBeVisible();
        await expect(page.locator('[data-readonly-renderer="legacy-static"]')).toHaveCount(0);
    } else {
        await expect(page.locator(".cm-editor")).toHaveCount(0);
        await expect(page.locator('[data-readonly-renderer="legacy-static"]')).toBeVisible();
    }
    await settleVisualPage(page, options.renderer === "modern" ? 6 : 9);
    const revision = page
        .locator(options.renderer === "modern" ? ".cm-revision" : ".annotation-inline-revision")
        .first();
    await page.mouse.move(0, 0);
    await expect(revision).toHaveCSS("text-decoration-thickness", "1px");
    await revision.hover();
    await expect(revision).toHaveCSS("text-decoration-thickness", "2px");
    await page.mouse.move(0, 0);
    await expect(revision).toHaveCSS("text-decoration-thickness", "1px");
    if (options.renderer === "legacy") {
        await page.keyboard.press("Tab");
        await revision.focus();
        await expect(revision).toHaveCSS("text-decoration-thickness", "2px");
        await revision.evaluate((element) => (element as HTMLElement).blur());
    }
}

async function focusVisualAnchor(
    page: Page,
    viewportName: (typeof VISUAL_VIEWPORTS)[number]["name"],
): Promise<void> {
    const annotationId =
        viewportName === "wide"
            ? VISUAL_FIXTURE_IDS.startComment
            : viewportName === "tablet"
              ? VISUAL_FIXTURE_IDS.rootRevision
              : VISUAL_FIXTURE_IDS.endComment;
    const card = page.locator(`[data-annotation-id="${annotationId}"]`).first();
    await expect(card).toBeVisible();
    await card.getByRole("heading").click();
    await card.evaluate((element) =>
        element.scrollIntoView({ behavior: "auto", block: "center", inline: "nearest" }),
    );
}

function requireSeed(seed: WebPreviewSeed | undefined): WebPreviewSeed {
    if (!seed) throw new Error("Web Preview fixture was not seeded");
    return seed;
}

test.describe("Omni Web Preview", () => {
    test.skip(
        !webPreviewEnvironment.enabled,
        "Set the E2E Supabase URL, service-role key, and publishable key",
    );
    test.describe.configure({ mode: "serial" });

    let seed: WebPreviewSeed | undefined;

    test.beforeAll(async () => {
        seed = await seedWebPreview(config);
    });

    test.afterAll(async () => {
        if (seed) await cleanupWebPreview(config, seed.userId);
    });

    test.afterEach(async ({ page }, testInfo) => {
        if (testInfo.status === testInfo.expectedStatus || page.isClosed()) return;
        await testInfo.attach("web-preview-dom", {
            body: await page.content(),
            contentType: "text/html",
        });
    });

    test("renders serialized state and cascades linked revisions", async ({ page }) => {
        const currentSeed = requireSeed(seed);
        const pageErrors: string[] = [];
        const consoleErrors: string[] = [];
        page.on("pageerror", (error) => pageErrors.push(error.message));
        page.on("console", (message) => {
            if (message.type() === "error") consoleErrors.push(message.text());
        });

        const response = await page.goto(`/share/${currentSeed.modernToken}`);
        expect(response?.status()).toBe(200);

        await expect(page).toHaveTitle(`${currentSeed.title} · Shared via Quillium`);
        await expect(page.locator('meta[name="description"]')).toHaveAttribute(
            "content",
            currentSeed.excerpt,
        );
        await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
            "content",
            `${currentSeed.title} · Shared via Quillium`,
        );
        await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
            "href",
            `https://quillium.bryanhu.com/share/${currentSeed.modernToken}`,
        );

        const topbar = page.locator(".share-topbar");
        await expect(topbar).toContainText("Read-only");
        await expect(topbar).toContainText(currentSeed.title);
        await expect(topbar).toContainText(currentSeed.authorName);
        await expect(topbar.getByRole("link", { name: "Edit in Quillium" })).toHaveAttribute(
            "href",
            /shared-doc.*#download$/,
        );

        const editor = page.locator(".cm-content");
        await expect(editor).toHaveText(currentSeed.content);
        await expect(editor).toHaveAttribute("contenteditable", "false");
        await expect(page.locator('[data-readonly-renderer="legacy-static"]')).toHaveCount(0);

        const cards = page.locator("[data-annotation-card-view]");
        await expect(cards).toHaveCount(4);
        await expect(page.locator('[data-annotation-card-view="comment"]')).toHaveCount(1);
        await expect(page.locator('[data-annotation-card-view="revision"]')).toHaveCount(2);
        await expect(page.locator('[data-annotation-card-view="suggestion"]')).toHaveCount(1);
        await expect(page.getByRole("heading", { name: "Comment" })).toHaveCount(1);
        await expect(page.getByRole("heading", { name: "Revision" })).toHaveCount(2);
        await expect(page.getByRole("heading", { name: "AI Suggestion" })).toBeVisible();
        await expect(page.getByText("Strong opener.")).toBeVisible();
        const suggestionView = page.locator('[data-annotation-card-view="suggestion"]');
        const russetReplacement = suggestionView.getByRole("button", { name: /russet/ });
        await expect(russetReplacement).toBeVisible();
        await russetReplacement.click();
        await suggestionView.getByRole("button", { name: "View changes" }).click();
        await expect(suggestionView.locator('[data-suggestion-diff="delete"]')).toHaveText("brown");
        await expect(suggestionView.locator('[data-suggestion-diff="insert"]')).toHaveText(
            "russet",
        );

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

        const firstRevision = page.locator(
            '[data-annotation-card-view="revision"][data-annotation-id="1"]',
        );
        await firstRevision.getByRole("button", { name: "Expand revision editor" }).click();
        const readonlyModal = page.locator(".readonly-modal");
        await expect(readonlyModal).toBeVisible();
        const modalEditor = readonlyModal.locator(
            '[data-revision-modal-editor="codemirror"] .cm-content',
        );
        await expect(modalEditor).toHaveText("quick");
        await expect(modalEditor).toHaveAttribute("contenteditable", "false");
        await expect(
            readonlyModal.locator('[data-revision-modal-editor="legacy-static"]'),
        ).toHaveCount(0);
        const contextViewport = readonlyModal.locator("[data-revision-context-scroll]");
        await expect(contextViewport).toBeVisible();
        await expect
            .poll(() => contextViewport.evaluate((element) => getComputedStyle(element).maskImage))
            .toContain("linear-gradient");
        await expect(
            readonlyModal.getByRole("button", { name: "Delete entire revision" }),
        ).toHaveCount(0);
        await expect(readonlyModal.getByRole("button", { name: "New Version" })).toHaveCount(0);
        await readonlyModal.getByRole("button", { name: "Close revision" }).click();
        await expect(readonlyModal).toHaveCount(0);

        const commentView = page.locator('[data-annotation-card-view="comment"]');
        await commentView.getByRole("button", { name: "Expand comment thread" }).click();
        const commentContext = readonlyModal.locator("[data-comment-context-scroll]");
        await expect(commentContext).toContainText("The");
        await expect(commentContext).toContainText("quick brown fox");
        await readonlyModal.getByRole("button", { name: "Close comment" }).click();

        await suggestionView.getByRole("button", { name: "Expand suggestion diff" }).click();
        await expect(readonlyModal.locator("[data-suggestion-modal-content]")).toBeVisible();
        await readonlyModal.getByRole("button", { name: /umber/ }).click();
        await expect(readonlyModal.locator('[data-suggestion-diff="delete"]')).toHaveText("brown");
        await expect(readonlyModal.locator('[data-suggestion-diff="insert"]')).toHaveText("umber");
        await readonlyModal.getByRole("button", { name: "Close suggestion" }).click();

        const suggestionCard = page.locator(
            '.annotation-card:has([data-annotation-card-view="suggestion"])',
        );
        await expect(suggestionCard).toHaveCount(1);
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

        // Opening the suggestion modal activates that card. Establish a different active card
        // before measuring so the following activation exercises a real layout transition.
        await commentView.getByRole("heading", { name: "Comment" }).click();
        await expect(commentView).toHaveAttribute("data-active", "true");
        await expect
            .poll(() =>
                suggestionCard.evaluate((element) =>
                    Number.isFinite(Number.parseFloat((element as HTMLElement).style.top)),
                ),
            )
            .toBe(true);
        await expect
            .poll(async () => {
                const box = await suggestionCard.boundingBox();
                return box ? Math.abs(box.y - expectedSuggestionTop) : 0;
            })
            .toBeGreaterThan(2);
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

        await expect
            .poll(async () => {
                const box = await suggestionCard.boundingBox();
                return box ? Math.abs(box.y - expectedSuggestionTop) : Number.POSITIVE_INFINITY;
            })
            .toBeLessThanOrEqual(2);
        const activeSuggestionTop = (await suggestionCard.boundingBox())?.y;
        expect(activeSuggestionTop).toBeDefined();
        expect(Math.abs((activeSuggestionTop ?? 0) - (initialSuggestionTop ?? 0))).toBeGreaterThan(
            1,
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
        expect(pageErrors).toEqual([]);
        expect(consoleErrors).toEqual([]);
    });

    test("renders the pre-published_state legacy fallback", async ({ page }) => {
        const currentSeed = requireSeed(seed);
        const response = await page.goto(`/share/${currentSeed.legacyToken}`);
        expect(response?.status()).toBe(200);

        await expect(page).toHaveTitle(`${currentSeed.title} (legacy) · Shared via Quillium`);
        await expect(page.locator(".cm-editor")).toHaveCount(0);
        await expect(page.locator('[data-readonly-renderer="legacy-static"]')).toHaveCount(1);
        await expect(page.locator(".share-document")).toContainText(currentSeed.content);
        await expect(page.locator("[data-annotation-card-view]")).toHaveCount(4);
        await expect(page.getByText("Strong opener.")).toBeVisible();
        await expect(page.getByRole("heading", { name: "Revision" })).toHaveCount(2);
        await expect(page.getByRole("heading", { name: "AI Suggestion" })).toBeVisible();
        // Pre-published_state rows also predate stable version ids and linked-group metadata.
        await expect(page.locator("[data-version-group-id]")).toHaveCount(0);
    });

    test("falls back only when the measured annotation column is too narrow", async ({ page }) => {
        const currentSeed = requireSeed(seed);
        await page.setViewportSize({ width: 1_200, height: 900 });
        await page.goto(`/share/${currentSeed.modernToken}`);
        await expect(page.locator("[data-annotation-column]")).toHaveCount(0);
        await expect(page.locator("aside.annotation-column")).toBeVisible();

        await page.setViewportSize({ width: 390, height: 844 });
        await expect(page.locator("[data-annotation-column]")).toHaveCount(0);
        await expect(page.locator("aside.annotation-column")).toBeVisible();
        const mobileGeometry = await page.evaluate(() => ({
            viewportWidth: document.documentElement.clientWidth,
            scrollWidth: document.documentElement.scrollWidth,
            cardsFit: Array.from(document.querySelectorAll("[data-annotation-card-view]")).every(
                (element) => {
                    const bounds = element.getBoundingClientRect();
                    return bounds.left >= 0 && bounds.right <= window.innerWidth;
                },
            ),
        }));
        expect(mobileGeometry.scrollWidth).toBeLessThanOrEqual(mobileGeometry.viewportWidth);
        expect(mobileGeometry.cardsFit).toBe(true);

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
        const currentSeed = requireSeed(seed);
        const malformed = await page.goto("/share/not-a-uuid");
        expect(malformed?.status()).toBe(404);
        await expect(page.getByRole("heading", { name: "Something went wrong" })).toBeVisible();

        const disabled = await page.goto(`/share/${currentSeed.disabledToken}`);
        expect(disabled?.status()).toBe(404);
        await expect(page.getByRole("heading", { name: "Something went wrong" })).toBeVisible();
        await expect(page.getByText(currentSeed.title)).toHaveCount(0);
    });

    for (const renderer of VISUAL_RENDERERS) {
        for (const theme of VISUAL_THEMES) {
            test(`matches the ${renderer} ${theme} responsive visual matrix`, async ({ page }) => {
                const currentSeed = requireSeed(seed);
                const token =
                    renderer === "modern"
                        ? currentSeed.visualModernToken
                        : currentSeed.visualLegacyToken;
                const expectedAnnotationCards = renderer === "modern" ? 6 : 9;

                for (const viewport of VISUAL_VIEWPORTS) {
                    await page.setViewportSize(viewport);
                    if (!page.url().startsWith("http")) {
                        await openVisualShare(page, {
                            token,
                            renderer,
                            theme,
                            title: currentSeed.visualTitle,
                        });
                    } else {
                        await settleVisualPage(page, expectedAnnotationCards);
                    }
                    await focusVisualAnchor(page, viewport.name);
                    await settleVisualPage(page, expectedAnnotationCards);
                    await expect(page).toHaveScreenshot(
                        `web-preview-${renderer}-${theme}-${viewport.name}.png`,
                        VISUAL_SCREENSHOT_OPTIONS,
                    );
                }
            });
        }
    }

    test("matches the modern nested revision modal", async ({ page }) => {
        const currentSeed = requireSeed(seed);
        await page.setViewportSize(VISUAL_VIEWPORTS[0]);
        await openVisualShare(page, {
            token: currentSeed.visualModernToken,
            renderer: "modern",
            theme: "light",
            title: currentSeed.visualTitle,
        });

        const rootId = String(VISUAL_FIXTURE_IDS.rootRevision);
        const nestedId = `${rootId}.v0.${VISUAL_FIXTURE_IDS.nestedRevision}`;
        const deepId = `${nestedId}.v0.${VISUAL_FIXTURE_IDS.deepRevision}`;
        await page
            .locator(`[data-annotation-id="${rootId}"]`)
            .getByRole("button", { name: "Expand revision editor" })
            .click();
        const modal = page.locator(".readonly-modal");
        await expect(modal.locator('[data-revision-modal-editor="codemirror"]')).toBeVisible();
        await modal
            .locator(`[data-annotation-id="${nestedId}"]`)
            .getByRole("button", { name: "Expand revision editor" })
            .click();
        await modal
            .locator(`[data-annotation-id="${deepId}"]`)
            .getByRole("button", { name: "Expand revision editor" })
            .click();
        await expect(modal.locator("[data-breadcrumb-id]")).toHaveCount(3);
        await page.evaluate(() => window.scrollTo(0, 0));
        await settleVisualPage(page, null);
        await expect(page).toHaveScreenshot(
            "web-preview-modern-light-revision-modal-depth-3.png",
            VISUAL_SCREENSHOT_OPTIONS,
        );
    });

    test("matches the modern long comment modal", async ({ page }) => {
        const currentSeed = requireSeed(seed);
        await page.setViewportSize(VISUAL_VIEWPORTS[0]);
        await openVisualShare(page, {
            token: currentSeed.visualModernToken,
            renderer: "modern",
            theme: "light",
            title: currentSeed.visualTitle,
        });
        await page
            .locator(`[data-annotation-id="${VISUAL_FIXTURE_IDS.startComment}"]`)
            .getByRole("button", { name: "Expand comment thread" })
            .click();
        const modal = page.locator(".readonly-modal");
        await expect(modal.locator('[data-annotation-modal-frame="comment"]')).toBeVisible();
        await expect(modal.locator("[data-comment-context-scroll]")).toContainText(
            "The harbor woke before the bells",
        );
        await page.evaluate(() => window.scrollTo(0, 0));
        await settleVisualPage(page, null);
        await expect(page).toHaveScreenshot(
            "web-preview-modern-light-comment-modal.png",
            VISUAL_SCREENSHOT_OPTIONS,
        );
    });

    test("matches the modern multi-option suggestion modal", async ({ page }) => {
        const currentSeed = requireSeed(seed);
        await page.setViewportSize(VISUAL_VIEWPORTS[0]);
        await openVisualShare(page, {
            token: currentSeed.visualModernToken,
            renderer: "modern",
            theme: "light",
            title: currentSeed.visualTitle,
        });
        await page
            .locator(`[data-annotation-id="${VISUAL_FIXTURE_IDS.suggestion}"]`)
            .getByRole("button", { name: "Expand suggestion diff" })
            .click();
        const modal = page.locator(".readonly-modal");
        await expect(modal.locator("[data-suggestion-modal-content]")).toBeVisible();
        await modal.getByRole("button", { name: /printed tide tables insisted/ }).click();
        await expect(modal.locator('[data-suggestion-diff="delete"]')).toHaveText("promised");
        await expect(modal.locator('[data-suggestion-diff="insert"]')).toHaveText([
            "printed",
            "insisted on",
        ]);
        await page.evaluate(() => window.scrollTo(0, 0));
        await settleVisualPage(page, null);
        await expect(page).toHaveScreenshot(
            "web-preview-modern-light-suggestion-modal.png",
            VISUAL_SCREENSHOT_OPTIONS,
        );
    });
});
