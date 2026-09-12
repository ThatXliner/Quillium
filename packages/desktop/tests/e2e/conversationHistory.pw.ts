import { type Page, expect, test } from "@playwright/test";
import { type MockConversation, QuilliumPage } from "./QuilliumPage";

const documentId = "doc-test-1";
const draftId = "draft-test-1";
const fixtureDate = Date.UTC(2026, 8, 7);

function messageSet(prefix: "a" | "b") {
    const texts =
        prefix === "a"
            ? [
                  "How does the opening land?",
                  "It creates momentum, but the image is familiar.",
                  "What about the stakes?",
                  "The stakes need a sharper turn before the midpoint.",
              ]
            : [
                  "Could the amber light return in the ending?",
                  "The amber detail gives the scene a useful anchor.",
                  "Should the ending echo it?",
                  "A quiet echo would make the ending feel earned.",
              ];
    return texts.map((text, index) => ({
        id: `${prefix === "a" ? "" : "b-"}${index % 2 === 0 ? "user" : "assistant"}-${
            Math.floor(index / 2) + 1
        }`,
        role: index % 2 === 0 ? "user" : "assistant",
        parts: [{ type: "text", text }],
        // Keep the metadata shape used by older saved messages in the
        // fixture. Loading history must tolerate it while preserving IDs.
        metadata: {
            writingContext: {
                draftId,
                capturedAt: 1_700_000_000_000 + index,
                provider: "openai",
                model: "gpt-test",
            },
            legacyTurn: true,
        },
    }));
}

const messagesA = messageSet("a");
const messagesB = messageSet("b");

const conversationFixtures: MockConversation[] = [
    {
        id: "conversation-a",
        documentId,
        draftId,
        draftLabel: "Main",
        mode: "chat",
        title: "Opening scene",
        createdAt: fixtureDate,
        updatedAt: fixtureDate + 1_000,
        archived: false,
        messagesJson: JSON.stringify(messagesA),
        sourceConversationId: null,
        sourceMessageId: null,
    },
    {
        id: "conversation-b",
        documentId,
        draftId,
        draftLabel: "Main",
        mode: "chat",
        title: "Ending image",
        createdAt: fixtureDate + 2_000,
        updatedAt: fixtureDate + 3_000,
        archived: false,
        messagesJson: JSON.stringify(messagesB),
        sourceConversationId: null,
        sourceMessageId: null,
    },
];

function newPageObject(page: Page): QuilliumPage {
    return new QuilliumPage(page, {
        apiKey: "fake-api-key",
        initialDoc:
            "Morning light pooled on the kitchen tiles. Mara left her father's letter unopened beside the kettle.",
        conversations: conversationFixtures,
    });
}

