/**
 * E2E tests for the dictionary/thesaurus popover (⌘B).
 *
 * The Free Dictionary API is mocked via Playwright's route interception
 * so tests are hermetic and don't depend on network availability.
 */

import { expect, test, type Page } from "@playwright/test";
import { QuilliumPage } from "./QuilliumPage";

// ── Mock data ────────────────────────────────────────────────────────────────

const MOCK_DICT_RESPONSE = [
    {
        word: "helpful",
        phonetic: "/ˈhɛlp.fəl/",
        phonetics: [{ text: "/ˈhɛlp.fəl/" }],
        meanings: [
            {
                partOfSpeech: "adjective",
                definitions: [
                    {
                        definition: "Furnishing help; giving aid; useful.",
                        example: "a helpful assistant",
                        synonyms: ["useful", "beneficial", "supportive"],
                        antonyms: ["unhelpful"],
                    },
                ],
                synonyms: ["useful", "beneficial"],
                antonyms: ["unhelpful"],
            },
        ],
    },
];

async function mockDictionaryApi(page: Page) {
    await page.route("**/api.dictionaryapi.dev/**", (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(MOCK_DICT_RESPONSE),
        }),
    );
}

async function mockDictionaryApiNotFound(page: Page) {
    await page.route("**/api.dictionaryapi.dev/**", (route) =>
        route.fulfill({ status: 404, body: "[]" }),
    );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Type a word, select it, and open the dictionary popover via ⌘B. */
async function openDictionaryOn(q: QuilliumPage, word: string) {
    await q.typeInEditor(word);
    await q.selectAll();
    await q.page.keyboard.press("ControlOrMeta+b");
}

/**
 * The popover is always mounted (opacity-0 when hidden, opacity-100 when visible).
 * Use these helpers instead of toBeVisible/not.toBeVisible.
 */
async function expectPopoverVisible(page: Page) {
    await expect(page.locator(".dictionary-popover")).toHaveClass(/opacity-100/, {
        timeout: 5_000,
    });
}

async function expectPopoverHidden(page: Page) {
    await expect(page.locator(".dictionary-popover")).toHaveClass(/opacity-0/, { timeout: 3_000 });
}

// ── Tests ────────────────────────────────────────────────────────────────────

test.describe("dictionary popover", () => {
    test("opens on ⌘B with a word selected and shows definition", async ({ page }) => {
        await mockDictionaryApi(page);
        const q = new QuilliumPage(page);
        await q.init();

        await openDictionaryOn(q, "helpful");

        await expectPopoverVisible(page);
        const popover = page.locator(".dictionary-popover");
        await expect(popover).toContainText("helpful");
        await expect(popover).toContainText("/ˈhɛlp.fəl/");
        await expect(popover).toContainText("Furnishing help");
    });

    test("shows synonyms and antonyms", async ({ page }) => {
        await mockDictionaryApi(page);
        const q = new QuilliumPage(page);
        await q.init();

        await openDictionaryOn(q, "helpful");

        const popover = page.locator(".dictionary-popover");
        await expect(popover).toContainText("useful");
        await expect(popover).toContainText("unhelpful");
    });

    test("shows no results message for unknown word", async ({ page }) => {
        await mockDictionaryApiNotFound(page);
        const q = new QuilliumPage(page);
        await q.init();

        await openDictionaryOn(q, "xyzzy");

        await expectPopoverVisible(page);
        await expect(page.locator(".dictionary-popover")).toContainText("No results");
    });

    test("dismisses on Escape", async ({ page }) => {
        await mockDictionaryApi(page);
        const q = new QuilliumPage(page);
        await q.init();

        await openDictionaryOn(q, "helpful");
        await expectPopoverVisible(page);

        await q.escape();
        await expectPopoverHidden(page);
    });

    test("dismisses on backdrop click", async ({ page }) => {
        await mockDictionaryApi(page);
        const q = new QuilliumPage(page);
        await q.init();

        await openDictionaryOn(q, "helpful");
        await expectPopoverVisible(page);

        // Click far away from the popover
        await page.mouse.click(10, 10);
        await expectPopoverHidden(page);
    });

    test("synonym click replaces word in editor", async ({ page }) => {
        await mockDictionaryApi(page);
        const q = new QuilliumPage(page);
        await q.init();

        await openDictionaryOn(q, "helpful");
        await expectPopoverVisible(page);

        await page.locator(".dictionary-popover button", { hasText: "useful" }).first().click();
        await q.expectEditorText("useful");
    });

    test("open in chat disabled without API key", async ({ page }) => {
        await mockDictionaryApi(page);
        const q = new QuilliumPage(page); // no apiKey
        await q.init();

        await openDictionaryOn(q, "helpful");
        await expectPopoverVisible(page);

        const openInChatBtn = page.locator(".dictionary-popover button[title='Needs API key']");
        await expect(openInChatBtn).toBeDisabled();
    });

    test("open in chat opens AI sidebar with API key", async ({ page }) => {
        await mockDictionaryApi(page);
        const q = new QuilliumPage(page, {
            apiKey: "test-key",
            settings: { showNestedEditor: true, atomicRevisions: true, aiEnabled: true },
        });
        // Set the has-api-key flag so hasApiKey() returns true immediately
        // without waiting for the lazy keychain load.
        await page.addInitScript(() => {
            localStorage.setItem("quillium-has-api-key", "1");
        });
        await q.init();

        await openDictionaryOn(q, "helpful");
        await expectPopoverVisible(page);

        await page.locator(".dictionary-popover button[title='Open in Chat']").click();

        // Popover should close and chat sidebar should open
        await expectPopoverHidden(page);
        await expect(q.aiSidebar).toContainText("Start a conversation", { timeout: 5_000 });
    });

    test("does not open on multiword selection", async ({ page }) => {
        await mockDictionaryApi(page);
        const q = new QuilliumPage(page);
        await q.init();

        await q.typeInEditor("two words");
        await q.selectAll();
        await q.page.keyboard.press("ControlOrMeta+b");

        // Popover should not appear for multi-word selections
        await expectPopoverHidden(page);
    });
});
