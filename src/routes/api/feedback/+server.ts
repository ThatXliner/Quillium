import { convertToModelMessages, streamText, tool, type UIMessage } from "ai";
import { OPENAI_API_KEY } from "$env/static/private";
import { z } from "zod";
import { injectDocumentContext } from "$lib/ai/utils";
import { createModel, type Provider } from "$lib/ai/provider";

export async function POST({ request }) {
    const {
        messages,
        documentContent,
        selectedText,
        provider,
        model,
        apiKey,
    }: {
        messages: UIMessage[];
        documentContent: string;
        selectedText: string;
        provider?: Provider;
        model?: string;
        apiKey?: string;
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
        system: `You are a helpful writing assistant providing feedback on documents. You can create comments and suggestions to help improve the writing.

When providing feedback:
- Use createComment for general feedback, questions, or observations about specific text
- Use createSuggestion for specific text replacements or rewrites
- Be specific and actionable in your feedback
- Reference the actual content when relevant
- Help with clarity, flow, grammar, and style
- If text is selected, focus primarily on that selection unless asked otherwise

Current document length: ${documentContent?.length || 0} characters
${selectedText ? `Selected text: "${selectedText}"` : "No text selected"}`,
        tools: {
            createComment: tool({
                description:
                    "Create a comment annotation on specific text to provide feedback, ask questions, or make observations",
                inputSchema: z.object({
                    targetText: z.string().describe("The exact text to comment on"),
                    comment: z.string().describe("The feedback or comment to add"),
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
            createSuggestion: tool({
                description:
                    "Create a suggestion annotation with specific text replacements or rewrites",
                inputSchema: z.object({
                    targetText: z.string().describe("The exact text to replace"),
                    replacements: z
                        .array(z.object({
                            text: z.string().describe("The replacement text"),
                            rationale: z.string().optional().describe("Brief explanation of what this option changes and why"),
                        }))
                        .describe("One or more replacement options, each with an optional rationale"),
                    comment: z
                        .string()
                        .optional()
                        .describe("Optional overall explanation for the suggestion"),
                }),
                execute: async ({ targetText, replacements, comment }) => {
                    return { type: "suggestion", targetText, replacements, comment, timestamp: Date.now() };
                },
            }),
        },
    });

    return result.toUIMessageStreamResponse();
}
