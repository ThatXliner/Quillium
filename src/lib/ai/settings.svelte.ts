import { invoke } from "@tauri-apps/api/core";
import type { Provider } from "./provider";

const PROVIDER_KEY = "quillium-ai-provider";
const MODEL_KEY = "quillium-ai-model";

function loadProvider(): Provider {
    if (typeof localStorage === "undefined") return "openai";
    return (localStorage.getItem(PROVIDER_KEY) as Provider) ?? "openai";
}

function loadModel(): string {
    if (typeof localStorage === "undefined") return "gpt-4o-mini";
    return localStorage.getItem(MODEL_KEY) ?? "gpt-4o-mini";
}

export const aiSettings = $state({
    provider: loadProvider() as Provider,
    model: loadModel(),
    apiKey: "",
});

export async function loadApiKeyForProvider(provider: Provider) {
    try {
        const key = await invoke<string | null>("get_api_key", { provider });
        aiSettings.apiKey = key ?? "";
    } catch {
        aiSettings.apiKey = "";
    }
}

// Load key for the current provider on startup
if (typeof window !== "undefined") {
    loadApiKeyForProvider(aiSettings.provider);
}
