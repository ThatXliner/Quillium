/**
 * Reactive AI settings store (Svelte 5 runes).
 *
 * This file is the single source of truth for all user-configurable AI
 * state. It owns three reactive objects:
 *
 * - `aiSettings` — provider, model ID, and API key (key loaded from
 *   the system keychain via Tauri at startup).
 * - `documentContext` — structured writing-context fields (goal, tone,
 *   audience, etc.) persisted to localStorage.
 * - `aiProcessing` — boolean flag consumed by the sidebar glow
 *   animation; toggled by each chat component via `setAiProcessing`.
 *
 * Persistence strategy:
 *   provider/model  -> localStorage
 *   API key         -> system keychain (via Tauri `get_api_key` /
 *                      `set_api_key` commands)
 *   documentContext -> localStorage
 *
 * Data flow:
 *   AISettings.svelte  -->  aiSettings / documentContext (writes)
 *   chatFactory.ts     <--  aiSettings (reads provider/model/key)
 *   clientStreams.ts    <--  documentContext (reads context fields)
 *   AISidebar.svelte    <--  aiProcessing (reads glow flag)
 */
import { invoke } from "@tauri-apps/api/core";
import type { Provider } from "./provider";
import { appEventBus } from "$lib/events/appEventBus";

const PROVIDER_KEY = "quillium-ai-provider";
const MODEL_KEY = "quillium-ai-model";
const BASE_URL_KEY = "quillium-ai-base-url";
const DOCUMENT_CONTEXT_KEY = "quillium-document-context";
export const HAS_API_KEY_KEY = "quillium-has-api-key";

export type DocumentContext = {
    freeform: string;
};

function loadDocumentContext(): DocumentContext {
    if (typeof localStorage === "undefined") return { freeform: "" };
    try {
        const stored = localStorage.getItem(DOCUMENT_CONTEXT_KEY);
        if (stored) return JSON.parse(stored);
    } catch {}
    return { freeform: "" };
}

export function saveDocumentContext() {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(DOCUMENT_CONTEXT_KEY, JSON.stringify(documentContext));
}

export const documentContext = $state<DocumentContext>(loadDocumentContext());

export function hasDocumentContext(): boolean {
    return documentContext.freeform.trim().length > 0;
}

// ---------------------------------------------------------------------------
// AI processing indicator — purely for UI feedback (e.g. sidebar glow).
// All AI chat components should call setAiProcessing(true/false) when their
// request starts/ends. To remove the glow effect, just stop reading this
// state in the UI — no need to touch individual components.
// ---------------------------------------------------------------------------
export const aiProcessing = $state({ active: false });

export function setAiProcessing(value: boolean) {
    aiProcessing.active = value;
}

/**
 * Wire up the standard processing-indicator and stop-listener effects
 * for a Chat instance. Must be called during component initialisation
 * (i.e. at the top-level of a Svelte component's `<script>` block) so
 * `$effect` has a valid owner.
 */
export function useAiChatEffects(chat: { status: string; stop: () => void }) {
    $effect(() => {
        setAiProcessing(chat.status === "submitted" || chat.status === "streaming");
    });

    $effect(() => {
        const unsub = appEventBus.on("stop-ai", () => {
            if (chat.status === "submitted" || chat.status === "streaming") {
                chat.stop();
            }
        });
        return unsub;
    });
}

/**
 * Global abort controller for all AI requests. Calling `stopAllAi()`
 * aborts any in-flight streams and emits an app event so each panel
 * can call `chat.stop()` on its own Chat instance.
 */
let _aiAbortController: AbortController | null = null;

export function getAiAbortSignal(): AbortSignal {
    if (!_aiAbortController) _aiAbortController = new AbortController();
    return _aiAbortController.signal;
}

export function stopAllAi() {
    if (_aiAbortController) {
        _aiAbortController.abort();
        _aiAbortController = null;
    }
    appEventBus.emit({ type: "stop-ai" });
    aiProcessing.active = false;
}

function loadString(key: string, defaultValue: string): string {
    if (typeof localStorage === "undefined") return defaultValue;
    return localStorage.getItem(key) ?? defaultValue;
}

function loadBaseUrl(): string {
    if (typeof localStorage === "undefined") return "";
    return localStorage.getItem(BASE_URL_KEY) ?? "";
}

export const aiSettings = $state({
    provider: loadString(PROVIDER_KEY, "openai") as Provider,
    model: loadString(MODEL_KEY, "gpt-4o-mini"),
    apiKey: "",
    baseURL: loadBaseUrl(),
});

export function hasApiKey(): boolean {
    if (aiSettings.provider === "openai-compatible") return true;
    if (aiSettings.apiKey.trim().length > 0) return true;
    // The key hasn't loaded from the keychain yet, but we know one
    // exists — avoid flashing "no API key" UI on startup.
    if (typeof localStorage !== "undefined" && !!localStorage.getItem(HAS_API_KEY_KEY)) {
        return true;
    }
    return false;
}

export async function loadApiKeyForProvider(provider: Provider) {
    try {
        const key = await invoke<string | null>("get_api_key", { provider });
        aiSettings.apiKey = key ?? "";
    } catch {
        aiSettings.apiKey = "";
    }
}

// Lazy-load the API key on first access rather than at module import
// time. This avoids triggering the macOS keychain permission prompt
// immediately on app startup — the prompt will only appear when the
// user actually interacts with AI features.
let _apiKeyLoadPromise: Promise<void> | null = null;

export function ensureApiKeyLoaded(): Promise<void> {
    if (_apiKeyLoadPromise) return _apiKeyLoadPromise;
    if (typeof window === "undefined" || !localStorage.getItem(HAS_API_KEY_KEY)) {
        return Promise.resolve();
    }
    _apiKeyLoadPromise = loadApiKeyForProvider(aiSettings.provider);
    return _apiKeyLoadPromise;
}

/**
 * Reset the cached API-key load promise so that the next call to
 * `ensureApiKeyLoaded()` will re-check localStorage / the keychain.
 * Called after the user deletes their API key.
 */
export function resetApiKeyLoadPromise() {
    _apiKeyLoadPromise = null;
}

export function persistBaseUrl(url: string) {
    if (typeof localStorage === "undefined") return;
    if (url) {
        localStorage.setItem(BASE_URL_KEY, url);
    } else {
        localStorage.removeItem(BASE_URL_KEY);
    }
    aiSettings.baseURL = url;
}
