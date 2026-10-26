import { expect, test } from "@playwright/test";
import { QuilliumPage } from "./QuilliumPage";

const DRAFT =
    "Mara reached the house at dusk. She took a key from her pocket and unlocked the door with the key she had brought. A voice upstairs said her name.";
const HOSTILE_REASON =
    '<img src=x onerror="window.__reviewXss=1"> The turn gives the scene tension.';

const review = {
    summary: "The entry sentence spends words on a detail the reader already has.",
    passages: [
        {
            passage: "Mara reached the house at dusk.",
            category: "revise",
            reason: "We don't know why she came, so the arrival carries no stakes.",
        },
        {
            passage:
                "She took a key from her pocket and unlocked the door with the key she had brought.",
            category: "condense",
            reason: "The key matters, but the sentence names it twice.",
        },
        { passage: "A voice upstairs said her name.", category: "keep", reason: HOSTILE_REASON },
    ],
};

type ProviderRequest = {
    tools?: { function: { name: string } }[];
    tool_choice?: unknown;
};

test("Feedback passage review requests a typed review and leaves the draft unchanged", async ({
    page,
}) => {
    const q = new QuilliumPage(page, { apiKey: "fake-api-key", initialDoc: DRAFT });
    await q.mockDeepSeekProvider();
    await page.unroute("https://api.deepseek.com/chat/completions");
    const requests: ProviderRequest[] = [];
    await page.route("https://api.deepseek.com/chat/completions", async (route) => {
        requests.push(route.request().postDataJSON() as ProviderRequest);
        const chunk = (delta: unknown, finish_reason: string | null = null) =>
            `data: ${JSON.stringify({ id: "review-stream", object: "chat.completion.chunk", created: 1700000000, model: "deepseek-chat", choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
        const body = [
            chunk({ role: "assistant" }),
            chunk({
                tool_calls: [
                    {
                        index: 0,
                        id: "stream-review",
                        type: "function",
                        function: { name: "reviewPassages", arguments: JSON.stringify(review) },
                    },
                ],
            }),
            chunk({}, "tool_calls"),
            "data: [DONE]\n\n",
        ].join("");
        await route.fulfill({ status: 200, contentType: "text/event-stream", body });
    });
    await q.init();
    const prose = await q.cmText();

    await page.locator("#ai-tab-feedback").click();
    const panel = page.locator('[data-panel-id="feedback"]');
    await panel.getByRole("button").filter({ hasText: "Keep, condense, cut, or revise" }).click();

    const card = panel.locator('[data-passage-review="stream-review"]');
    await expect(card.getByRole("heading", { name: "Passage review" })).toBeVisible({
        timeout: 15_000,
    });
    expect(requests).toHaveLength(1);
    const toolNames = requests[0].tools?.map((tool) => tool.function.name) ?? [];
    expect(toolNames).toContain("reviewPassages");
    expect(toolNames).not.toContain("createComment");
    expect(requests[0].tool_choice).toBe("required");

    await expect(card.getByRole("list", { name: "Legend" }).getByRole("listitem")).toHaveText([
        /Keep\s*1/,
        /Condense\s*1/,
        /Revise\s*1/,
    ]);
    await expect(card.locator("[data-passage-category]")).toHaveCount(3);
    const explanation = card.getByText("Why Keep?", { exact: true });
    await expect(explanation).toHaveAccessibleName("Why Keep for passage 3?");
    await explanation.focus();
    await page.keyboard.press("Enter");
    await expect(card.getByText(HOSTILE_REASON)).toBeVisible();
    await expect(card.getByText("Core content", { exact: true })).toBeVisible();
    await expect(card.getByText("Useful idea, too many words", { exact: true })).toBeVisible();
    await expect(card.locator("img")).toHaveCount(0);
    expect(await page.evaluate(() => "__reviewXss" in window)).toBe(false);
    await expect(card).toContainText(
        "Based on the draft when requested. This review doesn't edit your draft.",
    );

    await expect(q.annotationCards).toHaveCount(0);
    await q.expectEditorText(prose);
    await card.getByRole("heading", { name: "Passage review" }).scrollIntoViewIfNeeded();
    await q.captureScreenshot("/tmp/quillium-449/passage-wide.png");

    await expect
        .poll(async () =>
            (await q.mockConversations()).some(
                (row) =>
                    row.mode === "feedback" && row.messagesJson.includes("tool-reviewPassages"),
            ),
        )
        .toBe(true);
    const saved = (await q.mockConversations()).find((row) => row.mode === "feedback")!;
    const assistant = JSON.parse(saved.messagesJson).find(
        (message: { role: string }) => message.role === "assistant",
    );
    expect(
        assistant.parts.find((part: { type: string }) => part.type === "tool-reviewPassages").input,
    ).toEqual(review);
    expect(
        assistant.parts.find((part: { type: string }) => part.type === "tool-reviewPassages")
            .output,
    ).toEqual({ status: "complete", review, scope: "draft" });
    await page.setViewportSize({ width: 360, height: 700 });
    await expect(card).toBeVisible();
    expect(await card.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    await q.captureScreenshot("/tmp/quillium-449/passage-narrow.png");
    const reopenedPage = await page.context().newPage();
    const reopened = new QuilliumPage(reopenedPage, {
        apiKey: "fake-api-key",
        initialDoc: "The writing has changed since this review.",
        settings: { aiSidebarLayout: "combined" },
        conversations: [saved],
    });
    await reopened.init();
    await reopened.openConversation(saved.title);
    const reopenedCard = reopenedPage.locator('[data-passage-review="stream-review"]');
    await expect(reopenedCard).toContainText("Based on the draft when requested");
    await expect(reopenedCard.locator("[data-passage-category]")).toHaveCount(3);
    await reopenedCard.getByText("Why Condense?", { exact: true }).click();
    await expect(reopenedCard.getByText(review.passages[1].reason)).toBeVisible();
    await reopened.expectEditorText("The writing has changed since this review.");
    reopened.expectNoPageErrors();
    await reopenedPage.close();
    q.expectNoPageErrors();
});

test("saved reviews show all four categories in an expanded discussion", async ({ page }) => {
    const passages = [
        {
            passage: "A voice upstairs said her name.",
            category: "keep",
            reason: "The voice creates a question that carries the scene forward.",
        },
        {
            passage: "She unlocked the door with the key she had brought.",
            category: "condense",
            reason: "The key matters, but unlocking the door already implies she brought it.",
        },
        {
            passage: "The key was in her pocket.",
            category: "cut",
            reason: "This repeats information the action already gives the reader.",
        },
        {
            passage: "That was when everything changed.",
            category: "revise",
            reason: "The reader needs to see what changed for her.",
        },
    ];
    const currentWriting = "The writer has moved on to a different opening.";
    const q = new QuilliumPage(page, {
        apiKey: "fixture-key",
        initialDoc: currentWriting,
        settings: { aiSidebarLayout: "combined" },
        conversations: [
            {
                id: "saved-passage-review",
                documentId: "doc-test-1",
                draftId: "draft-test-1",
                draftLabel: "Main",
                mode: "feedback",
                title: "A shorter opening",
                createdAt: 1,
                updatedAt: 1,
                archived: false,
                sourceConversationId: null,
                sourceMessageId: null,
                messagesJson: JSON.stringify([
                    {
                        id: "review-message",
                        role: "assistant",
                        parts: [
                            {
                                type: "tool-reviewPassages",
                                toolCallId: "saved-review",
                                state: "output-available",
                                input: { passages },
                                output: {
                                    status: "complete",
                                    scope: "draft",
                                    review: { passages },
                                },
                            },
                        ],
                    },
                ]),
            },
        ],
    });
    await page.setViewportSize({ width: 1440, height: 1200 });
    await q.init();
    await q.openConversation("A shorter opening");
    await q.chatPanel.getByRole("button", { name: "Expand discussion", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "A shorter opening", exact: true });
    const heightHandle = dialog.getByRole("button", { name: "Resize modal height", exact: true });
    await heightHandle.focus();
    for (let i = 0; i < 18; i++) await heightHandle.press("ArrowDown");
    const card = page.locator('[data-passage-review="saved-review"]');
    expect(
        await card
            .locator("[data-passage-category]")
            .evaluateAll((items) =>
                items.map((item) => item.getAttribute("data-passage-category")),
            ),
    ).toEqual(["keep", "condense", "cut", "revise"]);
    await expect(card.getByRole("list", { name: "Legend" }).getByRole("listitem")).toHaveText([
        /Keep\s*1\s*passage/,
        /Condense\s*1\s*passage/,
        /Cut\s*1\s*passage/,
        /Revise\s*1\s*passage/,
    ]);
    await expect(card).toContainText("This review doesn't edit your draft.");
    const reason = card.getByText("Why Condense?", { exact: true });
    await expect(reason).toHaveAccessibleName("Why Condense for passage 2?");
    await reason.focus();
    await page.keyboard.press("Enter");
    await expect(card.getByText(passages[1].reason)).toBeVisible();
    await card.getByRole("heading").scrollIntoViewIfNeeded();
    await card.screenshot({ path: "/tmp/quillium-449/passage-review-full.png" });
    await q.expectEditorText(currentWriting);
    await expect(q.annotationCards).toHaveCount(0);
    q.expectNoPageErrors();
});
