/**
 * annotationVisualParity.pw.ts — Deterministic screenshots for the shared
 * annotation renderer in the writable desktop editor and version history.
 *
 * The serialized state comes from packages/e2e so hosted Web Preview can seed
 * the identical annotation tree. Screenshots keep semantic assertions beside
 * the pixels, and failures attach the rendered DOM in addition to Playwright's
 * actual/expected/diff images and retained trace.
 */

import { type Locator, type Page, expect, test } from "@playwright/test";
import {
    VISUAL_FIXTURE_TIME,
    buildFixtureState,
    buildVisualFixtureState,
    serializeFixtureWire,
} from "../../../e2e/tests/fixtures";
import { QuilliumPage, type TauriMockOptions } from "./QuilliumPage";

type ColorScheme = "light" | "dark";
type Anchor = "start" | "middle" | "end";

const VIEWPORTS: ReadonlyArray<{
    name: string;
    width: number;
    height: number;
    anchor: Anchor;
}> = [
    { name: "wide", width: 1440, height: 900, anchor: "start" },
    { name: "tablet", width: 1024, height: 768, anchor: "middle" },
    { name: "mobile", width: 430, height: 820, anchor: "end" },
];
// Desktop and Version History currently expose only a light theme. Omni Web Preview owns the
// light/dark matrix; keeping duplicate dark snapshots here would create false coverage.
const COLOR_SCHEMES: readonly ColorScheme[] = ["light"];

const VISUAL_FIXTURE = buildVisualFixtureState();
const SHORT_FIXTURE = buildFixtureState();

function serializeDesktopFixtureState(fixture: typeof VISUAL_FIXTURE.state): string {
    // Public shares omit the author's cursor. Desktop screenshots provide a
    // deterministic test cursor separately so annotation activation cannot
    // drift when the production share wire changes transient-state policy.
    return JSON.stringify({
        selection: fixture.selection.toJSON(),
        ...serializeFixtureWire(fixture),
    });
}

const VISUAL_STATE_JSON = serializeDesktopFixtureState(VISUAL_FIXTURE.state);
const SHORT_STATE_JSON = serializeDesktopFixtureState(SHORT_FIXTURE.state);

const SCREENSHOT_OPTIONS = {
    animations: "disabled" as const,
    caret: "hide" as const,
    scale: "css" as const,
    // The official Playwright Linux image owns the baselines. Half a percent
    // permits only minor antialiasing noise; layout/color drift still fails.
    maxDiffPixelRatio: 0.005,
    threshold: 0.2,
};

test.use({
    deviceScaleFactor: 1,
    locale: "en-US",
    timezoneId: "UTC",
});

test.beforeEach(async ({ page }, testInfo) => {
    // The rich shared fixture can be the first route compiled on a cold Linux
    // runner; leave enough room for startup without weakening assertion waits.
    testInfo.setTimeout(60_000);
    // Keep Playwright's platform suffix: Linux owns the required baselines,
    // while an explicit update on macOS must not overwrite canonical pixels.
    await page.clock.setFixedTime(new Date(VISUAL_FIXTURE_TIME));
    await page.addInitScript(() => {
        (window as unknown as Record<string, unknown>).__QUILLIUM_SCREENSHOT_AUTH_ONLINE__ = true;
        let randomState = 0x316;
        Math.random = () => {
            randomState = (randomState * 16_807) % 2_147_483_647;
            return (randomState - 1) / 2_147_483_646;
        };

        let uuidCounter = 0;
        try {
            Object.defineProperty(globalThis.crypto, "randomUUID", {
                configurable: true,
                value: () => {
                    uuidCounter += 1;
                    return `00000000-0000-4000-8000-${uuidCounter.toString().padStart(12, "0")}`;
                },
            });
        } catch {
            // The fixture already carries fixed ids; this only covers incidental UI ids.
        }
        document.addEventListener(
            "DOMContentLoaded",
            () => {
                const style = document.createElement("style");
                style.dataset.visualRegression = "true";
                style.textContent = `
                    *, *::before, *::after {
                        animation-delay: 0s !important;
                        animation-duration: 0s !important;
                        caret-color: transparent !important;
                        transition-delay: 0s !important;
                        transition-duration: 0s !important;
                    }
                    [aria-label="Open debug panel"] { display: none !important; }
                `;
                document.head.appendChild(style);
            },
            { once: true },
        );
    });
});

