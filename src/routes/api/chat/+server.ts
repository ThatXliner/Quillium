import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { OPENAI_API_KEY } from "$env/static/private";
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
    const resolvedModel = model ?? "gpt-4o-mini";
    const resolvedKey = apiKey || OPENAI_API_KEY;

    const result = streamText({
        model: createModel(resolvedProvider, resolvedKey, resolvedModel),
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
