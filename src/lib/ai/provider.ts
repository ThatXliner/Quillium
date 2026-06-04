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
import type { LanguageModel } from "ai";

export type Provider = "openai" | "openai-compatible" | "anthropic" | "google" | "deepseek";

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
        case "openai-compatible":
            return createOpenAI({
                apiKey: apiKey || "unused",
                baseURL: baseURL || "http://localhost:11434/v1",
            })(modelId) as LanguageModel;
        case "anthropic":
            return createAnthropic({ apiKey })(modelId) as unknown as LanguageModel;
        case "google":
            return createGoogleGenerativeAI({ apiKey })(modelId) as unknown as LanguageModel;
        case "deepseek":
            return createDeepSeek({ apiKey })(modelId) as unknown as LanguageModel;
    }
}
