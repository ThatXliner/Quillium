/**
 * E2E tests for the dictionary/thesaurus popover (⌘D).
 *
 * Lookups use the configured AI model. The OpenAI Responses endpoint is
 * mocked via Playwright's route interception so tests are hermetic and
 * don't depend on credentials or network availability.
 */

import { type Page, expect, test } from "@playwright/test";
import { QuilliumPage } from "./QuilliumPage";

// ── Mock data ────────────────────────────────────────────────────────────────

const MOCK_ENTRY = {
    phonetic: "/ˈhɛlp.fəl/",
    meanings: [
        {
            partOfSpeech: "adjective",
            definitions: [
                {
                    definition: "Furnishing help; giving aid; useful.",
                    example: "a helpful assistant",
                },
            ],
        },
    ],
    synonyms: ["useful", "beneficial", "supportive"],
    antonyms: ["unhelpful"],
};

const EMPTY_ENTRY = { phonetic: "", meanings: [], synonyms: [], antonyms: [] };

async function mockDictionaryModel(page: Page, entry: object = MOCK_ENTRY) {
    await page.route("https://api.openai.com/**", (route) =>
        route.fulfill({
            contentType: "application/json",
            body: JSON.stringify({
                id: "resp_dictionary",
                object: "response",
                created_at: 1,
                model: "gpt-5.6-sol",
                status: "completed",
                output: [
                    {
                        id: "msg_dictionary",
                        type: "message",
                        role: "assistant",
                        status: "completed",
                        content: [
                            { type: "output_text", text: JSON.stringify(entry), annotations: [] },
                        ],
                    },
                ],
                usage: {
                    input_tokens: 50,
                    output_tokens: 50,
                    total_tokens: 100,
                    input_tokens_details: { cached_tokens: 0 },
                    output_tokens_details: { reasoning_tokens: 0 },
                },
            }),
        }),
    );
}

