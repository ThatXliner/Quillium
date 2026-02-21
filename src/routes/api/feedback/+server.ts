import { convertToModelMessages, streamText, tool, type UIMessage } from "ai";
import { OPENAI_API_KEY } from "$env/static/private";
import { z } from "zod";
import { injectDocumentContext, buildDocumentContextPrompt } from "$lib/ai/utils";
import { createModel, type Provider } from "$lib/ai/provider";

export async function POST({ request }) {
    const {
        messages,
        documentContent,
        selectedText,
        provider,
        model,
        apiKey,
        documentContext,
    }: {
        messages: UIMessage[];
        documentContent: string;
        selectedText: string;
        provider?: Provider;
        model?: string;
        apiKey?: string;
        documentContext?: Record<string, string>;
    } = await request.json();

    const resolvedProvider: Provider = provider ?? "openai";
    const resolvedModel = model ?? "gpt-4o";
    const resolvedKey = apiKey || OPENAI_API_KEY;

    const result = streamText({
        model: createModel(resolvedProvider, resolvedKey, resolvedModel),
        messages: [
            ...convertToModelMessages(messages),
            injectDocumentContext({ documentContent, selectedText }),
        ],
        system: `You are an editorial writing assistant providing high-level feedback on documents. Your job is to help writers think about the big picture: structure, voice, argument, scope, pacing, and style.${buildDocumentContextPrompt(documentContext)}

When providing feedback:
- Discuss overall document issues conversationally — structure, argument, pacing, tone, scope
- Use createComment to flag specific passages that illustrate a broader issue (e.g. a paragraph that buries the lede, a section that feels off-tone)
- Use createRevision when a passage could benefit from a meaningfully different approach — provide 2-3 labeled versions showing distinct stylistic or structural alternatives, with a thread message explaining the tradeoff between them
- Avoid nitpicking grammar or minor wording — that's for the revision tool. Focus on things that affect the reader's experience of the whole piece
- Be specific but editorial: reference the actual text and explain why something works or doesn't
- If text is selected, treat it as the focus but consider how it fits the larger document

Current document length: ${documentContent?.length || 0} characters
${selectedText ? `Selected text: "${selectedText}"` : "No text selected"}`,
        tools: {
            createComment: tool({
                description:
                    "Flag a specific passage with editorial feedback — use for observations about how a section affects the overall piece",
                inputSchema: z.object({
                    targetText: z.string().describe("The exact text to comment on"),
                    comment: z.string().describe("The editorial feedback or observation"),
                }),
                execute: async ({ targetText, comment }) => {
                    return {
                        type: "comment",
                        targetText,
                        comment,
                        timestamp: Date.now(),
                    };
                },
            }),
            createRevision: tool({
                description:
                    "Propose meaningful alternative approaches to a passage — use when a section could work very differently depending on the writer's intent. Provide 2-3 labeled versions with a message explaining the tradeoffs.",
                inputSchema: z.object({
                    targetText: z.string().describe("The exact text to revise"),
                    versions: z
                        .array(z.object({
                            label: z.string().describe("Short name for this version, e.g. 'Concise', 'Formal', 'Original'"),
                            text: z.string().describe("The full revised text for this version"),
                        }))
                        .min(2)
                        .describe("2-3 distinct alternative versions of the passage"),
                    threadMessage: z
                        .string()
                        .describe("Explanation of the differences between versions and when each might suit the writer's goals"),
                }),
                execute: async ({ targetText, versions, threadMessage }) => {
                    return { type: "revision", targetText, versions, threadMessage, timestamp: Date.now() };
                },
            }),
        },
    });

    return result.toUIMessageStreamResponse();
}
