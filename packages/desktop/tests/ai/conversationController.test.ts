import {
    createConversationController,
    sanitizeOutboundMessages,
} from "$lib/ai/conversationController.svelte";
import type { Conversation } from "$lib/ai/conversationStore";
import { currentDocumentId, currentDraftId, currentTabId, documentContent } from "$lib/stores";
import type { ChatStatus, UIMessage } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
    listConversations: vi.fn(),
    getConversation: vi.fn(),
    createConversation: vi.fn(),
    saveConversationMessages: vi.fn(),
    renameConversation: vi.fn(),
    archiveConversation: vi.fn(),
    deleteConversation: vi.fn(),
}));

vi.mock("$lib/ai/conversationStore", () => db);

function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((promiseResolve, promiseReject) => {
        resolve = promiseResolve;
        reject = promiseReject;
    });
    return { promise, resolve, reject };
}

async function settle() {
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

function textMessage(id: string, role: "user" | "assistant", text: string): UIMessage {
    return { id, role, parts: [{ type: "text", text }] };
}

function conversation(
    id: string,
    messages: UIMessage[],
    overrides: Partial<Conversation> = {},
): Conversation {
    return {
        id,
        documentId: "doc-1",
        draftId: "draft-1",
        draftLabel: "Draft one",
        mode: "chat",
        title: id,
        createdAt: 1,
        updatedAt: 1,
        archived: false,
        messagesJson: JSON.stringify(messages),
        sourceConversationId: null,
        sourceMessageId: null,
        ...overrides,
    };
}

function makeChat(initialMessages: UIMessage[] = []) {
    let messages = initialMessages;
    let nextId = 0;
    const chat = {
        status: "ready" as ChatStatus,
        error: undefined as Error | undefined,
        get messages() {
            return messages;
        },
        set messages(nextMessages: UIMessage[]) {
            messages = nextMessages;
        },
        sendMessage: vi.fn(async ({ text }: { text: string }) => {
            chat.status = "streaming";
            chat.messages = [
                ...chat.messages,
                textMessage(`assistant-${text}`, "assistant", `Answer: ${text}`),
            ];
            chat.status = "ready";
        }),
        regenerate: vi.fn(async () => {
            chat.status = "streaming";
            chat.messages = [...chat.messages, textMessage("retry-answer", "assistant", "Retry")];
            chat.status = "ready";
        }),
        stop: vi.fn(async () => {}),
        generateId: vi.fn(() => `generated-${++nextId}`),
        clearError: vi.fn(() => {
            chat.error = undefined;
        }),
    };
    return chat;
}

let activeController: ReturnType<typeof createConversationController> | null = null;

async function startController(chat: ReturnType<typeof makeChat>) {
    activeController = createConversationController({
        chat: chat as Parameters<typeof createConversationController>[0]["chat"],
        mode: "chat",
        requestSettings: () => ({ provider: "openai", model: "test-model" }),
    });
    activeController.subscribe();
    await vi.waitFor(() => expect(activeController?.conversations.loading).toBe(false));
    return activeController;
}

beforeEach(() => {
    for (const mock of Object.values(db)) mock.mockReset();
    db.listConversations.mockResolvedValue([]);
    db.getConversation.mockResolvedValue(null);
    db.saveConversationMessages.mockResolvedValue(undefined);
    db.renameConversation.mockResolvedValue(undefined);
    db.archiveConversation.mockResolvedValue(undefined);
    db.deleteConversation.mockResolvedValue(undefined);
    db.createConversation.mockImplementation(async (input) => ({
        id: input.id,
        documentId: input.documentId,
        draftId: input.draftId,
        draftLabel: "Draft one",
        mode: input.mode,
        title: input.title,
        createdAt: 2,
        updatedAt: 2,
        archived: false,
        messagesJson: input.messagesJson,
        sourceConversationId: input.sourceConversationId ?? null,
        sourceMessageId: input.sourceMessageId ?? null,
    }));
    currentDocumentId.set("doc-1");
    currentDraftId.set("draft-1");
    currentTabId.set("tab-1");
    documentContent.set("The draft at send time.");
});

afterEach(async () => {
    await activeController?.dispose().catch(() => undefined);
    activeController = null;
    currentDocumentId.set(null);
    currentDraftId.set(null);
    currentTabId.set(null);
});

describe("conversation controller", () => {
    it("waits for the originating save before replacing messages on a draft switch", async () => {
        const chat = makeChat();
        const response = deferred<void>();
        const finalSave = deferred<void>();
        const savedIds: string[] = [];
        db.saveConversationMessages.mockImplementation(async (id: string, json: string) => {
            savedIds.push(id);
            if (json.includes('"role":"assistant"')) await finalSave.promise;
        });
        chat.sendMessage.mockImplementation(async ({ text }: { text: string }) => {
            chat.status = "streaming";
            await response.promise;
            chat.messages = [
                ...chat.messages,
                textMessage("answer", "assistant", `Answer: ${text}`),
            ];
            chat.status = "ready";
        });
        const controller = await startController(chat);

        const send = controller.sendMessage("first prompt");
        await settle();
        const conversationId = db.createConversation.mock.calls[0][0].id;
        response.resolve();
        await settle();
        expect(db.saveConversationMessages).toHaveBeenCalledTimes(2);

        currentDraftId.set("draft-2");
        await settle();
        expect(chat.messages).toHaveLength(2);
        expect(db.listConversations).toHaveBeenCalledTimes(1);

        finalSave.resolve();
        await expect(send).resolves.toBeUndefined();
        await settle();
        expect(chat.messages).toEqual([]);
        expect(savedIds.every((id) => id === conversationId)).toBe(true);
        expect(controller.conversations.current).toBeNull();
    });

    it.each(["send", "edit", "retry"] as const)(
        "waits for the %s provider promise before replacing its source path",
        async (operationName) => {
            const sourceMessages = [
                textMessage("u1", "user", "first"),
                textMessage("a1", "assistant", "answer one"),
                textMessage("u2", "user", "second"),
                textMessage("a2", "assistant", "answer two"),
            ];
            const source = conversation("source", sourceMessages);
            db.listConversations.mockImplementation(async (documentId: string) =>
                operationName === "send" || documentId !== "doc-1" ? [] : [source],
            );
            const chat = makeChat();
            const providerStarted = deferred<void>();
            const providerRelease = deferred<void>();
            chat.sendMessage.mockImplementation(async ({ text }: { text: string }) => {
                chat.status = "streaming";
                providerStarted.resolve();
                await providerRelease.promise;
                chat.messages = [
                    ...chat.messages,
                    textMessage("new-answer", "assistant", `Answer: ${text}`),
                ];
                chat.status = "ready";
            });
            chat.regenerate.mockImplementation(async () => {
                chat.status = "streaming";
                providerStarted.resolve();
                await providerRelease.promise;
                chat.messages = [...chat.messages, textMessage("new-answer", "assistant", "Retry")];
                chat.status = "ready";
            });
            const controller = await startController(chat);

            const operation =
                operationName === "send"
                    ? controller.sendMessage("new prompt")
                    : operationName === "edit"
                      ? controller.edit("u2", "edited prompt")
                      : controller.retry("a2");
            await providerStarted.promise;
            const createCall = db.createConversation.mock.calls.at(-1);
            if (!createCall) throw new Error("operation did not create a source conversation");
            const initiatingId = createCall[0].id as string;

            currentDraftId.set("draft-2");
            await settle();
            expect(chat.stop.mock.calls.length).toBeGreaterThanOrEqual(2);
            expect(chat.messages.length).toBeGreaterThan(0);
            expect(controller.conversations.loading).toBe(true);
            expect(
                db.listConversations.mock.calls.some(([documentId]) => documentId === "doc-2"),
            ).toBe(false);

            providerRelease.resolve();
            await operation;
            await settle();
            expect(chat.messages).toEqual([]);
            const savedIds = db.saveConversationMessages.mock.calls.map(([id]) => id as string);
            expect(savedIds.length).toBeGreaterThan(0);
            expect(savedIds.every((id) => id === initiatingId)).toBe(true);
            expect(source.messagesJson).toBe(JSON.stringify(sourceMessages));
        },
    );

    it("invalidates a pending create before starting inference when New chat is selected", async () => {
        const pendingCreate = deferred<Conversation>();
        let createCount = 0;
        db.createConversation.mockImplementation(async (input) => {
            createCount += 1;
            if (createCount === 1) return pendingCreate.promise;
            return {
                id: input.id,
                documentId: input.documentId,
                draftId: input.draftId,
                draftLabel: "Draft one",
                mode: input.mode,
                title: input.title,
                createdAt: 2,
                updatedAt: 2,
                archived: false,
                messagesJson: input.messagesJson,
                sourceConversationId: null,
                sourceMessageId: null,
            };
        });
        const chat = makeChat();
        const controller = await startController(chat);

        const send = controller.sendMessage("pending prompt");
        await vi.waitFor(() => expect(db.createConversation).toHaveBeenCalledTimes(1));
        const replacement = controller.newConversation();
        pendingCreate.resolve(conversation("pending", []));

        await expect(send).rejects.toThrow(/target changed/);
        await replacement;
        expect(chat.sendMessage).not.toHaveBeenCalled();
        expect(chat.messages).toEqual([]);
        expect(db.createConversation).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({ messagesJson: "[]" }),
        );
        expect(controller.conversations.current?.title).toBe("New chat");
    });

    it("names an explicit empty conversation from its first prompt", async () => {
        const chat = makeChat();
        const controller = await startController(chat);

        await controller.newConversation();
        const conversationId = controller.conversations.current?.id;
        await controller.sendMessage("A useful first prompt");

        expect(conversationId).toBeTruthy();
        expect(db.renameConversation).toHaveBeenCalledWith(conversationId, "A useful first prompt");
        expect(controller.conversations.current?.title).toBe("A useful first prompt");
    });

    it("persists the prompt before inference and blocks inference on that failure", async () => {
        db.saveConversationMessages.mockRejectedValueOnce(new Error("database unavailable"));
        const chat = makeChat();
        const controller = await startController(chat);

        await expect(controller.sendMessage("must be durable first")).rejects.toThrow(
            /database unavailable/,
        );
        expect(chat.sendMessage).not.toHaveBeenCalled();
        expect(chat.messages).toHaveLength(1);
        expect(chat.messages[0].role).toBe("user");
        expect(controller.conversations.canSend).toBe(false);
    });

    it("keeps unsaved messages visible when replacement cannot retry durability", async () => {
        const chat = makeChat();
        let assistantSaveAttempts = 0;
        db.saveConversationMessages.mockImplementation(async (_id: string, json: string) => {
            if (json.includes('"role":"assistant"') && assistantSaveAttempts++ < 2) {
                throw new Error("database unavailable");
            }
        });
        const controller = await startController(chat);

        await expect(controller.sendMessage("keep this")).rejects.toThrow(/database unavailable/);
        expect(chat.messages).toHaveLength(2);

        await expect(controller.newConversation()).rejects.toThrow(/Could not save/);
        expect(chat.messages).toHaveLength(2);
        expect(controller.conversations.current).not.toBeNull();

        await controller.newConversation();
        expect(chat.messages).toEqual([]);
        expect(controller.conversations.current?.messagesJson).toBe("[]");
    });

    it("branches without sending, then edits and retries from preserved source prefixes", async () => {
        const sourceMessages = [
            textMessage("u1", "user", "first"),
            textMessage("a1", "assistant", "answer one"),
            textMessage("u2", "user", "second"),
            textMessage("a2", "assistant", "answer two"),
        ];
        const source = conversation("source", sourceMessages, { title: "Source" });
        db.listConversations.mockResolvedValue([source]);
        db.getConversation.mockResolvedValue(source);
        const chat = makeChat();
        const controller = await startController(chat);
        expect(controller.conversations.current?.id).toBe("source");

        await controller.branch("a1");
        const branchInput = db.createConversation.mock.calls[0][0];
        expect(JSON.parse(branchInput.messagesJson)).toEqual(sourceMessages.slice(0, 2));
        expect(branchInput.sourceConversationId).toBe("source");
        expect(branchInput.sourceMessageId).toBe("a1");
        expect(chat.sendMessage).not.toHaveBeenCalled();
        expect(chat.regenerate).not.toHaveBeenCalled();

        await controller.open("source");
        await controller.edit("u2", "edited prompt");
        const editInput = db.createConversation.mock.calls[1][0];
        expect(JSON.parse(editInput.messagesJson)).toEqual(sourceMessages.slice(0, 2));
        expect(editInput.sourceMessageId).toBe("u2");
        expect(chat.sendMessage).toHaveBeenCalledTimes(1);
        const editSave = db.saveConversationMessages.mock.calls.at(-1);
        if (!editSave) throw new Error("edit did not save its response");
        expect(JSON.parse(editSave[1] as string)).toEqual([
            ...sourceMessages.slice(0, 2),
            expect.objectContaining({ role: "user" }),
            expect.objectContaining({ role: "assistant" }),
        ]);

        await controller.open("source");
        await controller.retry("a2");
        const retryInput = db.createConversation.mock.calls[2][0];
        const retryPrefix = JSON.parse(retryInput.messagesJson) as UIMessage[];
        expect(retryPrefix).toHaveLength(3);
        expect(retryPrefix.map((message) => message.id)).toEqual(["u1", "a1", "u2"]);
        expect(retryPrefix[2].metadata).toEqual(
            expect.objectContaining({
                writingContext: expect.objectContaining({
                    draftId: "draft-1",
                    provider: "openai",
                    model: "test-model",
                    capturedAt: expect.any(Number),
                }),
            }),
        );
        expect(chat.regenerate).toHaveBeenCalledWith({
            body: { editorialTask: "conversation", exactWordCount: undefined },
        });
        expect(chat.sendMessage).toHaveBeenCalledTimes(1);
        expect(source.messagesJson).toBe(JSON.stringify(sourceMessages));
    });

    it("fails closed for invalid history and strips historical tools only from outbound copies", async () => {
        const invalid = conversation("invalid", [], { messagesJson: "" });
        db.listConversations.mockResolvedValue([invalid]);
        const chat = makeChat();
        const controller = await startController(chat);

        expect(controller.conversations.current?.id).toBe("invalid");
        expect(controller.conversations.canSend).toBe(false);
        expect(controller.conversations.error).toMatch(/invalid message data/i);

        const historical = [
            textMessage("u", "user", "prompt"),
            {
                id: "a",
                role: "assistant",
                parts: [
                    { type: "text", text: "before tool" },
                    { type: "tool-createComment", toolCallId: "call-1", state: "input-available" },
                ],
            },
        ] as UIMessage[];
        const outbound = sanitizeOutboundMessages(historical);
        expect(outbound).toEqual([
            textMessage("u", "user", "prompt"),
            textMessage("a", "assistant", "before tool"),
        ]);
        expect(historical[1].parts).toHaveLength(2);
    });
});

