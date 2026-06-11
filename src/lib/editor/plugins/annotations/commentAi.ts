/**
 * commentAi.ts — Shared AI suggestion helpers for comment threads.
 *
 * Used by Comment.svelte (inline card) and CommentModal.svelte (expanded modal)
 * to build prompts and stream AI responses, ensuring both flows stay in sync.
 */
import { streamChat } from "$lib/ai/clientStreams";
import { setAiProcessing, ensureApiKeyLoaded, getAiAbortSignal } from "$lib/ai/settings.svelte";
import type { Provider } from "$lib/ai/provider";
import type { Thread } from ".";

/**
 * Build the AI suggestion prompt from a thread and the selected document text.
 */
export function buildCommentAiPrompt(thread: Thread, selectedText: string): string {
    let prompt = "Provide suggestions based on the following";
    prompt += thread.length === 1 ? " comment:\n" : " conversation thread:\n";
    prompt += "```\n";
    prompt +=
        thread.length === 1
            ? thread[0].message
            : thread.map((m) => `${m.author}: ${m.message}`).join("\n");
    prompt += "\n```\n";
    prompt += "For context, here is the selected text the comment is referring to:\n";
    prompt += `\`\`\`\n${selectedText}\`\`\`\n`;
    prompt += "Be concise.";
    return prompt;
}

/**
 * Open a streaming chat connection and collect the full AI text-delta
 * response into a single string.
 */
export async function streamCommentAiResponse(
    prompt: string,
    selectedText: string,
    settings: { provider: Provider; model: string; apiKey: string },
): Promise<string> {
    setAiProcessing(true);
    await ensureApiKeyLoaded();
    const abortSignal = getAiAbortSignal();
    const stream = await streamChat({
        messages: [{ id: "1", role: "user", parts: [{ type: "text", text: prompt }] }],
        documentContent: "",
        selectedText,
        provider: settings.provider,
        model: settings.model,
        apiKey: settings.apiKey,
        abortSignal,
    });

    const reader = stream.getReader();
    let aiResponse = "";
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            if (value?.type === "text-delta") aiResponse += value.delta;
        }
        return aiResponse;
    } catch (e) {
        // A user-initiated Stop aborts the stream mid-read — return what
        // streamed so far instead of surfacing it as an error in the thread.
        if (abortSignal.aborted) return aiResponse;
        throw e;
    } finally {
        setAiProcessing(false);
    }
}
