import { createOpenAI } from "@ai-sdk/openai";
import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { OPENAI_API_KEY } from "$env/static/private";
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
    model: openai("gpt-4o-mini"),
    messages: [
      ...convertToModelMessages(messages),
      injectDocumentContext({ documentContent, selectedText }),
    ],
    system: `You are a helpful writing assistant. You have access to the user's current document and any selected text they have highlighted.

        When providing feedback:
        - Be specific and actionable
        - Reference the actual content when relevant
        - Suggest concrete improvements
        - Help with clarity, flow, grammar, and style
        - If text is selected, focus primarily on that selection unless asked otherwise

        Keep responses concise but thorough.`,
  });

  return result.toUIMessageStreamResponse();
}
