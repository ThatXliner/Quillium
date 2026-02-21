import { Chat, type ChatOptions } from "@ai-sdk/svelte";
import { setAiProcessing } from "./settings.svelte";

/**
 * Drop-in replacement for `new Chat(options)`.
 *
 * Centralises cross-cutting concerns for AI chat instances:
 *
 *   - clearChat() — resets message history. When the plugin system lands,
 *     this becomes "reload plugin". Only this file needs updating then.
 *
 *   - setAiProcessing — imported and re-exported so components can wire up
 *     the processing indicator ($effect) without importing from settings directly.
 *     All AI processing state flows through here.
 */
export function createAiChat(options: ChatOptions) {
    const chat = new Chat(options);

    function clearChat() {
        chat.messages = [];
    }

    return { chat, clearChat };
}

// Re-export so components only need one import for all chat concerns
export { setAiProcessing };