test.describe("conversation history", () => {
    test("browses and reopens rows across reload, searches messages, and isolates lifecycle actions", async ({
        page,
    }) => {
        const q = newPageObject(page);
        await q.init();
        await q.openConversationHistory();

        await expect(q.conversationRows).toHaveCount(2);
        await expect(q.conversationRow("Opening scene")).toBeVisible();
        await expect(q.conversationRow("Ending image")).toBeVisible();

        await q.openConversation("Ending image");
        await expect(
            q.conversationMessage("Could the amber light return in the ending?"),
        ).toBeVisible();

        await page.reload();
        await expect(q.editor).toBeVisible({ timeout: 20_000 });
        await q.openConversationHistory();
        await expect(q.conversationRows).toHaveCount(2);

        await q.openConversation("Opening scene");
        await expect(q.conversationMessage("How does the opening land?")).toBeVisible();
        await q.openConversationHistory();
        await q.openConversation("Ending image");
        await expect(
            q.conversationMessage("Could the amber light return in the ending?"),
        ).toBeVisible();

        await q.searchConversations("amber");
        await expect(q.conversationRows).toHaveCount(1);
        await expect(q.conversationRow("Ending image")).toBeVisible();
        await q.searchConversations("");

        const firstRow = q.conversationRow("Opening scene");
        await firstRow.getByRole("button", { name: "Rename", exact: true }).click();
        const title = firstRow.getByRole("textbox", { name: "Conversation title" });
        await title.fill("Renamed opening discussion");
        await firstRow.getByRole("button", { name: "Save", exact: true }).click();
        await expect(q.conversationRow("Renamed opening discussion")).toBeVisible();

        const renamedRow = q.conversationRow("Renamed opening discussion");
        await renamedRow.getByRole("button", { name: "Archive", exact: true }).click();
        await expect(q.conversationRows).toHaveCount(1);
        await expect(q.conversationRow("Ending image")).toBeVisible();

        await q.showArchivedConversations();
        await expect(q.conversationRow("Renamed opening discussion")).toBeVisible();
        await q
            .conversationRow("Renamed opening discussion")
            .getByRole("button", { name: "Restore", exact: true })
            .click();
        await expect(q.conversationRow("Renamed opening discussion")).toBeHidden();

        await q.chatPanel.getByRole("checkbox", { name: "Archived conversations" }).uncheck();
        await expect(q.conversationRows).toHaveCount(2);

        const restoredRow = q.conversationRow("Renamed opening discussion");
        await restoredRow.getByRole("button", { name: "Delete", exact: true }).click();
        await restoredRow.getByRole("button", { name: "Delete permanently", exact: true }).click();
        await expect(q.conversationRow("Renamed opening discussion")).toBeHidden();
        await expect(q.conversationRow("Ending image")).toBeVisible();

        const remaining = await q.mockConversations();
        expect(remaining.map((conversation) => conversation.id)).toEqual(["conversation-b"]);
    });

    test("starts a new chat while preserving the existing conversations", async ({ page }) => {
        const q = newPageObject(page);
        await q.init();
        await q.openConversationHistory();

        await expect(q.conversationRows).toHaveCount(2);
        await q.chatPanel.getByRole("button", { name: "Close history", exact: true }).click();
        await q.chatPanel.getByRole("button", { name: "New", exact: true }).click();
        await q.openConversationHistory();
        await expect(q.conversationRows).toHaveCount(3);
        await expect(q.conversationRow("Opening scene")).toBeVisible();
        await expect(q.conversationRow("Ending image")).toBeVisible();

        const rows = await q.mockConversations();
        expect(rows.map((conversation) => conversation.id)).toEqual(
            expect.arrayContaining(["conversation-a", "conversation-b"]),
        );
    });
});

const branchCases = [
    {
        label: "a middle user message",
        messageId: "user-2",
        prefixIds: ["user-1", "assistant-1", "user-2"],
        prefixText: [
            "How does the opening land?",
            "It creates momentum, but the image is familiar.",
            "What about the stakes?",
        ],
        omittedText: "The stakes need a sharper turn before the midpoint.",
    },
    {
        label: "a middle assistant message",
        messageId: "assistant-1",
        prefixIds: ["user-1", "assistant-1"],
        prefixText: [
            "How does the opening land?",
            "It creates momentum, but the image is familiar.",
        ],
        omittedText: "What about the stakes?",
    },
] as const;

for (const branchCase of branchCases) {
    test(`branches from ${branchCase.label} with an independent origin`, async ({ page }) => {
        const q = newPageObject(page);
        await q.init();
        await q.openConversationHistory();
        await q.openConversation("Opening scene");
        await expect(q.conversationMessageActions(branchCase.messageId)).toBeVisible();

        const proseBefore = await q.cmText();
        await q
            .conversationMessageActions(branchCase.messageId)
            .getByRole("button", { name: "Branch here", exact: true })
            .click();

        await expect(
            q.chatPanel.getByRole("button", { name: "Open origin conversation", exact: true }),
        ).toBeVisible({ timeout: 10_000 });
        expect(await q.mockConversations()).toHaveLength(3);
        for (const messageId of branchCase.prefixIds) {
            await expect(q.conversationMessageActions(messageId)).toBeVisible();
        }
        for (const text of branchCase.prefixText) {
            await expect(q.conversationMessage(text)).toBeVisible();
        }
        await expect(q.conversationMessage(branchCase.omittedText)).toBeHidden();
        await q.expectEditorText(proseBefore);

        await q.chatPanel
            .getByRole("button", { name: "Open origin conversation", exact: true })
            .click();
        await expect(q.conversationMessageActions("assistant-2")).toBeVisible();
        await expect(
            q.conversationMessage("The stakes need a sharper turn before the midpoint."),
        ).toBeVisible();
        await q.expectEditorText(proseBefore);
    });
}