test.afterEach(async ({ page }, testInfo) => {
    if (testInfo.status === testInfo.expectedStatus) return;
    await testInfo.attach("rendered-dom", {
        body: await page.content(),
        contentType: "text/html",
    });
});

function fixtureOptions(initialStateJson = VISUAL_STATE_JSON): Partial<TauriMockOptions> {
    return {
        initialStateJson,
        settings: {
            aiEnabled: false,
            annotationLayout: "visual-split",
            atomicRevisions: true,
            docFontFamily: '"Lora", Georgia, serif',
            docFontSize: 18,
            grammarCheckEnabled: false,
            showNestedEditor: true,
            showShortcutHints: false,
            // The default hover title briefly lingers after mount. Hide that unrelated chrome so
            // screenshot timing cannot decide whether the editor loses an extra title row.
            titleVisibility: "never",
            uiFontFamily: '"Inter", system-ui, sans-serif',
            uiZoom: 1,
        },
    };
}

async function preparePage(
    page: Page,
    colorScheme: ColorScheme,
    viewport: { width: number; height: number },
): Promise<void> {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
}

async function settleVisuals(page: Page): Promise<void> {
    await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
    });
}

async function expectDesktopFixtureReady(
    page: Page,
    qp: QuilliumPage,
    expectedCardCount = 6,
): Promise<void> {
    // CodeMirror virtualizes off-screen lines at narrow heights, so assert the
    // serialized fixture through a visible document sentinel plus all six cards.
    await expect(qp.editor).toContainText(VISUAL_FIXTURE.targets.start);
    await expect(page.locator("[data-annotation-card]")).toHaveCount(expectedCardCount);
    if (expectedCardCount > 0) {
        await expect(page.locator('[data-annotation-id="102"]')).toBeAttached();
        await expect
            .poll(() =>
                qp.annotationCards.evaluateAll((cards) =>
                    cards.every((card) => (card as HTMLElement).style.top !== ""),
                ),
            )
            .toBe(true);
    } else {
        // Constrained desktop/mobile intentionally uses modal-only annotations.
        await expect(page.locator("#editor-document .cm-comment").first()).toBeAttached();
        await expect(page.locator("#editor-document .cm-revision").first()).toBeAttached();
    }
    await settleVisuals(page);
}

async function expectHistoryFixtureReady(page: Page): Promise<void> {
    const preview = page.locator(".version-preview");
    await expect(preview.locator(".cm-content")).toContainText(VISUAL_FIXTURE.targets.start);
    const cards = page.getByRole("complementary", { name: "Snapshot annotations" });
    await expect(cards.locator("[data-annotation-card]")).toHaveCount(6);
    await expect(preview.locator(".cm-content")).toHaveAttribute("contenteditable", "false");
    await settleVisuals(page);
}

async function scrollDesktopToAnchor(page: Page, anchor: Anchor): Promise<void> {
    const container = page.locator("#editor-document").locator("..");
    if (anchor === "start") {
        await container.evaluate((element) => {
            element.scrollTop = 0;
        });
        await expect.poll(() => container.evaluate((element) => element.scrollTop)).toBe(0);
        await settleVisuals(page);
        return;
    }

    if (anchor === "end") {
        await container.evaluate((element) => {
            element.scrollTop = element.scrollHeight;
        });
        await settleVisuals(page);
    }

    const revisions = page.locator("#editor-document .cm-revision");
    const revision =
        anchor === "middle"
            ? revisions.first()
            : revisions.filter({ hasText: VISUAL_FIXTURE.targets.end }).first();
    await expect(revision).toBeAttached();
    // CodeMirror replaces its virtual gap with rendered lines after every large scroll. Repeat
    // against the freshly measured target so the final frame cannot capture an intermediate gap.
    for (let attempt = 0; attempt < 8; attempt += 1) {
        await revision.evaluate((element) => {
            const scrollContainer = document.querySelector("#editor-document")?.parentElement;
            if (!(scrollContainer instanceof HTMLElement)) {
                throw new Error("Could not resolve the desktop editor scroll container");
            }
            const containerRect = scrollContainer.getBoundingClientRect();
            const targetRect = element.getBoundingClientRect();
            scrollContainer.scrollTop +=
                targetRect.top -
                containerRect.top -
                (scrollContainer.clientHeight - targetRect.height) / 2;
        });
        await settleVisuals(page);
    }
    await expect
        .poll(() =>
            revision.evaluate((element) => {
                const scrollContainer = document.querySelector("#editor-document")?.parentElement;
                if (!(scrollContainer instanceof HTMLElement)) {
                    return Number.POSITIVE_INFINITY;
                }
                const containerRect = scrollContainer.getBoundingClientRect();
                const targetRect = element.getBoundingClientRect();
                const targetOffset =
                    targetRect.top -
                    containerRect.top -
                    (scrollContainer.clientHeight - targetRect.height) / 2;
                const maxScrollTop = Math.max(
                    0,
                    scrollContainer.scrollHeight - scrollContainer.clientHeight,
                );
                const desiredScrollTop = Math.min(
                    Math.max(0, scrollContainer.scrollTop + targetOffset),
                    maxScrollTop,
                );
                return Math.abs(scrollContainer.scrollTop - desiredScrollTop);
            }),
        )
        .toBeLessThanOrEqual(2);
    await expect(revision).toBeVisible();
    if (anchor === "end") {
        await expect(
            page
                .locator("#editor-document .cm-line")
                .filter({ hasText: "She closed the folder only after the rain eased." }),
        ).toBeVisible();
    }
}

