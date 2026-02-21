import { convertToModelMessages, streamText, tool, type UIMessage } from "ai";
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
    const resolvedKey = apiKey ?? "";

    const result = streamText({
        model: createModel(resolvedProvider, resolvedKey, resolvedModel),
        messages: [
            ...convertToModelMessages(messages),
            injectDocumentContext({ documentContent, selectedText }),
        ],
        system: `You are a helpful writing assistant focused on revising and rewriting text. Your goal is to improve flow, conciseness, clarity, and overall quality.${buildDocumentContextPrompt(documentContext)}

When revising text:
- Use createSuggestion to propose specific rewrites and improvements
- Focus on making text more concise, clear, and engaging
- Improve sentence structure and flow
- Fix grammar and style issues
- Maintain the original meaning and tone unless specifically asked to change it
- Provide multiple alternatives when possible
- If text is selected, focus on revising that selection`,
        tools: {
            createSuggestion: tool({
                description: "Create a suggestion with revised/rewritten text",
                inputSchema: z.object({
                    targetText: z.string().describe("The exact text to revise"),
                    replacements: z
                        .array(z.object({
                            text: z.string().describe("The revised text"),
                            rationale: z.string().optional().describe("Brief explanation of what this version changes and why"),
                        }))
                        .describe("One or more revised versions of the text, each with an optional rationale"),
                    comment: z
                        .string()
                        .optional()
                        .describe("Optional overall explanation of the revision"),
                }),
                execute: async ({ targetText, replacements, comment }) => {
                    return { type: "suggestion", targetText, replacements, comment, timestamp: Date.now() };
                },
            }),
            createComment: tool({
                description:
                    "Create a comment to explain revision reasoning or ask clarifying questions",
                inputSchema: z.object({
                    targetText: z.string().describe("The text to comment on"),
                    comment: z.string().describe("The comment or question"),
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
        },
    });

    return result.toUIMessageStreamResponse();
}
