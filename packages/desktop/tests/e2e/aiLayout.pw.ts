import { expect, test } from "@playwright/test";
import { QuilliumPage } from "./QuilliumPage";

test("separate panels are the default; unified Chat requires a saved opt-in and can be reversed", async ({
    page,
}) => {
    const q = new QuilliumPage(page, {
        apiKey: "fixture-key",
        initialDoc: "A quiet opening to the story.",
        preserveSettingsOnReload: true,
    });
    await q.mockDeepSeekProvider("A useful observation about your opening.");
    await q.init();
    await expect(page.locator("#ai-tab-feedback")).toBeVisible();
    await expect(page.locator("#ai-tab-revise")).toBeVisible();

    // The original panels and their learned keyboard shortcuts still work.
    await page.keyboard.press("Control+Shift+2");
    const feedback = page.locator('[data-panel-id="feedback"]');
    await expect(feedback).toBeVisible();
    await feedback.locator('input[name="message"]').fill("How does the opening land?");
    await feedback.getByRole("button", { name: "Send", exact: true }).click();
    await expect(feedback).toContainText("A useful observation about your opening.");
    await expect
        .poll(
            async () =>
                (await q.mockConversations()).filter((item) => item.mode === "feedback").length,
        )
        .toBe(1);
    const feedbackId = (await q.mockConversations()).find((item) => item.mode === "feedback")!.id;
    await page.keyboard.press("Control+Shift+3");
    await expect(page.locator('[data-panel-id="revise"]')).toBeVisible();

    let modal = await q.openSettings();
    await modal.getByRole("button", { name: "Advanced", exact: true }).click();
    await modal.getByRole("button", { name: "One assistant", exact: true }).click();
    await modal.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.locator('[data-panel-id="feedback"]')).toHaveCount(1);

    modal = await q.openSettings();
    await modal.getByRole("button", { name: "Advanced", exact: true }).click();
    await modal.getByRole("button", { name: "One assistant", exact: true }).click();
    await modal.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator('[data-panel-id="feedback"]')).toHaveCount(0);
    await q.openChat();
    await expect(q.chatPanel.getByRole("button", { name: /^Tools ·/ })).toBeVisible();
    await expect(q.chatPanel).toContainText("A useful observation about your opening.");
    expect((await q.mockConversations()).find((item) => item.id === feedbackId)?.mode).toBe(
        "feedback",
    );
    await page.reload();
    await q.openChat();
    await expect(q.chatInput).toBeVisible();
    await expect(page.locator('[data-panel-id="feedback"]')).toHaveCount(0);

    modal = await q.openSettings();
    await modal.getByRole("button", { name: "Advanced", exact: true }).click();
    await modal.getByRole("button", { name: "Separate panels", exact: true }).click();
    await modal.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator('[data-panel-id="feedback"]')).toHaveCount(1);
    await page.keyboard.press("Control+Shift+2");
    await expect(feedback).toBeVisible();
    await expect(feedback).toContainText("A useful observation about your opening.");
    expect((await q.mockConversations()).find((item) => item.id === feedbackId)?.mode).toBe(
        "feedback",
    );
    await page.screenshot({ path: "/tmp/quillium-separate-panels.png" });
    q.expectNoPageErrors();
});

test("separate panels retain their composers in a small window", async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 464 });
    const q = new QuilliumPage(page, {
        apiKey: "fixture-key",
        initialDoc: "A longer draft. ".repeat(60),
    });
    await q.init();
    for (const [mode, key] of [
        ["chat", "1"],
        ["feedback", "2"],
        ["revise", "3"],
    ]) {
        await page.keyboard.press(`Control+Shift+${key}`);
        const input = page.locator(`[data-panel-id="${mode}"] input[name="message"]`);
        await expect(input).toBeVisible();
        const box = await input.boundingBox();
        expect(box!.y).toBeGreaterThanOrEqual(0);
        expect(box!.y + box!.height).toBeLessThanOrEqual(464);
    }
    await page.screenshot({ path: "/tmp/quillium-separate-small.png" });
    q.expectNoPageErrors();
});