async function isolateHistoryPreview(page: Page): Promise<void> {
    await page.locator(".history-preview-content").evaluate((content) => {
        const grid = content.closest(".history-document-grid");
        const structure = grid?.querySelector(":scope > aside");
        if (structure instanceof HTMLElement) structure.style.display = "none";
        if (grid instanceof HTMLElement) {
            // The real history shell reserves a column for the draft tree. It
            // has already been asserted above; collapse that empty test-only
            // column so the stage is measured at the requested viewport width.
            grid.style.gridTemplateColumns = "minmax(0, 1fr)";
            grid.style.columnGap = "0";
            const tabs = grid.querySelector(".history-tabs");
            const historyContent = grid.querySelector(".history-content");
            if (tabs instanceof HTMLElement) tabs.style.gridColumn = "1";
            if (historyContent instanceof HTMLElement) historyContent.style.gridColumn = "1";
        }
        const timeline = document.querySelector("#versions-panel");
        if (timeline instanceof HTMLElement) {
            const historyBody = timeline.parentElement;
            const topBar = historyBody?.previousElementSibling;
            timeline.style.display = "none";
            if (topBar instanceof HTMLElement) topBar.style.display = "none";
        }
    });
    await expect
        .poll(() =>
            page
                .locator(".history-preview-content")
                .evaluate((content) => content.scrollWidth <= content.clientWidth + 1),
        )
        .toBe(true);
    await settleVisuals(page);
}

async function selectHistoryAnchor(page: Page, anchor: Anchor): Promise<Locator> {
    const annotationId = anchor === "start" ? 100 : anchor === "middle" ? 102 : 105;
    const annotation = page
        .getByRole("complementary", { name: "Snapshot annotations" })
        .locator(`[data-annotation-id="${annotationId}"]`);
    const cardType = await annotation.getAttribute("data-annotation-card");
    if (cardType === "revision") {
        // Select through the read-only document so linked version state remains untouched.
        const inlineRevision = page
            .locator(".version-preview .cm-revision")
            .filter({ hasText: VISUAL_FIXTURE.targets.middle })
            .first();
        await inlineRevision.scrollIntoViewIfNeeded();
        await inlineRevision.click();
    } else {
        await annotation.locator('button[title^="Jump to this comment"]').click();
    }
    await expect(annotation).toHaveAttribute("data-active", "true");
    await settleVisuals(page);
    return annotation;
}

