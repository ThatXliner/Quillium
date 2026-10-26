/**
 * Provider abstraction layer.
 *
 * This file decouples the rest of the AI subsystem from any specific LLM
 * vendor. Every streaming function in `clientStreams.ts` and the chat
 * factory (`chatFactory.ts`) call `createModel` to obtain a generic
 * `LanguageModel` — the only place where vendor SDKs are imported.
 *
 * Supported backends: OpenAI, OpenAI-compatible, Anthropic, Google (Gemini),
 * DeepSeek.
 *
 * Data flow:
 * aiSettings.provider / .apiKey / .model / .baseURL --> createModel() --> LanguageModel
 *
 * To add a new provider, install its @ai-sdk/* package, extend the
 * `Provider` union, and add a case to the switch in `createModel`.
 */
import { createAnthropic } from "@ai-sdk/anthropic";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAIOAuth } from "@openai-oauth/ai-sdk";
import type { LanguageModel } from "ai";
import { getFreshOpenAISession, openAIOAuthFetch } from "./openaiOAuth";

export type Provider =
    | "openai"
    | "openai-oauth"
    | "openai-compatible"
    | "anthropic"
    | "google"
    | "deepseek";

// The Codex Responses API runs with `store: false`, so the server never persists
// response items. @openai-oauth/core keeps an in-memory CodexResponsesState that
// re-expands the `item_reference`s the AI SDK emits for prior assistant turns back
// into full content. That state lives inside the transport built by
// createOpenAIOAuth, so the provider MUST be created once and reused across turns —
// building a fresh one per message gives each turn an empty state, and multi-turn
// chats fail with "Item with id 'msg_…' not found. Items are not persisted when
// `store` is set to false." Token refresh is unaffected: the session is resolved
// per-request via getFreshOpenAISession.
let openAIOAuthProvider: ReturnType<typeof createOpenAIOAuth> | null = null;

function getOpenAIOAuthProvider(): ReturnType<typeof createOpenAIOAuth> {
    if (!openAIOAuthProvider) {
        openAIOAuthProvider = createOpenAIOAuth({
            kind: "openai-oauth",
            getSession: getFreshOpenAISession,
            fetch: openAIOAuthFetch,
        });
    }
    return openAIOAuthProvider;
}

// Drop the cached provider (and its response-replay state) when the ChatGPT
// connection changes, so a fresh sign-in starts from a clean slate.
export function resetOpenAIOAuthProvider(): void {
    openAIOAuthProvider = null;
}

/**
 * Instantiate a vendor-specific LanguageModel for the given provider.
 *
 * Each vendor SDK follows the same two-step pattern:
 * 1. Create a provider instance with the user's API key.
 * 2. Call it with the model ID to get a LanguageModel.
 *
 * The "openai-compatible" provider routes through a user-configured
 * base URL, allowing any OpenAI-compatible API endpoint (e.g. local
 * models, self-hosted proxies, third-party gateways).
 */
export function createModel(
    provider: Provider,
    apiKey: string,
    modelId: string,
    baseURL?: string,
): LanguageModel {
    switch (provider) {
        case "openai":
            return createOpenAI({ apiKey })(modelId) as LanguageModel;
        case "openai-oauth":
            return getOpenAIOAuthProvider()(modelId) as unknown as LanguageModel;
        case "openai-compatible": {
            if (!baseURL?.trim()) {
                throw new Error("Add a local endpoint base URL before using AI features.");
            }
            return createOpenAI({
                apiKey: apiKey || "unused",
                baseURL: baseURL.trim(),
            })(modelId) as LanguageModel;
        }
        case "anthropic":
            return createAnthropic({ apiKey })(modelId) as unknown as LanguageModel;
        case "google":
            return createGoogleGenerativeAI({ apiKey })(modelId) as unknown as LanguageModel;
        case "deepseek":
            return createDeepSeek({ apiKey })(modelId) as unknown as LanguageModel;
    }
}