test("separate Feedback saves reader reviews in its discussion history", async ({ page }) => {
    await page.addInitScript(() => {
        localStorage.setItem(
            "quillium-ai-persona-modes",
            JSON.stringify({ feedback: true, revise: false }),
        );
    });
    const q = new QuilliumPage(page, {
        apiKey: "fixture-key",
        initialDoc: "A quiet opening to the story.",
    });
    await q.mockDeepSeekProvider("No further notes.");
    await q.init();
    await page.keyboard.press("Control+Shift+2");
    const feedback = page.locator('[data-panel-id="feedback"]');
    await feedback.locator('input[name="message"]').fill("Review the opening with my readers.");
    await feedback.getByRole("button", { name: "Send", exact: true }).click();
    await expect(feedback).toContainText("Reader review ended.");
    await expect
        .poll(async () =>
            (await q.mockConversations()).some(
                (item) =>
                    item.mode === "feedback" &&
                    item.messagesJson.includes('"applicationMessage":true') &&
                    item.messagesJson.includes("Review the opening with my readers."),
            ),
        )
        .toBe(true);
    q.expectNoPageErrors();
});

test("replaying a unified action in separate Chat points to the layout setting", async ({
    page,
}) => {
    const q = new QuilliumPage(page, {
        apiKey: "fixture-key",
        initialDoc: "A quiet opening to the story.",
        conversations: [
            {
                id: "combined-review",
                documentId: "doc-test-1",
                draftId: "draft-test-1",
                draftLabel: "Main",
                mode: "chat",
                title: "Opening feedback",
                createdAt: 1,
                updatedAt: 1,
                archived: false,
                messagesJson: JSON.stringify([
                    {
                        id: "u1",
                        role: "user",
                        parts: [{ type: "text", text: "Review the opening" }],
                        metadata: { editorialTurn: { task: "global-review" } },
                    },
                    {
                        id: "a1",
                        role: "assistant",
                        parts: [{ type: "text", text: "The opening sets the tone." }],
                    },
                ]),
                sourceConversationId: null,
                sourceMessageId: null,
            },
        ],
    });
    const requests: string[] = [];
    page.on("request", (request) => {
        if (request.url().startsWith("https://api.openai.com/")) requests.push(request.url());
    });
    await q.init();
    await q.openChat();
    await q.chatPanel.getByRole("button", { name: "Retry as new path", exact: true }).click();
    await expect(q.chatPanel).toContainText("choose One assistant in Settings");
    expect(await q.mockConversations()).toHaveLength(1);
    expect(requests).toEqual([]);
    q.expectNoPageErrors();
});