async function positionHistoryTarget(
    page: Page,
    target: Locator,
    viewportFraction: number,
): Promise<void> {
    await expect(target).toBeAttached();
    // The CodeMirror document above the target redraws its virtual viewport as the containing pane
    // scrolls. Repeat the adjustment so its stable height, not an intermediate gap, owns the shot.
    for (let attempt = 0; attempt < 8; attempt += 1) {
        await target.evaluate((element, fraction) => {
            let candidate: HTMLElement | null = element.parentElement;
            while (candidate) {
                const overflowY = getComputedStyle(candidate).overflowY;
                if (
                    (overflowY === "auto" || overflowY === "scroll") &&
                    candidate.scrollHeight > candidate.clientHeight + 1
                ) {
                    break;
                }
                candidate = candidate.parentElement;
            }
            const scrollContainer = candidate ?? document.scrollingElement;
            if (!(scrollContainer instanceof HTMLElement)) {
                throw new Error("Could not resolve the History preview scroll container");
            }
            scrollContainer.dataset.visualHistoryScroller = "true";
            const isRoot = scrollContainer === document.documentElement;
            const containerTop = isRoot ? 0 : scrollContainer.getBoundingClientRect().top;
            const containerHeight = isRoot ? window.innerHeight : scrollContainer.clientHeight;
            const targetRect = element.getBoundingClientRect();
            scrollContainer.scrollTop += targetRect.top - containerTop - containerHeight * fraction;
        }, viewportFraction);
        await settleVisuals(page);
    }
    await expect
        .poll(() =>
            target.evaluate((element, fraction) => {
                const scrollContainer = document.querySelector(
                    '[data-visual-history-scroller="true"]',
                );
                if (!(scrollContainer instanceof HTMLElement)) return Number.POSITIVE_INFINITY;
                const isRoot = scrollContainer === document.documentElement;
                const containerTop = isRoot ? 0 : scrollContainer.getBoundingClientRect().top;
                const containerHeight = isRoot ? window.innerHeight : scrollContainer.clientHeight;
                return Math.abs(
                    element.getBoundingClientRect().top - containerTop - containerHeight * fraction,
                );
            }, viewportFraction),
        )
        .toBeLessThanOrEqual(2);
}

async function positionHistoryStackBoundary(page: Page): Promise<void> {
    await positionHistoryTarget(page, page.locator(".history-annotation-column"), 0.45);
}

function mainAnnotationCard(page: Page, annotationId: number) {
    return page.locator(".annotation-card, .annotation-card-inline").filter({
        has: page.locator(`[data-annotation-id="${annotationId}"]`),
    });
}

async function openMainRevisionModal(
    page: Page,
    qp: QuilliumPage,
    revisionId: number,
): Promise<void> {
    const card = mainAnnotationCard(page, revisionId);
    await expect(card).toBeAttached();
    await card.getByRole("button", { name: "Focus annotation" }).dispatchEvent("click");
    const expand = card.locator("[data-tutorial-action='expand-revision-modal']");
    await expect(expand).toBeVisible();
    await expand.dispatchEvent("click");
    await expect(qp.modalEditor).toBeVisible({ timeout: 8_000 });
    await settleVisuals(page);
}

test("inactive revisions recede, reveal on hover, and retain active styling", async ({
    page,
}, testInfo) => {
    await preparePage(page, "light", VIEWPORTS[0]);
    const qp = new QuilliumPage(page, fixtureOptions());
    qp.capturePageErrors();
    await qp.init();
    await expectDesktopFixtureReady(page, qp);
    const revision = page.locator("#editor-document .cm-revision").first();
    await page.mouse.move(0, 0);
    await expect(revision).toHaveCSS("text-decoration-color", "rgba(168, 85, 247, 0.35)");
    await expect(revision).toHaveCSS("text-decoration-thickness", "1px");
    await testInfo.attach("inactive-revisions", {
        body: await page.screenshot({
            ...SCREENSHOT_OPTIONS,
            path: testInfo.outputPath("inactive-revisions.png"),
        }),
        contentType: "image/png",
    });
    await revision.hover();
    await expect(revision).toHaveCSS("text-decoration-color", "rgb(168, 85, 247)");
    await expect(revision).toHaveCSS("text-decoration-thickness", "2px");
    await testInfo.attach("hovered-revision", {
        body: await page.screenshot({
            ...SCREENSHOT_OPTIONS,
            path: testInfo.outputPath("hovered-revision.png"),
        }),
        contentType: "image/png",
    });
    await page.mouse.move(0, 0);
    await expect(revision).toHaveCSS("text-decoration-thickness", "1px");
    const focusRevision = mainAnnotationCard(page, VISUAL_FIXTURE.ids.rootRevision).getByRole(
        "button",
        { name: "Focus annotation" },
    );
    await focusRevision.focus();
    await page.keyboard.press("Enter");
    const active = page.locator("#editor-document .cm-revision-active").first();
    await expect(active).toHaveCSS("background-color", "rgb(216, 180, 254)");
    await active.hover();
    await expect(active).toHaveCSS("text-decoration-line", "none");
    qp.expectNoPageErrors();
});

