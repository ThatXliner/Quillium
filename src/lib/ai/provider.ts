/**
 * Provider abstraction layer.
 *
 * This file decouples the rest of the AI subsystem from any specific LLM
 * vendor. Every streaming function in `clientStreams.ts` and the chat
 * factory (`chatFactory.ts`) call `createModel` to obtain a generic
 * `LanguageModel` — the only place where vendor SDKs are imported.
 *
 * Supported backends: OpenAI, Anthropic, Google (Gemini).
 *
 * Data flow:
 *   aiSettings.provider / .apiKey / .model  -->  createModel()  -->  LanguageModel
 *
 * To add a new provider, install its @ai-sdk/* package, extend the
 * `Provider` union, and add a case to the switch in `createModel`.
 */
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";

export type Provider = "openai" | "anthropic" | "google";

/**
 * Instantiate a vendor-specific LanguageModel for the given provider.
 *
 * Each vendor SDK follows the same two-step pattern:
 *   1. Create a provider instance with the user's API key.
 *   2. Call it with the model ID to get a LanguageModel.
 */
export function createModel(provider: Provider, apiKey: string, modelId: string): LanguageModel {
    switch (provider) {
        case "openai":
            return createOpenAI({ apiKey })(modelId) as LanguageModel;
        case "anthropic":
            return createAnthropic({ apiKey })(modelId) as unknown as LanguageModel;
        case "google":
            return createGoogleGenerativeAI({ apiKey })(modelId) as unknown as LanguageModel;
    }
}