describe("unified discussions", () => {
    it("opens legacy feedback and revision discussions without changing their identity", async () => {
        const oldFeedback = conversation(
            "feedback-history",
            [textMessage("u1", "user", "Review the opening")],
            { mode: "feedback" },
        );
        const oldRevision = conversation(
            "revise-history",
            [textMessage("u2", "user", "Tighten the opening")],
            { mode: "revise", updatedAt: 3 },
        );
        db.listConversations.mockResolvedValue([oldFeedback, oldRevision]);
        const chat = makeChat();
        const controller = await startController(chat);
        expect(controller.conversations.current?.id).toBe("revise-history");
        await controller.open("feedback-history");
        await controller.sendMessage("Why?", { task: "conversation" });
        expect(controller.conversations.current?.id).toBe("feedback-history");
        expect(db.createConversation).not.toHaveBeenCalled();
        expect(db.saveConversationMessages).toHaveBeenCalledWith(
            "feedback-history",
            expect.stringContaining('"task":"conversation"'),
        );
        await controller.rename("revise-history", "A tighter opening");
        expect(db.renameConversation).toHaveBeenCalledWith("revise-history", "A tighter opening");
    });

    it("keeps per-turn permissions and exact word counts when retrying a mixed discussion", async () => {
        const prompt = textMessage("u1", "user", "Compress this");
        prompt.metadata = { editorialTurn: { task: "exact-compression", exactWordCount: 42 } };
        db.listConversations.mockResolvedValue([
            conversation("mixed", [prompt, textMessage("a1", "assistant", "Options")]),
        ]);
        const chat = makeChat();
        const controller = await startController(chat);
        await controller.retry("a1");
        expect(chat.regenerate).toHaveBeenCalledWith({
            body: { editorialTask: "exact-compression", exactWordCount: 42 },
        });
    });

    it("uses a legacy discussion's original task for retry but not for a new follow-up", async () => {
        db.listConversations.mockResolvedValue([
            conversation(
                "old",
                [textMessage("u1", "user", "Review it"), textMessage("a1", "assistant", "Notes")],
                { mode: "feedback" },
            ),
        ]);
        const chat = makeChat();
        const controller = await startController(chat);
        await controller.retry("a1");
        expect(chat.regenerate).toHaveBeenCalledWith({
            body: { editorialTask: "global-review", exactWordCount: undefined },
        });
        await controller.sendMessage("Tell me more");
        expect(
            chat.messages.find((message) => message.role === "user" && message.id !== "u1")
                ?.metadata,
        ).toMatchObject({ editorialTurn: { task: "conversation" } });
    });
});

