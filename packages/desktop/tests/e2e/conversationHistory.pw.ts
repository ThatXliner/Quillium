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
                  "Searchable amber question",
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
        title: "First discussion",
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
        title: "Second discussion",
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
        initialDoc: "The prose stays put while conversations branch.",
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
        await expect(q.conversationRow("First discussion")).toBeVisible();
        await expect(q.conversationRow("Second discussion")).toBeVisible();

        await q.openConversation("Second discussion");
        await expect(q.conversationMessage("Searchable amber question")).toBeVisible();

        await page.reload();
        await expect(q.editor).toBeVisible({ timeout: 20_000 });
        await q.openConversationHistory();
        await expect(q.conversationRows).toHaveCount(2);

        await q.openConversation("First discussion");
        await expect(q.conversationMessage("How does the opening land?")).toBeVisible();
        await q.openConversationHistory();
        await q.openConversation("Second discussion");
        await expect(q.conversationMessage("Searchable amber question")).toBeVisible();

        await q.searchConversations("amber");
        await expect(q.conversationRows).toHaveCount(1);
        await expect(q.conversationRow("Second discussion")).toBeVisible();
        await q.searchConversations("");

        const firstRow = q.conversationRow("First discussion");
        await firstRow.getByRole("button", { name: "Rename", exact: true }).click();
        const title = firstRow.getByRole("textbox", { name: "Conversation title" });
        await title.fill("Renamed opening discussion");
        await firstRow.getByRole("button", { name: "Save", exact: true }).click();
        await expect(q.conversationRow("Renamed opening discussion")).toBeVisible();

        const renamedRow = q.conversationRow("Renamed opening discussion");
        await renamedRow.getByRole("button", { name: "Archive", exact: true }).click();
        await expect(q.conversationRows).toHaveCount(1);
        await expect(q.conversationRow("Second discussion")).toBeVisible();

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
        await expect(q.conversationRow("Second discussion")).toBeVisible();

        const remaining = await q.mockConversations();
        expect(remaining.map((conversation) => conversation.id)).toEqual(["conversation-b"]);
    });

    test("starts a new chat while preserving the existing conversations", async ({ page }) => {
        const q = newPageObject(page);
        await q.init();
        await q.openConversationHistory();

        await expect(q.conversationRows).toHaveCount(2);
        await q.chatPanel.getByRole("button", { name: "New chat", exact: true }).click();
        await expect(q.conversationRows).toHaveCount(3);
        await expect(q.conversationRow("First discussion")).toBeVisible();
        await expect(q.conversationRow("Second discussion")).toBeVisible();

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
        await q.openConversation("First discussion");
        await expect(q.conversationMessageActions(branchCase.messageId)).toBeVisible();

        const proseBefore = await q.cmText();
        await q
            .conversationMessageActions(branchCase.messageId)
            .getByRole("button", { name: "Branch here", exact: true })
            .click();

        await expect(
            q.chatPanel.getByRole("button", { name: "Open origin conversation", exact: true }),
        ).toBeVisible({ timeout: 10_000 });
        await expect(q.conversationRows).toHaveCount(3);
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

test("expands Chat to larger bounds and captures the history surface", async ({ page }) => {
    const q = newPageObject(page);
    await q.init();
    await q.openConversationHistory();
    await q.openConversation("First discussion");
    await expect(q.chatInput).toBeEnabled();

    const before = await q.aiSidebar.boundingBox();
    expect(before).not.toBeNull();
    await q.expandChat();

    await expect
        .poll(async () => (await q.aiSidebar.boundingBox())?.width ?? 0, { timeout: 10_000 })
        .toBeGreaterThanOrEqual(950);
    await expect
        .poll(async () => (await q.aiSidebar.boundingBox())?.height ?? 0, { timeout: 10_000 })
        .toBeGreaterThanOrEqual(650);

    let previousBounds = "";
    await expect
        .poll(
            async () => {
                const box = await q.aiSidebar.boundingBox();
                if (!box || box.width < 950 || box.height < 650) {
                    previousBounds = "";
                    return "";
                }
                const bounds = `${Math.round(box.width)}x${Math.round(box.height)}`;
                if (bounds === previousBounds) return bounds;
                previousBounds = bounds;
                return "";
            },
            { timeout: 10_000 },
        )
        .not.toBe("");

    await q.resetConversationHistoryScroll();
    await q.expectConversationHistoryControlsVisible();
    await q.captureScreenshot("/tmp/quillium-conversation-history.png");
});

test("edits a user message into a provider-backed new path", async ({ page }) => {
    const q = newPageObject(page);
    await q.mockDeepSeekProvider();
    await q.init();
    await q.openConversationHistory();
    await q.openConversation("First discussion");

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
    await expect(q.conversationRows).toHaveCount(3);
    await expect(q.conversationRow("First discussion (edit)")).toBeVisible();
    await expect(q.conversationMessage("What changes after the midpoint?")).toBeVisible();
    await expect(
        q.conversationMessage("The stakes need a sharper turn before the midpoint."),
    ).toBeHidden();
    await q.expectEditorText(proseBefore);

    await q.openConversation("First discussion");
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
    await q.openConversation("First discussion");

    const proseBefore = await q.cmText();
    await q
        .conversationMessageActions("assistant-1")
        .getByRole("button", { name: "Retry as new path", exact: true })
        .click();

    await expect(q.conversationMessage("Alternative answer")).toBeVisible({ timeout: 15_000 });
    await expect(q.conversationRows).toHaveCount(3);
    await expect(q.conversationRow("First discussion (retry)")).toBeVisible();
    await expect(q.conversationMessage("How does the opening land?")).toBeVisible();
    await expect(
        q.conversationMessage("The stakes need a sharper turn before the midpoint."),
    ).toBeHidden();
    await q.expectEditorText(proseBefore);

    await q.openConversation("First discussion");
    await expect(
        q.conversationMessage("It creates momentum, but the image is familiar."),
    ).toBeVisible();
    await expect(q.conversationMessage("Alternative answer")).toBeHidden();
    await q.expectEditorText(proseBefore);
});
