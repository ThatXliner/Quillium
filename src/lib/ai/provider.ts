import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";

export type Provider = "openai" | "anthropic" | "google";

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