describe("reader review durability", () => {
    it("persists the request before running and retains the application result in the same discussion", async () => {
        const chat = makeChat();
        const controller = await startController(chat);
        const action = vi.fn(async () => {
            expect(db.saveConversationMessages).toHaveBeenCalledWith(
                expect.any(String),
                expect.stringContaining("Review from each reader"),
            );
            expect(controller.conversations.canSend).toBe(false);
            return "Reader review ended.";
        });
        await controller.conversations.runAction(
            "Review from each reader",
            { task: "global-review" },
            action,
        );
        expect(action).toHaveBeenCalledOnce();
        expect(chat.sendMessage).not.toHaveBeenCalled();
        expect(chat.messages.at(-1)).toMatchObject({ metadata: { applicationMessage: true } });
        expect(db.saveConversationMessages.mock.calls.at(-1)?.[1]).toContain(
            "Reader review ended.",
        );
    });

    it("does not start reader requests when saving the prompt fails", async () => {
        const controller = await startController(makeChat());
        db.saveConversationMessages.mockRejectedValue(new Error("disk full"));
        const action = vi.fn(async () => "Finished");
        await expect(
            controller.conversations.runAction("Review", { task: "global-review" }, action),
        ).rejects.toThrow("disk full");
        expect(action).not.toHaveBeenCalled();
        db.saveConversationMessages.mockResolvedValue(undefined);
    });
});

it("retains legacy task defaults across branching and retrying", async () => {
    db.listConversations.mockResolvedValue([
        conversation(
            "legacy",
            [textMessage("u1", "user", "Review"), textMessage("a1", "assistant", "Notes")],
            { mode: "feedback" },
        ),
    ]);
    const chat = makeChat();
    const controller = await startController(chat);
    await controller.branch("a1");
    expect(controller.conversations.current?.mode).toBe("feedback");
    await controller.retry("a1");
    expect(chat.regenerate).toHaveBeenCalledWith({
        body: { editorialTask: "global-review", exactWordCount: undefined },
    });
});