/** A Quillium page with a connected OpenAI API key. */
function connectedPage(page: Page): QuilliumPage {
    return new QuilliumPage(page, { apiKey: "test-key" });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Type a word, select it, and open the dictionary popover via ⌘D. */
async function openDictionaryOn(q: QuilliumPage, word: string) {
    await q.typeInEditor(word);
    await q.selectAll();
    await q.page.keyboard.press("Control+d");
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
    test("keeps a delayed result inside a short viewport", async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 520 });
        await mockDictionaryModel(page);
        let releaseResponse = (): void => {};
        const responseReady = new Promise<void>((resolve) => {
            releaseResponse = resolve;
        });
        await page.route("https://api.openai.com/**", async (route) => {
            await responseReady;
            await route.fallback();
        });
        const q = connectedPage(page);
        await q.init();
        await q.typeInEditor(`${"A line of writing.\n".repeat(20)}helpful`);
        for (let index = 0; index < 7; index += 1) await page.keyboard.press("Shift+ArrowLeft");
        await page.keyboard.press("Control+d");
        const popover = page.locator(".dictionary-popover").first();
        await expect(popover).toContainText("Looking up...");
        releaseResponse();
        await expect(popover).toContainText("Furnishing help");
        await expect
            .poll(async () => {
                const bounds = await popover.boundingBox();
                return bounds !== null && bounds.y >= 8 && bounds.y + bounds.height <= 512;
            })
            .toBe(true);
        await expect(popover.getByRole("textbox", { name: "Describe the idea" })).toBeVisible();
    });

    test("explains AI disabled and offers settings without sending a request", async ({ page }) => {
        const requests: string[] = [];
        page.on("request", (request) => {
            if (request.url().includes("api.openai.com")) requests.push(request.url());
        });
        const q = new QuilliumPage(page, {
            apiKey: "test-key",
            settings: { aiEnabled: false, grammarCheckEnabled: false },
        });
        await q.init();
        await openDictionaryOn(q, "helpful");
        const popover = page.locator(".dictionary-popover").first();
        await expect(popover).toContainText("Enable AI in Settings to look up words.");
        await expect(
            popover.getByRole("button", { name: "Open Settings", exact: true }),
        ).toBeVisible();
        await expect(popover.getByRole("button", { name: "Find", exact: true })).toHaveCount(0);
        expect(requests).toEqual([]);
    });

    test("opens on ⌘D with a word selected and shows definition", async ({ page }) => {
        const freeDictionaryRequests: string[] = [];
        page.on("request", (request) => {
            if (request.url().includes("dictionaryapi.dev")) {
                freeDictionaryRequests.push(request.url());
            }
        });
        await mockDictionaryModel(page);
        const q = connectedPage(page);
        await q.init();

        await openDictionaryOn(q, "helpful");

        await expectPopoverVisible(page);
        const popover = page.locator(".dictionary-popover");
        await expect(popover).toContainText("helpful");
        await expect(popover).toContainText("/ˈhɛlp.fəl/");
        await expect(popover).toContainText("Furnishing help");
        expect(freeDictionaryRequests).toEqual([]);
    });

    test("shows synonyms and antonyms", async ({ page }) => {
        await mockDictionaryModel(page);
        const q = connectedPage(page);
        await q.init();

        await openDictionaryOn(q, "helpful");

        const popover = page.locator(".dictionary-popover");
        await expect(popover).toContainText("useful");
        await expect(popover).toContainText("unhelpful");
    });

    test("shows no results message for unknown word", async ({ page }) => {
        await mockDictionaryModel(page, EMPTY_ENTRY);
        const q = connectedPage(page);
        await q.init();

        await openDictionaryOn(q, "xyzzy");

        await expectPopoverVisible(page);
        await expect(page.locator(".dictionary-popover")).toContainText(
            'No definition found for "xyzzy".',
        );
    });

    test("dismisses on Escape", async ({ page }) => {
        await mockDictionaryModel(page);
        const q = connectedPage(page);
        await q.init();

        await openDictionaryOn(q, "helpful");
        await expectPopoverVisible(page);

        await q.escape();
        await expectPopoverHidden(page);
    });

    test("dismisses on backdrop click", async ({ page }) => {
        await mockDictionaryModel(page);
        const q = connectedPage(page);
        await q.init();

        await openDictionaryOn(q, "helpful");
        await expectPopoverVisible(page);

        // Click the backdrop directly to dismiss
        await page.locator(".dictionary-backdrop").click({ position: { x: 10, y: 10 } });
        await expectPopoverHidden(page);
    });

    test("synonym click opens a stacked lookup whose Replace swaps the word", async ({ page }) => {
        await mockDictionaryModel(page);
        const q = connectedPage(page);
        await q.init();

        await openDictionaryOn(q, "helpful");
        await expectPopoverVisible(page);

        // Clicking a synonym chip explores it in a stacked lookup card…
        await page.locator(".dictionary-popover button", { hasText: "useful" }).first().click();
        const stacked = page.locator(".dictionary-popover").last();
        await expect(stacked).toContainText("useful");

        // …and its Replace button swaps the word in the editor.
        await stacked.getByRole("button", { name: "Replace" }).click();
        await q.expectEditorText("useful");
    });

    test("lookup and open in chat need an AI connection", async ({ page }) => {
        const modelRequests: string[] = [];
        page.on("request", (request) => {
            if (request.url().startsWith("https://api.openai.com/")) {
                modelRequests.push(request.url());
            }
        });
        const q = new QuilliumPage(page, {
            settings: { showNestedEditor: true, atomicRevisions: true, aiEnabled: true },
        }); // no apiKey
        await q.init();

        await openDictionaryOn(q, "helpful");
        await expectPopoverVisible(page);

        await expect(page.locator(".dictionary-popover")).toContainText(
            "Connect an AI provider in AI Settings to look up words.",
        );
        const openInChatBtn = page.locator(
            ".dictionary-popover button[title='Needs an AI connection']",
        );
        await expect(openInChatBtn).toBeDisabled();
        expect(modelRequests).toEqual([]);
    });

    test("open in chat opens AI sidebar with API key", async ({ page }) => {
        await mockDictionaryModel(page);
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
        await mockDictionaryModel(page);
        const q = connectedPage(page);
        await q.init();

        await q.typeInEditor("two words");
        await q.selectAll();
        await q.page.keyboard.press("Control+d");

        // Popover should not appear for multi-word selections
        await expectPopoverHidden(page);
    });
});
