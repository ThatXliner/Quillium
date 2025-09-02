import { createOpenAI } from "@ai-sdk/openai";
import { convertToModelMessages, streamText, tool, type UIMessage } from "ai";
import { OPENAI_API_KEY } from "$env/static/private";
import { z } from "zod";
import { injectDocumentContext } from "$lib/utils";

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
    system: `You are a helpful writing assistant focused on revising and rewriting text. Your goal is to improve flow, conciseness, clarity, and overall quality.

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
            .array(z.string())
            .describe("One or more revised versions of the text"),
          comment: z
            .string()
            .optional()
            .describe("Optional explanation of the revision"),
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
