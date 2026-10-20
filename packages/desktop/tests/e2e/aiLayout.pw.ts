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
    await modal.getByRole("button", { name: "One conversation", exact: true }).click();
    await modal.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.locator('[data-panel-id="feedback"]')).toHaveCount(1);

    modal = await q.openSettings();
    await modal.getByRole("button", { name: "Advanced", exact: true }).click();
    await modal.getByRole("button", { name: "One conversation", exact: true }).click();
    await modal.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator('[data-panel-id="feedback"]')).toHaveCount(0);
    await q.openChat();
    await expect(
        q.chatPanel.getByRole("button", { name: "Feedback", exact: true }),
    ).toBeVisible();
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
    await expect(q.chatPanel).toContainText("choose One conversation in Settings");
    expect(await q.mockConversations()).toHaveLength(1);
    expect(requests).toEqual([]);
    q.expectNoPageErrors();
});

test("opt-in Chat keeps actions visible, sends the chosen task, and fits a small window", async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 600 });
    const q = new QuilliumPage(page, {
        apiKey: "fixture-key",
        settings: { aiSidebarLayout: "combined" },
        initialDoc: "Morning light pooled on the tiles. Mara left the letter unopened.",
    });
    const requests: string[] = [];
    page.on("request", request => {
        if (request.url().includes("api.deepseek.com")) requests.push(request.postData() ?? "");
    });
    await q.mockDeepSeekProvider("A useful response.");
    await q.init();
    await q.openChat();
    const discuss = q.chatPanel.getByRole("button", { name: "Discuss", exact: true });
    const feedback = q.chatPanel.getByRole("button", { name: "Feedback", exact: true });
    const send = q.chatPanel.getByRole("button", { name: "Send", exact: true });
    await expect(discuss).toHaveAttribute("aria-pressed", "true");
    await expect(send).toBeDisabled();
    await feedback.click();
    expect(requests).toHaveLength(0);
    await expect(feedback).toHaveAttribute("aria-pressed", "true");
    await expect(q.chatInput).toHaveAttribute("placeholder", "What would you like feedback on?");
    await expect(send).toBeEnabled();
    await send.click();
    await expect(q.chatPanel).toContainText("A useful response.");
    await expect(q.chatPanel.locator("[data-turn-task]")).toHaveText("Feedback");
    await expect(discuss).toHaveAttribute("aria-pressed", "true");
    expect(requests).toHaveLength(1);
    expect(requests[0]).toContain("Give feedback on this draft");
    await q.chatInput.fill("Why that choice?");
    await q.chatInput.press("Enter");
    await expect.poll(() => requests.length).toBe(2);
    await expect(send).toBeDisabled();

    const chip = q.chatPanel.getByRole("button", { name: "Whole draft", exact: true });
    await chip.click();
    await expect(page.getByRole("dialog", { name: "Sent with your next message" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(chip).toBeFocused();
    await expect(q.chatPanel).toBeVisible();
    const readers = q.chatPanel.getByRole("button", { name: "Readers", exact: true });
    await readers.click();
    const readerPopover = page.getByRole("dialog", { name: "Reader personas" });
    await readerPopover.getByRole("checkbox", { name: /Ask enabled readers too/ }).check();
    await page.keyboard.press("Escape");
    await expect(q.chatPanel.getByRole("button", { name: "Readers on", exact: true })).toBeVisible();
    await q.chatInput.fill("A longer question.\n".repeat(12));
    const composer = q.chatPanel.locator("[data-chat-composer]");
    const box = (await composer.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(600);
    expect((await q.chatInput.boundingBox())!.height).toBeLessThanOrEqual(160);
    await q.chatInput.fill("");
    expect((await q.chatInput.boundingBox())!.height).toBeLessThanOrEqual(48);
    await page.setViewportSize({ width: 1440, height: 900 });
    await q.aiSidebar.screenshot({ path: "/tmp/quillium-visible-actions.png", animations: "disabled" });
    await page.setViewportSize({ width: 1000, height: 600 });

    await q.chatPanel.getByRole("button", { name: "Expand discussion" }).click();
    const expanded = page.getByRole("dialog", { name: /Give feedback/ });
    await expanded.getByRole("button", { name: "Whole draft", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Sent with your next message" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(expanded).toBeVisible();
    await expanded.getByRole("button", { name: "Close discussion" }).click();
    await feedback.click();
    await q.chatInput.fill("Review this with my readers.");
    await send.click();
    await expect(q.chatPanel).toContainText("Reader review ended.");
    await expect(discuss).toHaveAttribute("aria-pressed", "true");
    await q.chatPanel.getByRole("button", { name: "New discussion", exact: true }).click();
    await feedback.click();
    await q.chatPanel.getByRole("button", { name: "New discussion", exact: true }).click();
    await expect(discuss).toHaveAttribute("aria-pressed", "true");
    await page.setViewportSize({ width: 280, height: 600 });
    const buttons = q.chatPanel.getByRole("group", { name: "Writing task" }).getByRole("button");
    for (const button of await buttons.all()) {
        await expect(button).toBeVisible();
        expect(await button.locator("span").last().evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    }
    await expect(send).toBeVisible();
    await q.aiSidebar.screenshot({ path: "/tmp/quillium-visible-actions-narrow.png", animations: "disabled" });
    q.expectNoPageErrors();
});