test("keeps discussions in the sidebar and opens a focused modal", async ({ page }) => {
    const q = newPageObject(page);
    await q.init();
    await q.openChat();
    const recent = page.getByRole("list", { name: "Recent conversations" });
    await expect(
        recent.getByRole("button", { name: "Opening scene", exact: true }),
    ).toBeVisible();
    await expect(recent.getByRole("button", { name: "Manage Opening scene" })).toBeVisible();
    await q.chatPanel.getByRole("button", { name: "Toggle discussions" }).click();
    await expect(recent).toBeHidden();
    await q.chatPanel.getByRole("button", { name: "Toggle discussions" }).click();
    await expect(recent).toBeVisible();
    await expect
        .poll(async () => Math.round((await q.aiSidebar.boundingBox())?.width ?? 0))
        .toBe(320);
    await q.captureScreenshot("/tmp/quillium-discussions-sidebar.png");
    await recent.getByRole("button", { name: "Opening scene", exact: true }).click();
    const modal = page.locator("dialog.discussion-modal");
    await expect(modal).toBeVisible();
    await expect(q.chatInput).toBeEnabled();
    const box = await modal.boundingBox();
    expect(box?.width).toBeGreaterThan(700);
    expect(box?.x).toBeGreaterThan(200);
    expect(box?.y).toBeGreaterThan(20);
    await q.captureScreenshot("/tmp/quillium-discussion-modal.png");
    await page.keyboard.press("Escape");
    await expect(modal).toHaveCount(0);
    await expect(q.chatPanel).toBeVisible();
    await expect(recent).toBeVisible();
});

test("edits a user message into a provider-backed new path", async ({ page }) => {
    const q = newPageObject(page);
    await q.mockDeepSeekProvider();
    await q.init();
    await q.openConversationHistory();
    await q.openConversation("Opening scene");

    const proseBefore = await q.cmText();
    await q
        .conversationMessageActions("user-2")
        .getByRole("button", { name: "Edit as new path", exact: true })
        .click();
    const editInput = q.chatPanel.getByRole("textbox", { name: "Edited prompt" });
    await expect(editInput).toBeVisible();
    await editInput.fill("What changes after the midpoint?");
    await q.chatPanel.getByRole("button", { name: "Send as new path", exact: true }).click();

    await expect(q.conversationMessage("Alternative answer")).toBeVisible({ timeout: 15_000 });
    expect((await q.mockConversations()).map((row) => row.title)).toContain("Opening scene (edit)");
    await expect(q.conversationMessage("What changes after the midpoint?")).toBeVisible();
    await expect(
        q.conversationMessage("The stakes need a sharper turn before the midpoint."),
    ).toBeHidden();
    await q.expectEditorText(proseBefore);

    await q.openConversation("Opening scene");
    await expect(
        q.conversationMessage("The stakes need a sharper turn before the midpoint."),
    ).toBeVisible();
    await expect(q.conversationMessage("Alternative answer")).toBeHidden();
    await expect(q.conversationMessage("What changes after the midpoint?")).toBeHidden();
    await q.expectEditorText(proseBefore);
});

test("retries an assistant message into a provider-backed new path", async ({ page }) => {
    const q = newPageObject(page);
    await q.mockDeepSeekProvider();
    await q.init();
    await q.openConversationHistory();
    await q.openConversation("Opening scene");

    const proseBefore = await q.cmText();
    await q
        .conversationMessageActions("assistant-1")
        .getByRole("button", { name: "Retry as new path", exact: true })
        .click();

    await expect(q.conversationMessage("Alternative answer")).toBeVisible({ timeout: 15_000 });
    expect((await q.mockConversations()).map((row) => row.title)).toContain(
        "Opening scene (retry)",
    );
    await expect(q.conversationMessage("How does the opening land?")).toBeVisible();
    await expect(
        q.conversationMessage("The stakes need a sharper turn before the midpoint."),
    ).toBeHidden();
    await q.expectEditorText(proseBefore);

    await q.openConversation("Opening scene");
    await expect(
        q.conversationMessage("It creates momentum, but the image is familiar."),
    ).toBeVisible();
    await expect(q.conversationMessage("Alternative answer")).toBeHidden();
    await q.expectEditorText(proseBefore);
});