test.describe("touch revision decorations", () => {
    test.use({ hasTouch: true, isMobile: true });

    test("inactive revision marks stay visible without hover", async ({ page }) => {
        await preparePage(page, "light", VIEWPORTS[2]);
        const qp = new QuilliumPage(page, fixtureOptions());
        await qp.init();
        await expectDesktopFixtureReady(page, qp, 0);
        expect(await page.evaluate(() => matchMedia("(hover: none)").matches)).toBe(true);
        const revision = page.locator("#editor-document .cm-revision").first();
        await expect(revision).toHaveCSS("text-decoration-color", "rgb(168, 85, 247)");
        await expect(revision).toHaveCSS("text-decoration-thickness", "2px");
    });
});

for (const viewport of VIEWPORTS) {
    for (const colorScheme of COLOR_SCHEMES) {
        test(`desktop shared annotations — ${viewport.name} ${colorScheme}`, async ({ page }) => {
            await preparePage(page, colorScheme, viewport);
            const qp = new QuilliumPage(page, fixtureOptions());
            qp.capturePageErrors();
            await qp.init();
            await expectDesktopFixtureReady(page, qp, viewport.name === "wide" ? 6 : 0);
            await scrollDesktopToAnchor(page, viewport.anchor);

            await expect(page).toHaveScreenshot(
                `desktop-annotations-${viewport.name}-${colorScheme}.png`,
                SCREENSHOT_OPTIONS,
            );
            qp.expectNoPageErrors();
        });

        test(`history shared annotations — ${viewport.name} ${colorScheme}`, async ({ page }) => {
            await preparePage(page, colorScheme, viewport);
            const qp = new QuilliumPage(page, {
                ...fixtureOptions(),
                snapshots: [
                    {
                        id: 2,
                        draftId: "draft-test-1",
                        upToEventId: 20,
                        createdAt: VISUAL_FIXTURE_TIME - 60_000,
                        label: "Annotation parity fixture",
                        doc: VISUAL_FIXTURE.state.doc.toString(),
                        stateJson: VISUAL_STATE_JSON,
                    },
                    {
                        id: 1,
                        draftId: "draft-test-1",
                        upToEventId: 10,
                        createdAt: VISUAL_FIXTURE_TIME - 120_000,
                        label: "Previous fixture state",
                        doc: VISUAL_FIXTURE.state.doc.toString(),
                    },
                ],
            });
            await qp.initHistory();
            await expectHistoryFixtureReady(page);
            // Narrow previews virtualize this passage until their anchor is selected below.
            if (viewport.name === "wide") {
                const inactiveRevision = page.locator(".version-preview .cm-revision").first();
                await page.mouse.move(0, 0);
                await expect(inactiveRevision).toHaveCSS("text-decoration-thickness", "1px");
                await inactiveRevision.hover();
                await expect(inactiveRevision).toHaveCSS("text-decoration-thickness", "2px");
                await page.mouse.move(0, 0);
            }
            await isolateHistoryPreview(page);
            await expect(page.locator(".history-preview-stage")).toHaveCSS(
                "flex-direction",
                viewport.name === "wide" ? "row" : "column",
            );
            const selectedAnnotation = await selectHistoryAnchor(page, viewport.anchor);

            const screenshotName = `history-annotations-${viewport.name}-${colorScheme}.png`;
            if (viewport.name === "wide") {
                const historyCapture = page.locator(".history-preview-stage");
                await expect(historyCapture).toBeVisible();
                await expect(historyCapture).toHaveScreenshot(screenshotName, SCREENSHOT_OPTIONS);
            } else {
                // Capture the true responsive boundary: the document remains above the annotation
                // column, and the viewport contains the end of one plus the beginning of the other.
                await positionHistoryStackBoundary(page);
                await expect(page).toHaveScreenshot(screenshotName, SCREENSHOT_OPTIONS);

                // A focused card baseline proves the viewport's middle/end fixture target without
                // replacing the real document-to-annotation boundary captured above.
                await expect(selectedAnnotation).toHaveScreenshot(
                    `history-selected-${viewport.anchor}-${viewport.name}-${colorScheme}.png`,
                    SCREENSHOT_OPTIONS,
                );
            }
        });
    }
}

