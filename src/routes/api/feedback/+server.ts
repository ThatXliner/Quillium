import { createOpenAI } from "@ai-sdk/openai";
import { convertToModelMessages, streamText, tool, type UIMessage } from "ai";
import { OPENAI_API_KEY } from "$env/static/private";
import { z } from "zod";
import { injectDocumentContext } from "$lib/ai/utils";

const openai = createOpenAI({ apiKey: OPENAI_API_KEY });

export async function POST({ request }) {
  const {
    messages,
    documentContent,
    selectedText,
  }: { messages: UIMessage[]; documentContent: string; selectedText: string } =
    await request.json();

  const result = streamText({
    model: openai("gpt-4o"),
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
            .array(z.string())
            .describe("One or more replacement options for the selected text"),
          comment: z
            .string()
            .optional()
            .describe("Optional explanation for the suggestion"),
        }),
        execute: async ({ targetText, replacements, comment }) => {
          return {
            type: "suggestion",
            targetText,
            replacements,
            comment,
            timestamp: Date.now(),
          };
        },
      }),
    },
  });

  return result.toUIMessageStreamResponse();
}