test("shows recorded tool activity with expandable inputs and results without replaying it", async ({
    page,
}) => {
    const messages = [
        {
            id: "tool-user",
            role: "user",
            parts: [{ type: "text", text: "Help me sharpen the opening." }],
        },
        {
            id: "tool-assistant",
            role: "assistant",
            parts: [
                { type: "text", text: "I found a place to make the opening more specific." },
                {
                    type: "tool-createSuggestion",
                    toolCallId: "suggestion-1",
                    state: "output-available",
                    input: {
                        targetText: "The morning was beautiful.",
                        suggestion: "Morning light pooled on the kitchen tiles.",
                    },
                    output: {
                        targetText: "The morning was beautiful.",
                        suggestion: "Morning light pooled on the kitchen tiles.",
                    },
                },
                {
                    type: "dynamic-tool",
                    toolName: "referenceLookup",
                    toolCallId: "lookup-1",
                    state: "output-error",
                    input: { query: "opening image" },
                    errorText: "Reference unavailable",
                },
                {
                    type: "tool-createComment",
                    toolCallId: "comment-1",
                    state: "input-available",
                    input: { targetText: "opening", comment: "Try a concrete image." },
                },
            ],
        },
    ];
    const q = new QuilliumPage(page, {
        apiKey: "fake-api-key",
        initialDoc: "The morning was beautiful.",
        conversations: [
            {
                ...conversationFixtures[0],
                title: "Sharpening the opening",
                messagesJson: JSON.stringify(messages),
            },
        ],
    });
    await q.init();
    const prose = await q.cmText();
    await q.openConversation("Sharpening the opening");
    const tool = page.locator('[data-tool-call="suggestion-1"]');
    await expect(tool.getByText("Suggestion requested", { exact: true })).toBeVisible();
    await expect(tool.locator("pre").first()).toBeHidden();
    await expect(page.locator('[data-tool-call="lookup-1"]')).toContainText(
        "Couldn't complete assistant action",
    );
    await expect(page.locator('[data-tool-call="comment-1"]')).toContainText("Comment interrupted");

    await tool.locator("summary").click();
    await expect(tool.locator("pre")).toHaveCount(0);
    await page.keyboard.down("Meta");
    await tool.locator("summary").click();
    await expect(tool.locator("pre").first()).toContainText("Morning light pooled");

    await page.keyboard.up("Meta");
    await expect(tool.locator("pre")).toHaveCount(0);
    await page.keyboard.down("Meta");
    await tool.locator("summary").click();
    await expect(tool.locator("pre").first()).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await expect(tool.locator("pre")).toHaveCount(0);
    await page.keyboard.up("Meta");
    await q.expectEditorText(prose);
    await page.reload();
    await expect(q.editor).toBeVisible({ timeout: 20_000 });
    await q.openConversation("Sharpening the opening");
    await expect(page.locator('[data-tool-call="suggestion-1"]')).toBeVisible();
    await q.expectEditorText(prose);
});