test("revision Context preserves a real wheel position through edits and resize", async ({
    page,
}) => {
    await preparePage(page, "light", { width: 1440, height: 900 });
    const qp = new QuilliumPage(page, fixtureOptions());
    qp.capturePageErrors();
    await qp.init();
    await expectDesktopFixtureReady(page, qp);
    await openMainRevisionModal(page, qp, VISUAL_FIXTURE.ids.rootRevision);

    const context = page.locator("[data-revision-context-scroll]");
    await expect(context).toBeVisible();
    await expect
        .poll(() => context.evaluate((element) => element.scrollHeight > element.clientHeight + 1))
        .toBe(true);
    const beforeWheel = await context.evaluate((element) => element.scrollTop);
    await context.hover();
    await page.mouse.wheel(0, 180);
    await expect
        .poll(() => context.evaluate((element) => element.scrollTop))
        .toBeGreaterThan(beforeWheel);
    const afterWheel = await context.evaluate((element) => element.scrollTop);

    await qp.modalEditor.click();
    await page.keyboard.press("End");
    await page.keyboard.type("!");
    await expect(page.locator('[data-context-target-depth="0"]')).toContainText(
        "She underlined the passage twice.!",
    );
    const afterTransaction = await context.evaluate((element) => element.scrollTop);
    expect(afterTransaction).toBeGreaterThan(0);
    expect(Math.abs(afterTransaction - afterWheel)).toBeLessThan(80);

    const beforeResize = afterTransaction;
    await page.setViewportSize({ width: 1000, height: 720 });
    await expect(context).toBeVisible();
    await expect
        .poll(() =>
            context.evaluate((element, previousScrollTop) => {
                const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
                return Math.abs(element.scrollTop - Math.min(previousScrollTop, maxScrollTop));
            }, beforeResize),
        )
        .toBeLessThanOrEqual(2);
    await expect(page.locator('[data-context-target-depth="0"]')).toContainText(
        "She underlined the passage twice.!",
    );
    await settleVisuals(page);
    await expect(page).toHaveScreenshot(
        "desktop-revision-modal-long-context.png",
        SCREENSHOT_OPTIONS,
    );
    qp.expectNoPageErrors();
});

test("short shared fixture renders an underflowing revision Context", async ({ page }) => {
    await preparePage(page, "light", { width: 1440, height: 760 });
    const qp = new QuilliumPage(page, fixtureOptions(SHORT_STATE_JSON));
    qp.capturePageErrors();
    await qp.init();
    await expect(page.locator("[data-annotation-card]")).toHaveCount(4);
    await openMainRevisionModal(page, qp, SHORT_FIXTURE.ids.revA);

    const context = page.locator("[data-revision-context-scroll]");
    await expect(context).toBeVisible();
    await expect
        .poll(() => context.evaluate((element) => element.scrollHeight <= element.clientHeight + 1))
        .toBe(true);
    await expect(context).toHaveAttribute("data-has-more-before", "false");
    await expect(context).toHaveAttribute("data-has-more-after", "false");
    await settleVisuals(page);
    await expect(page).toHaveScreenshot(
        "desktop-revision-modal-underflow-context.png",
        SCREENSHOT_OPTIONS,
    );
    qp.expectNoPageErrors();
});