test("opt-in assistant has independent persistent tools, response preferences, and a direct Readers toggle", async ({
    page,
}) => {
    await page.setViewportSize({ width: 1000, height: 600 });
    const q = new QuilliumPage(page, {
        apiKey: "fixture-key",
        settings: { aiSidebarLayout: "combined" },
        initialDoc: "Morning light pooled on the tiles. Mara left the letter unopened.",
    });
    const requests: Array<{
        tools?: Array<{ function: { name: string } }>;
        messages: Array<{ role: string; content: string }>;
    }> = [];
    page.on("request", (request) => {
        if (request.url().includes("api.deepseek.com")) requests.push(request.postDataJSON());
    });
    await q.mockDeepSeekProvider("A useful response.");
    await q.init();
    await q.openChat();
    await expect(q.chatPanel.getByRole("group", { name: "Writing task" })).toHaveCount(0);
    await expect(q.chatPanel.getByRole("checkbox")).toHaveCount(0);
    const toolsButton = q.chatPanel.getByRole("button", { name: /^Tools ·/ });
    await toolsButton.click();
    const tools = page.getByRole("dialog", { name: "Available tools", exact: true });
    await tools.getByRole("checkbox", { name: /Add comments/ }).uncheck();
    await tools.getByRole("checkbox", { name: /Create revision versions/ }).uncheck();
    await page.keyboard.press("Escape");
    await expect(toolsButton).toBeFocused();
    await expect(toolsButton).toContainText("Tools · 1");
    const prefs = q.chatPanel.getByTitle("Response preferences", { exact: true });
    await prefs.click();
    const popup = page.getByRole("dialog", { name: "Response preferences", exact: true });
    await popup.getByLabel("Response length", { exact: true }).selectOption("detailed");
    for (const name of [
        "Response length",
        "Editorial stance",
        "Feedback amount",
        "Voice latitude",
    ]) {
        await popup
            .getByRole("button", { name: `About ${name.toLowerCase()}`, exact: true })
            .click();
        const guide = page.getByRole("dialog", { name: "Response preferences guide", exact: true });
        await expect(guide).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(guide).toHaveCount(0);
        await expect(popup).toBeVisible();
    }
    await page.keyboard.press("Escape");
    const readers = q.chatPanel.getByRole("button", { name: "Readers", exact: true });
    await readers.click();
    await expect(readers).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("dialog", { name: "Reader personas" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /About readers/i })).toHaveCount(0);
    await readers.click();
    await expect(readers).toHaveAttribute("aria-pressed", "false");
    await q.chatInput.fill("Tighten the opening.");
    await q.chatInput.press("Enter");
    await expect(q.conversationMessage("A useful response.")).toBeVisible();
    expect(
        requests[0].tools
            ?.filter((tool) => tool.function.name.startsWith("create"))
            .map((tool) => tool.function.name),
    ).toEqual(["createSuggestion"]);
    expect(requests[0].messages.find((message) => message.role === "system")?.content).toContain(
        "Response length: detailed",
    );
    await expect(toolsButton).toContainText("Tools · 1");
    await q.aiSidebar.screenshot({
        path: "/tmp/quillium-one-assistant.png",
        animations: "disabled",
    });
    await page.reload();
    await q.openChat();
    await expect(toolsButton).toContainText("Tools · 1");
    await expect(prefs).toContainText("Detailed");
    await q.chatPanel.getByRole("button", { name: "Expand discussion" }).click();
    const expanded = page.getByRole("dialog", { name: /Tighten the opening/ });
    await expanded.getByRole("button", { name: /^Tools ·/ }).click();
    await expect(tools.getByRole("checkbox", { name: /Suggest edits/ })).toBeChecked();
    await page.keyboard.press("Escape");
    await expect(expanded).toBeVisible();
    await expanded.getByTitle("Response preferences", { exact: true }).click();
    await popup.getByRole("button", { name: "About editorial stance", exact: true }).click();
    await expect(
        page.getByRole("dialog", { name: "Response preferences guide", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(expanded).toBeVisible();
    await page.keyboard.press("Escape");
    await expanded.getByRole("button", { name: "Close discussion" }).click();
    await q.chatPanel.getByRole("button", { name: "New discussion", exact: true }).click();
    await expect(toolsButton).toContainText("Tools · 3");
    await page.setViewportSize({ width: 320, height: 600 });
    await expect(q.chatPanel.getByRole("button", { name: "Send", exact: true })).toBeVisible();
    const composer = q.chatPanel.locator("[data-chat-composer]");
    expect(await composer.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    await q.aiSidebar.screenshot({
        path: "/tmp/quillium-one-assistant-narrow.png",
        animations: "disabled",
    });
    q.expectNoPageErrors();
});

for (const commentsAllowed of [true, false]) {
    test(`assistant ${commentsAllowed ? "applies and undoes" : "rejects"} a comment according to selected tools`, async ({
        page,
    }) => {
        const q = new QuilliumPage(page, {
            apiKey: "fixture-key",
            settings: { aiSidebarLayout: "combined" },
            initialDoc: "The morning was beautiful.",
        });
        await q.mockDeepSeekProvider();
        await page.unroute("https://api.deepseek.com/chat/completions");
        await page.route("https://api.deepseek.com/chat/completions", async (route) => {
            const chunk = (delta: unknown, finish_reason: string | null = null) =>
                `data: ${JSON.stringify({ id: "assistant-tool", object: "chat.completion.chunk", created: 1700000000, model: "deepseek-chat", choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
            const body =
                chunk({ role: "assistant" }) +
                chunk({
                    tool_calls: [
                        {
                            index: 0,
                            id: "assistant-comment",
                            type: "function",
                            function: {
                                name: "createComment",
                                arguments: JSON.stringify({
                                    targetText: "The morning was beautiful.",
                                    comment: "Try a specific sensory image.",
                                }),
                            },
                        },
                    ],
                }) +
                chunk({}, "tool_calls") +
                "data: [DONE]\n\n";
            await route.fulfill({ status: 200, contentType: "text/event-stream", body });
        });
        await q.init();
        await q.openChat();
        if (!commentsAllowed) {
            await q.chatPanel.getByRole("button", { name: /^Tools ·/ }).click();
            await page
                .getByRole("dialog", { name: "Available tools" })
                .getByRole("checkbox", { name: /Add comments/ })
                .uncheck();
            await page.keyboard.press("Escape");
        }
        await q.chatInput.fill("Add an observation about the opening.");
        await q.chatInput.press("Enter");
        const activity = q.chatPanel.locator('[data-tool-call="assistant-comment"]');
        await expect(activity).toContainText(
            commentsAllowed ? "Comment added" : "Couldn't add comment",
        );
        const annotation = q.annotationCards.filter({ hasText: "Try a specific sensory image." });
        if (commentsAllowed) {
            await expect(annotation).toBeVisible();
            await q.editor.click();
            await q.undo();
            await expect(annotation).toHaveCount(0);
            await page.keyboard.press("ControlOrMeta+Shift+z");
            await expect(annotation).toBeVisible();
        } else await expect(annotation).toHaveCount(0);
        q.expectNoPageErrors();
    });
}

test("Readers adds independent requests with the same tools and sends the prompt once to each", async ({
    page,
}) => {
    const q = new QuilliumPage(page, {
        apiKey: "fixture-key",
        settings: { aiSidebarLayout: "combined" },
        initialDoc: "The morning was beautiful.",
    });
    await q.mockDeepSeekProvider("An observation.");
    const requests: Array<{
        tools?: Array<{ function: { name: string } }>;
        messages: Array<{ role: string; content: string }>;
    }> = [];
    page.on("request", (request) => {
        if (request.url().includes("api.deepseek.com")) requests.push(request.postDataJSON());
    });
    await q.init();
    await q.openChat();
    await q.chatPanel.getByRole("button", { name: /^Tools ·/ }).click();
    const tools = page.getByRole("dialog", { name: "Available tools" });
    await tools.getByRole("checkbox", { name: /Suggest edits/ }).uncheck();
    await tools.getByRole("checkbox", { name: /Create revision versions/ }).uncheck();
    await page.keyboard.press("Escape");
    await q.chatPanel.getByRole("button", { name: "Readers", exact: true }).click();
    await q.chatInput.fill("Review with my readers.");
    await q.chatInput.press("Enter");
    await expect(q.chatPanel.getByRole("button", { name: "Stop response" })).toHaveCount(0);
    await expect.poll(() => requests.length).toBe(5);
    for (const request of requests) {
        expect(
            request.tools
                ?.filter((tool) => tool.function.name.startsWith("create"))
                .map((tool) => tool.function.name),
        ).toEqual(["createComment"]);
        expect(
            request.messages.filter(
                (message) =>
                    message.role === "user" && message.content === "Review with my readers.",
            ),
        ).toHaveLength(1);
    }
    await expect(q.conversationMessage("An observation.")).toBeVisible();
    await expect(q.chatPanel.getByRole("button", { name: "Readers", exact: true })).toHaveAttribute(
        "aria-pressed",
        "true",
    );
    q.expectNoPageErrors();
});