for (const outcome of ["applied", "skipped"] as const) {
    test(`renders and persists a streamed feedback tool result: ${outcome}`, async ({ page }) => {
        const q = new QuilliumPage(page, {
            apiKey: "fake-api-key",
            initialDoc: "The morning was beautiful.",
        });
        await q.mockDeepSeekProvider();
        await page.unroute("https://api.deepseek.com/chat/completions");
        let requests = 0;
        await page.route("https://api.deepseek.com/chat/completions", async (route) => {
            requests += 1;
            const chunk = (delta: unknown, finish_reason: string | null = null) =>
                `data: ${JSON.stringify({ id: "tool-stream", object: "chat.completion.chunk", created: 1700000000, model: "deepseek-chat", choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
            const body =
                chunk({ role: "assistant" }) +
                chunk({
                    content: "A concrete image would help readers picture the opening scene.",
                }) +
                chunk({
                    tool_calls: [
                        {
                            index: 0,
                            id: "stream-comment",
                            type: "function",
                            function: {
                                name: "createComment",
                                arguments: JSON.stringify({
                                    targetText:
                                        outcome === "applied" && requests === 1
                                            ? "The morning was beautiful."
                                            : "This passage is not in the draft.",
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
        await page.locator("#ai-tab-feedback").click();
        const panel = page.locator('[data-panel-id="feedback"]');
        const input = panel.locator('input[name="message"]');
        await input.fill("Help me make the opening more specific.");
        await input.press("Enter");
        const tool = panel.locator('[data-tool-call="stream-comment"]');
        const expectedLabel = outcome === "applied" ? "Comment added" : "Couldn't add comment";
        await expect(tool).toContainText(expectedLabel, { timeout: 15000 });
        const annotation = q.annotationCards.filter({ hasText: "Try a specific sensory image." });
        if (outcome === "applied") await expect(annotation).toBeVisible();
        else await expect(annotation).toHaveCount(0);
        await tool.locator("summary").click();
        await expect(tool.locator("pre")).toHaveCount(0);
        await page.keyboard.down("Meta");
        await tool.locator("summary").click();
        await expect(tool).toContainText("Try a specific sensory image.");
        await page.keyboard.up("Meta");
        await expect(tool.locator("pre")).toHaveCount(0);
        await expect
            .poll(async () =>
                (await q.mockConversations()).some((row) =>
                    row.messagesJson.includes("stream-comment"),
                ),
            )
            .toBe(true);
        const saved = (await q.mockConversations()).find((row) => row.mode === "feedback")!;
        const savedMessages = JSON.parse(saved.messagesJson);
        expect(
            savedMessages.find((message: { role: string }) => message.role === "assistant").metadata
                .toolApplications["stream-comment"].status,
        ).toBe(outcome);
        await panel
            .getByRole("list", { name: "Recent conversations" })
            .getByRole("button", { name: saved.title, exact: true })
            .click();
        await expect(page.getByRole("dialog", { name: saved.title })).toBeVisible();
        await expect(tool).toContainText(expectedLabel);
        if (outcome === "applied") await q.captureScreenshot("/tmp/quillium-tool-activity.png");
        await page.keyboard.down("Meta");
        await tool.locator("summary").click();
        if (outcome === "applied") await q.captureScreenshot("/tmp/quillium-tool-details.png");
        await page.keyboard.up("Meta");
        await page.reload();
        await expect(q.editor).toBeVisible({ timeout: 20000 });
        await page.locator("#ai-tab-feedback").click();
        await panel
            .getByRole("list", { name: "Recent conversations" })
            .getByRole("button", { name: saved.title, exact: true })
            .click();
        await expect(tool).toContainText(expectedLabel);
        if (outcome === "applied") {
            await input.fill("Look for another place to improve.");
            await input.press("Enter");
            await expect(tool).toHaveCount(2);
            await expect(tool.last()).toContainText("Couldn't add comment");
            await expect(tool.first()).toContainText("Comment added");
            await expect
                .poll(async () => {
                    const row = (await q.mockConversations()).find((row) => row.id === saved.id)!;
                    return JSON.parse(row.messagesJson)
                        .filter((message: { role: string }) => message.role === "assistant")
                        .map(
                            (message: {
                                metadata: { toolApplications: Record<string, { status: string }> };
                            }) => message.metadata.toolApplications["stream-comment"].status,
                        );
                })
                .toEqual(["applied", "skipped"]);
        }
    });
}

test("discussion modal fits a small window and restores keyboard focus", async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 480 });
    const q = newPageObject(page);
    await q.init();
    await q.openChat();
    const opener = page
        .getByRole("list", { name: "Recent conversations" })
        .getByRole("button", { name: "Opening scene", exact: true });
    await opener.click();
    const dialog = page.getByRole("dialog", { name: "Opening scene", exact: true });
    await expect(dialog).toBeVisible();
    const box = (await dialog.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(16);
    expect(box.y).toBeGreaterThanOrEqual(16);
    expect(box.x + box.width).toBeLessThanOrEqual(624);
    expect(box.y + box.height).toBeLessThanOrEqual(464);
    await expect(q.chatInput).toBeVisible();
    await page.keyboard.press("Meta+Shift+2");
    await expect(dialog).toBeVisible();
    await expect(q.chatPanel).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
});