test("fixed nested fixture explores three revision depths and breadcrumb states", async ({
    page,
}) => {
    await preparePage(page, "light", { width: 1440, height: 900 });
    const qp = new QuilliumPage(page, fixtureOptions());
    qp.capturePageErrors();
    await qp.init();
    await expectDesktopFixtureReady(page, qp);
    await openMainRevisionModal(page, qp, VISUAL_FIXTURE.ids.rootRevision);

    for (const revisionId of [VISUAL_FIXTURE.ids.nestedRevision, VISUAL_FIXTURE.ids.deepRevision]) {
        const card = page
            .locator("dialog[open] .annotation-card-inline")
            .filter({ has: page.locator(`[data-revision-id="${revisionId}"]`) });
        await expect(card).toBeVisible();
        await card.locator("[data-tutorial-action='expand-revision-modal']").dispatchEvent("click");
        await expect(qp.modalEditor).toBeVisible({ timeout: 8_000 });
        await settleVisuals(page);
    }

    const breadcrumbs = page.locator("dialog[open] [data-revision-breadcrumbs]");
    await expect(breadcrumbs.locator("[data-breadcrumb-id]")).toHaveCount(3);
    await expect(page.locator("dialog[open] .annotation-card-inline")).toHaveCount(1);
    const currentVersion = breadcrumbs
        .getByRole("button", {
            name: /Revision version:/,
        })
        .last();
    await currentVersion.click();
    await expect(breadcrumbs.locator(".version-popover")).toBeVisible();
    await settleVisuals(page);
    await expect(page).toHaveScreenshot(
        "desktop-revision-modal-depth-3-breadcrumb.png",
        SCREENSHOT_OPTIONS,
    );

    await currentVersion.click();
    await currentVersion.dblclick();
    await expect(
        breadcrumbs.getByRole("textbox", { name: "Rename current version" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Collapse Annotations" }).click();
    await expect(page.locator("dialog[open] [data-annotation-panel]")).toHaveAttribute(
        "data-collapsed",
        "true",
    );
    await settleVisuals(page);
    await expect(page).toHaveScreenshot(
        "desktop-revision-modal-depth-3-rename-collapsed.png",
        SCREENSHOT_OPTIONS,
    );
    qp.expectNoPageErrors();
});

test("linked alternate versions switch together in the writable fixture", async ({ page }) => {
    await preparePage(page, "light", { width: 1440, height: 900 });
    const qp = new QuilliumPage(page, fixtureOptions());
    qp.capturePageErrors();
    await qp.init();
    await expectDesktopFixtureReady(page, qp);

    const rootCard = mainAnnotationCard(page, VISUAL_FIXTURE.ids.rootRevision);
    await rootCard.getByRole("button", { name: "Focus annotation" }).dispatchEvent("click");
    await rootCard.getByRole("button", { name: /^Direct account, linked in Formal voice/ }).click();

    const expectedText = VISUAL_FIXTURE.state.doc
        .toString()
        .replace(
            VISUAL_FIXTURE.targets.middle,
            "The curator found a margin note about the keeper, the lantern room, and a bell heard before dawn.",
        )
        .replace(VISUAL_FIXTURE.targets.end, "the final harbor lamp surrendered to the weather");
    await qp.expectEditorText(expectedText);
    await expect(
        rootCard.getByRole("button", { name: /^Direct account, linked in Formal voice/ }),
    ).toBeDisabled();
    const endCard = mainAnnotationCard(page, VISUAL_FIXTURE.ids.endRevision);
    await expect(
        endCard.getByRole("button", { name: /^Sharper, linked in Formal voice/ }),
    ).toBeDisabled();
    await scrollDesktopToAnchor(page, "middle");
    await expect(page).toHaveScreenshot("desktop-linked-version-switch.png", SCREENSHOT_OPTIONS);
    qp.expectNoPageErrors();
});

test("comment and suggestion modals retain long threads and replacement detail", async ({
    page,
}) => {
    await preparePage(page, "light", { width: 1280, height: 800 });
    const qp = new QuilliumPage(page, fixtureOptions());
    qp.capturePageErrors();
    await qp.init();
    await expectDesktopFixtureReady(page, qp);

    const commentCard = mainAnnotationCard(page, VISUAL_FIXTURE.ids.startComment);
    await commentCard.getByRole("button", { name: "Focus annotation" }).dispatchEvent("click");
    await commentCard.getByRole("button", { name: "Expand comment thread" }).click();
    await expect(page.locator('[data-annotation-modal-frame="comment"]')).toBeVisible();
    const commentModal = page.locator('[data-annotation-modal-frame="comment"]');
    await expect(
        commentModal.getByText("Keeping them, then. The sound returns at the end."),
    ).toBeVisible();
    await settleVisuals(page);
    await expect(page).toHaveScreenshot(
        "desktop-comment-modal-long-thread.png",
        SCREENSHOT_OPTIONS,
    );
    await page.getByRole("button", { name: "Close comment" }).click();

    const suggestionCard = mainAnnotationCard(page, VISUAL_FIXTURE.ids.suggestion);
    await suggestionCard.getByRole("button", { name: "Focus annotation" }).dispatchEvent("click");
    await suggestionCard.getByRole("button", { name: "Expand suggestion diff" }).click();
    const suggestionModal = page.locator('[data-annotation-modal-frame="suggestion"]');
    await expect(suggestionModal).toBeVisible();
    await expect(
        suggestionModal.getByText("The printed tide tables insisted on calm"),
    ).toBeVisible();
    await expect(suggestionModal.getByText("Promised quietly echoes the letters.")).toBeVisible();
    await settleVisuals(page);
    await expect(page).toHaveScreenshot(
        "desktop-suggestion-modal-replacements.png",
        SCREENSHOT_OPTIONS,
    );
    qp.expectNoPageErrors();
});
