<!--
AISettings.svelte — Provider, model, and API key configuration panel.

This component lets the writer choose their LLM provider (OpenAI,
Anthropic, Google), select a model, and manage their API key. It
writes directly to the global `aiSettings` reactive object in
settings.svelte.ts, which is read by chatFactory.ts at send-time.

API key lifecycle:
- On mount / provider switch: loaded from the system keychain via
  Tauri's `get_api_key` command (the `$effect` block).
- On save: stored to the keychain via `set_api_key`, or deleted
  via `delete_api_key` if the field is cleared.

State variables:
`selectedProvider` — current provider, synced to localStorage.
`selectedModel` — current model ID, synced to localStorage.
`apiKey` — local copy of the key (reactive input bind).
`keyLoading` — true while fetching the key from keychain.
`showKey` — toggle password/text visibility.
`saveStatus` — idle | saved | error (controls button label).
`useCustomEndpoint` — when true, switches OpenAI to openai-compatible
  mode with a custom base URL and freeform model input.

The `$effect` block watches `selectedProvider` and re-fetches the
API key from the keychain whenever the provider changes.

Dependencies: settings.svelte.ts (aiSettings, loadApiKeyForProvider),
provider.ts (Provider type), Tauri invoke API, posthog.
-->
<script lang="ts">
import ModelGuideModal from "$lib/ai/ModelGuideModal.svelte";
import { disconnectOpenAI, getStoredOpenAISession, signInWithChatGPT } from "$lib/ai/openaiOAuth";
import type { Provider } from "$lib/ai/provider";
import {
    HAS_API_KEY_KEY,
    aiSettings,
    hasApiKey,
    loadApiKeyForProvider,
    persistBaseUrl,
    resetApiKeyLoadPromise,
} from "$lib/ai/settings.svelte";
import { stopAutoAI } from "$lib/autoai/engine";
import { autoAISettings, persistAutoAISettings } from "$lib/autoai/settings.svelte";
import posthog, { captureException } from "$lib/posthog";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { CheckIcon, EyeIcon, EyeOffIcon, InfoIcon, KeyRoundIcon } from "lucide-svelte";

type TabProvider = "openai" | "anthropic" | "google" | "deepseek";

const PROVIDERS: { id: TabProvider; label: string }[] = [
    { id: "openai", label: "OpenAI" },
    { id: "anthropic", label: "Anthropic" },
    { id: "google", label: "Google" },
    { id: "deepseek", label: "DeepSeek" },
];

let showModelGuide = $state(false);

const MODEL_OPTIONS: Record<TabProvider, { id: string; label: string; description: string }[]> = {
    openai: [
        { id: "gpt-5.5", label: "GPT-5.5", description: "Most capable" },
        {
            id: "gpt-5.4-mini",
            label: "GPT-5.4 Mini",
            description: "Fast and efficient",
        },
        { id: "gpt-5.4-nano", label: "GPT-5.4 Nano", description: "Fastest, most cost-efficient" },
    ],
    anthropic: [
        {
            id: "claude-opus-4-8",
            label: "Claude Opus 4.8",
            description: "Most capable",
        },
        {
            id: "claude-sonnet-4-6",
            label: "Claude Sonnet 4.6",
            description: "Fast and capable",
        },
        {
            id: "claude-haiku-4-5-20251001",
            label: "Claude Haiku 4.5",
            description: "Fastest, most compact",
        },
    ],
    google: [
        {
            id: "gemini-3.5-flash",
            label: "Gemini 3.5 Flash",
            description: "Most intelligent Flash",
        },
        {
            id: "gemini-3.1-pro-preview",
            label: "Gemini 3.1 Pro",
            description: "Most capable",
        },
        {
            id: "gemini-3-flash-preview",
            label: "Gemini 3 Flash",
            description: "Fast and capable",
        },
    ],
    deepseek: [
        {
            id: "deepseek-v4-pro",
            label: "DeepSeek V4 Pro",
            description: "Most capable, strongest reasoning",
        },
        {
            id: "deepseek-v4-flash",
            label: "DeepSeek V4 Flash",
            description: "Fast and cost-efficient",
        },
    ],
};

const PROVIDER_KEY = "quillium-ai-provider";
const MODEL_KEY = "quillium-ai-model";

function loadTabProvider(): TabProvider {
    if (typeof localStorage === "undefined") return "openai";
    const stored = localStorage.getItem(PROVIDER_KEY) ?? "openai";
    // OpenAI's alternate connection modes all live under the OpenAI tab.
    // with the custom endpoint toggle enabled.
    if (stored === "openai-codex" || stored === "openai-compatible" || stored === "openai-oauth") {
        return "openai";
    }
    if (stored === "anthropic" || stored === "google" || stored === "deepseek") return stored;
    return "openai";
}

function loadUseCustomEndpoint(): boolean {
    if (typeof localStorage === "undefined") return false;
    const stored = localStorage.getItem(PROVIDER_KEY);
    return stored === "openai-compatible" || stored === "openai-codex" || stored === "openai-oauth";
}

function loadUseChatGPT(): boolean {
    if (typeof localStorage === "undefined") return false;
    return localStorage.getItem(PROVIDER_KEY) === "openai-oauth";
}

function loadModel(): string {
    if (typeof localStorage === "undefined") return "gpt-5.5";
    return localStorage.getItem(MODEL_KEY) ?? "gpt-5.5";
}

let selectedTab = $state<TabProvider>(loadTabProvider());
let useCustomEndpoint = $state(loadUseCustomEndpoint());
let useChatGPT = $state(loadUseChatGPT());
let selectedModel = $state(loadModel());
let baseUrl = $state(aiSettings.baseURL);

let apiKey = $state(aiSettings.apiKey);
let keyLoading = $state(!aiSettings.apiKey);
let showKey = $state(false);
let saveStatus = $state<"idle" | "saved" | "error">("idle");
let saveTimer: ReturnType<typeof setTimeout>;
let canSave = $derived(!!apiKey.trim() || hasApiKey());

function initialOAuthStatus(): "checking" | "signed-out" {
    return loadUseChatGPT() ? "checking" : "signed-out";
}

let oauthStatus = $state<"checking" | "signed-out" | "starting" | "signed-in" | "error">(
    initialOAuthStatus(),
);
let oauthError = $state("");

let effectiveProvider = $derived<Provider>(
    selectedTab === "openai" && useChatGPT
        ? "openai-oauth"
        : selectedTab === "openai" && useCustomEndpoint
          ? "openai-compatible"
          : selectedTab,
);

$effect(() => {
    const provider = effectiveProvider;
    aiSettings.provider = provider;
    localStorage.setItem(PROVIDER_KEY, provider);
    if (provider === "openai-oauth") {
        keyLoading = false;
        return;
    }
});

$effect(() => {
    if (!useChatGPT) return;
    let cancelled = false;
    getStoredOpenAISession()
        .then((session) => {
            if (!cancelled) oauthStatus = session ? "signed-in" : "signed-out";
        })
        .catch((error) => {
            if (cancelled) return;
            oauthStatus = "error";
            oauthError = String(error);
        });
    return () => {
        cancelled = true;
    };
});

$effect(() => {
    const provider = effectiveProvider;
    // OAuth sessions have their own keychain entry and lifecycle. Loading that
    // entry through the API-key path would put serialized tokens in apiSettings.
    if (provider === "openai-oauth") {
        keyLoading = false;
        return;
    }
    // Only query the keychain if the user has previously saved an API key
    // (avoids the keychain prompt before AI is configured).
    if (!localStorage.getItem(HAS_API_KEY_KEY)) {
        keyLoading = false;
        return;
    }
    let cancelled = false;
    keyLoading = true;
    invoke<string | null>("get_api_key", { provider })
        .then((key) => {
            if (cancelled) return;
            apiKey = key ?? "";
            aiSettings.apiKey = apiKey;
        })
        .catch((e) => {
            if (cancelled) return;
            console.error("get_api_key error:", e);
            captureException(e);
            apiKey = "";
        })
        .finally(() => {
            if (!cancelled) keyLoading = false;
        });
    return () => {
        cancelled = true;
    };
});

function selectTab(id: TabProvider) {
    selectedTab = id;
    if (id !== "openai") {
        useCustomEndpoint = false;
        useChatGPT = false;
    }
    const first = MODEL_OPTIONS[id][0];
    selectedModel = first.id;
    localStorage.setItem(MODEL_KEY, first.id);
    aiSettings.model = first.id;
    posthog.capture("ai_settings_provider_changed", { provider: effectiveProvider });
}

function selectOpenAIConnection(connection: "api" | "endpoint" | "chatgpt") {
    useCustomEndpoint = connection !== "api";
    useChatGPT = connection === "chatgpt";
    if (connection === "api") {
        // Reset to first OpenAI model.
        const first = MODEL_OPTIONS.openai[0];
        selectedModel = first.id;
        localStorage.setItem(MODEL_KEY, first.id);
        aiSettings.model = first.id;
    }
    if (useChatGPT && !selectedModel.trim()) selectModel("gpt-5.4-mini");
    const provider =
        connection === "api" ? "openai" : useChatGPT ? "openai-oauth" : "openai-compatible";
    posthog.capture("ai_settings_provider_changed", { provider });
}

async function toggleChatGPTSignIn() {
    oauthError = "";
    if (oauthStatus === "signed-in") {
        try {
            await disconnectOpenAI();
            oauthStatus = "signed-out";
        } catch (error) {
            oauthStatus = "error";
            oauthError = String(error);
        }
        return;
    }
    oauthStatus = "starting";
    try {
        await signInWithChatGPT();
        oauthStatus = "signed-in";
    } catch (error) {
        oauthStatus = "error";
        oauthError = String(error);
        captureException(error);
    }
}

function selectModel(id: string) {
    selectedModel = id;
    localStorage.setItem(MODEL_KEY, id);
    aiSettings.model = id;
    posthog.capture("ai_settings_model_changed", {
        provider: effectiveProvider,
        model: id,
    });
}

function updateBaseUrl(url: string) {
    baseUrl = url;
    persistBaseUrl(url.trim());
}

let saveError = $state("");

async function saveApiKey() {
    clearTimeout(saveTimer);
    saveError = "";
    try {
        if (apiKey.trim()) {
            await invoke("set_api_key", {
                provider: effectiveProvider,
                key: apiKey.trim(),
            });
            aiSettings.apiKey = apiKey.trim();
            localStorage.setItem(HAS_API_KEY_KEY, "1");
        } else {
            await invoke("delete_api_key", { provider: effectiveProvider });
            aiSettings.apiKey = "";
            localStorage.removeItem(HAS_API_KEY_KEY);
            resetApiKeyLoadPromise();
            if (autoAISettings.enabled) {
                autoAISettings.enabled = false;
                persistAutoAISettings();
                stopAutoAI();
            }
        }
        saveStatus = "saved";
    } catch (e) {
        saveStatus = "error";
        saveError = String(e);
        console.error("saveApiKey failed:", e);
        captureException(e);
    }
    saveTimer = setTimeout(() => {
        saveStatus = "idle";
    }, 3000);
}
</script>

<div class="flex flex-col gap-4 p-3 overflow-y-auto h-full">
    <!-- No API key banner -->
    {#if !hasApiKey() && !keyLoading}
        <div class="flex items-start gap-2 rounded-lg bg-amber-50/80 border border-amber-200/60 px-3 py-2.5">
            <KeyRoundIcon size={13} class="text-amber-500 shrink-0 mt-0.5" />
            <p class="text-[11px] text-amber-700/90 leading-snug">
                {useChatGPT
                    ? "Connect your ChatGPT account to enable Chat, Feedback, and Revise."
                    : "Add an API key below to enable Chat, Feedback, and Revise."}
            </p>
        </div>
    {/if}

    <!-- Provider -->
    <div>
        <div class="flex items-center gap-1.5 mb-2">
            <p class="text-[10px] font-semibold text-black/40 uppercase tracking-wider">
                Provider
            </p>
            <button
                onclick={() => (showModelGuide = true)}
                aria-label="Which model should I use?"
                title="Which model should I use?"
                class="text-black/25 hover:text-black/55 transition-colors"
            >
                <InfoIcon size={12} />
            </button>
        </div>
        <div class="flex gap-1.5">
            {#each PROVIDERS as provider}
                {@const active = selectedTab === provider.id}
                <button
                    onclick={() => selectTab(provider.id)}
                    title={provider.label}
                    class="flex flex-1 items-center justify-center gap-1.5 py-2 rounded-lg transition-all duration-200 ease-out
                        {active
                        ? 'bg-white/70 shadow-sm border border-black/8 px-2.5'
                        : 'hover:bg-white/40 border border-transparent px-2 opacity-50 hover:opacity-80'}"
                >
                    <div class="w-[18px] h-[18px] shrink-0 flex items-center justify-center">
                        {#if provider.id === "openai"}
                            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" class="text-[#10a37f]">
                                <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z"/>
                            </svg>
                        {:else if provider.id === "anthropic"}
                            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" class="text-[#d97706]">
                                <path d="M13.827 3.52h3.603L24 20h-3.603l-6.57-16.48zm-7.258 0h3.767L16.906 20h-3.674l-1.343-3.461H5.017L3.674 20H0L6.569 3.52zm4.132 9.959L8.453 7.687 6.205 13.48h4.496z"/>
                            </svg>
                        {:else if provider.id === "google"}
                            <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
                                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                            </svg>
                        {:else if provider.id === "deepseek"}
                            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" class="text-[#4D6BFE]">
                                <path d="M23.748 4.482c-.254-.124-.364.113-.512.234-.051.039-.094.09-.137.136-.372.397-.806.657-1.373.626-.829-.046-1.537.214-2.163.848-.133-.782-.575-1.248-1.247-1.546-.352-.156-.708-.311-.955-.65-.172-.241-.219-.51-.305-.774-.055-.16-.11-.323-.293-.35-.2-.031-.278.136-.356.276-.313.572-.434 1.202-.422 1.84.027 1.436.633 2.58 1.838 3.393.137.093.172.187.129.323-.082.28-.18.552-.266.833-.055.179-.137.217-.329.14a5.526 5.526 0 0 1-1.736-1.18c-.857-.828-1.631-1.742-2.597-2.458a11.365 11.365 0 0 0-.689-.471c-.985-.957.13-1.743.388-1.836.27-.098.093-.432-.779-.428-.872.004-1.67.295-2.687.684a3.055 3.055 0 0 1-.465.137 9.597 9.597 0 0 0-2.883-.102c-1.885.21-3.39 1.102-4.497 2.623C.082 8.606-.231 10.684.152 12.85c.403 2.284 1.569 4.175 3.36 5.653 1.858 1.533 3.997 2.284 6.438 2.14 1.482-.085 3.133-.284 4.994-1.86.47.234.962.327 1.78.397.63.059 1.236-.03 1.705-.128.735-.156.684-.837.419-.961-2.155-1.004-1.682-.595-2.113-.926 1.096-1.296 2.746-2.642 3.392-7.003.05-.347.007-.565 0-.845-.004-.17.035-.237.23-.256a4.173 4.173 0 0 0 1.545-.475c1.396-.763 1.96-2.015 2.093-3.517.02-.23-.004-.467-.247-.588zM11.581 18c-2.089-1.642-3.102-2.183-3.52-2.16-.392.024-.321.471-.235.763.09.288.207.486.371.739.114.167.192.416-.113.603-.673.416-1.842-.14-1.897-.167-1.361-.802-2.5-1.86-3.301-3.307-.774-1.393-1.224-2.887-1.298-4.482-.02-.386.093-.522.477-.592a4.696 4.696 0 0 1 1.529-.039c2.132.312 3.946 1.265 5.468 2.774.868.86 1.525 1.887 2.202 2.891.72 1.066 1.494 2.082 2.48 2.914.348.292.625.514.891.677-.802.09-2.14.11-3.227-.827zm1-6.466a.306.306 0 0 1 .415-.287.302.302 0 0 1 .2.288.306.306 0 0 1-.31.307.303.303 0 0 1-.304-.308zm3.11 1.596c-.2.081-.399.151-.59.16a1.245 1.245 0 0 1-.798-.254c-.274-.23-.47-.358-.552-.758a1.73 1.73 0 0 1 .016-.588c.07-.327-.008-.537-.239-.727-.187-.156-.426-.199-.688-.199a.559.559 0 0 1-.254-.078c-.114-.054-.21-.19-.121-.366.028-.057.165-.193.197-.218.36-.205.776-.138 1.16.015.357.144.626.41 1.012.787.395.46.466.589.692.93.18.268.343.544.456.858.07.196-.018.357-.494.453z"/>
                            </svg>
                        {/if}
                    </div>
                    <span
                        class="text-xs font-medium text-black/70 overflow-hidden whitespace-nowrap transition-all duration-200 ease-out
                            {active ? 'max-w-[80px] opacity-100' : 'max-w-0 opacity-0'}"
                    >{provider.label}</span>
                </button>
            {/each}
        </div>
    </div>

    <!-- OpenAI connection method -->
    {#if selectedTab === "openai"}
        <div>
            <p class="text-[10px] font-semibold text-black/40 uppercase tracking-wider mb-2">
                Connection
            </p>
            <div class="grid grid-cols-3 gap-1 rounded-xl border border-black/8 bg-black/[0.035] p-1">
                <button
                    onclick={() => selectOpenAIConnection("api")}
                    class="rounded-lg px-1.5 py-2 text-[10px] font-medium transition-all
                        {!useCustomEndpoint
                        ? 'bg-white text-black/75 shadow-sm ring-1 ring-black/5'
                        : 'text-black/38 hover:text-black/60'}"
                >API key</button>
                <button
                    onclick={() => selectOpenAIConnection("endpoint")}
                    class="rounded-lg px-1.5 py-2 text-[10px] font-medium transition-all
                        {useCustomEndpoint && !useChatGPT
                        ? 'bg-white text-black/75 shadow-sm ring-1 ring-black/5'
                        : 'text-black/38 hover:text-black/60'}"
                >Local</button>
                <button
                    onclick={() => selectOpenAIConnection("chatgpt")}
                    class="rounded-lg px-1.5 py-2 text-[10px] font-medium transition-all
                        {useChatGPT
                        ? 'bg-white text-black/75 shadow-sm ring-1 ring-black/5'
                        : 'text-black/38 hover:text-black/60'}"
                >ChatGPT</button>
            </div>
            {#if useCustomEndpoint && !useChatGPT}
                <div class="mt-2 rounded-xl border border-black/8 bg-white/35 p-2.5">
                    <div>
                        <p class="text-[10px] font-semibold text-black/40 uppercase tracking-wider mb-1.5">
                            Base URL
                        </p>
                        <div class="flex items-center gap-1.5 rounded-lg bg-white/50 border border-black/10 px-2.5 py-2 focus-within:border-blue-400 transition-colors">
                            <input
                                type="text"
                                bind:value={baseUrl}
                                oninput={() => updateBaseUrl(baseUrl)}
                                placeholder="http://localhost:11434/v1"
                                class="flex-1 bg-transparent text-xs text-black/70 placeholder:text-black/25 outline-none font-mono"
                            />
                        </div>
                        <p class="text-[10px] text-black/35 mt-1 leading-relaxed">
                            OpenAI-compatible endpoint for Ollama, LM Studio, or another local server.
                        </p>
                    </div>
                </div>
            {/if}
        </div>
    {/if}

    <!-- Model -->
    <div>
        <p class="text-[10px] font-semibold text-black/40 uppercase tracking-wider mb-2">
            Model
        </p>
        {#if useCustomEndpoint}
            <div class="flex items-center gap-1.5 rounded-lg bg-white/50 border border-black/10 px-2.5 py-2 focus-within:border-blue-400 transition-colors">
                <input
                    type="text"
                    bind:value={selectedModel}
                    oninput={() => selectModel(selectedModel)}
                    placeholder="e.g. llama3, gpt-4o-mini"
                    class="flex-1 bg-transparent text-xs text-black/70 placeholder:text-black/25 outline-none font-mono"
                />
            </div>
            <p class="text-[10px] text-black/35 mt-1.5 leading-relaxed">
                Type the model ID your endpoint supports.
            </p>
        {:else}
            <div class="flex flex-col gap-1">
                {#each MODEL_OPTIONS[selectedTab] as option}
                    <button
                        onclick={() => selectModel(option.id)}
                        class="flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition-colors
                            {selectedModel === option.id
                            ? 'bg-white/70 shadow-sm border border-black/8'
                            : 'hover:bg-white/40 border border-transparent'}"
                    >
                        <div class="flex-1 min-w-0">
                            <div class="text-sm font-medium text-black/80 leading-tight">
                                {option.label}
                            </div>
                            <div class="text-xs text-black/40 mt-0.5">{option.description}</div>
                        </div>
                        {#if selectedModel === option.id}
                            <div class="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0"></div>
                        {/if}
                    </button>
                {/each}
            </div>
        {/if}
    </div>

    <!-- API Key -->
    {#if !useCustomEndpoint}
        <div>
            <p class="text-[10px] font-semibold text-black/40 uppercase tracking-wider mb-2">
                API Key
            </p>
            <div class="flex flex-col gap-1.5">
                <div class="flex items-center gap-1.5 rounded-lg bg-white/50 border border-black/10 px-2.5 py-2 focus-within:border-blue-400 transition-colors">
                    {#if keyLoading}
                        <span class="flex-1 text-xs text-black/30 font-mono animate-pulse">Loading…</span>
                    {:else}
                        <input
                            type={showKey ? "text" : "password"}
                            bind:value={apiKey}
                            placeholder="sk-..."
                            class="flex-1 bg-transparent text-xs text-black/70 placeholder:text-black/25 outline-none font-mono"
                        />
                        <button
                            onclick={() => (showKey = !showKey)}
                            class="text-black/30 hover:text-black/60 transition-colors shrink-0"
                            aria-label={showKey ? "Hide key" : "Show key"}
                        >
                            {#if showKey}
                                <EyeOffIcon size={13} />
                            {:else}
                                <EyeIcon size={13} />
                            {/if}
                        </button>
                    {/if}
                </div>
                <button
                    onclick={saveApiKey}
                    disabled={!canSave && !keyLoading}
                    class="flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg text-xs font-medium transition-colors
                        {saveStatus === 'saved'
                        ? 'bg-green-500/15 text-green-700'
                        : saveStatus === 'error'
                        ? 'bg-red-500/15 text-red-700'
                        : !canSave
                        ? 'bg-black/5 text-black/25 cursor-not-allowed'
                        : !apiKey.trim()
                        ? 'bg-red-500/15 text-red-700 hover:bg-red-500/25'
                        : 'bg-blue-500/15 text-blue-700 hover:bg-blue-500/25'}"
                >
                    {#if saveStatus === "saved"}
                        <CheckIcon size={12} />
                        {apiKey.trim() ? "Saved to keychain" : "Key removed"}
                    {:else if saveStatus === "error"}
                        Failed to save
                    {:else if !apiKey.trim() && hasApiKey()}
                        Remove key
                    {:else}
                        Save to keychain
                    {/if}
                </button>
            </div>
            {#if saveError}
                <p class="text-[10px] text-red-600/80 mt-1.5 leading-relaxed break-all">{saveError}</p>
            {:else}
                <p class="text-[10px] text-black/35 mt-1.5 leading-relaxed">
                    Stored securely in your system keychain.
                </p>
            {/if}
        </div>
    {:else if useChatGPT}
        <div class="rounded-xl border border-black/8 bg-white/45 p-3 shadow-sm">
            <p class="text-[10px] font-semibold text-black/40 uppercase tracking-wider mb-2">
                ChatGPT account
            </p>
            <button
                onclick={() => {
                    if (oauthStatus !== "signed-in") void toggleChatGPTSignIn();
                }}
                disabled={
                    oauthStatus === "checking" ||
                    oauthStatus === "starting" ||
                    oauthStatus === "signed-in"
                }
                class="flex items-center justify-center gap-2 w-full rounded-full border border-black/15 bg-white px-4 py-3 text-sm font-medium text-black/80 shadow-sm transition-colors hover:bg-black/[0.02] disabled:opacity-50"
            >
                {#if oauthStatus === "signed-in"}
                    <CheckIcon size={16} class="text-green-600" />
                    Connected to ChatGPT
                {:else if oauthStatus === "starting"}
                    Signing in…
                {:else if oauthStatus === "checking"}
                    Checking connection…
                {:else}
                    Sign in with ChatGPT
                {/if}
            </button>
            {#if oauthStatus === "signed-in"}
                <button
                    onclick={toggleChatGPTSignIn}
                    class="mt-2 w-full text-[10px] text-black/35 underline underline-offset-2 hover:text-black/60"
                >Disconnect account</button>
            {:else}
                <p class="text-[10px] text-black/35 mt-2 text-center leading-relaxed">
                    Opens ChatGPT in your browser. Credentials stay in your system keychain.
                </p>
            {/if}
            {#if oauthError}
                <p class="text-[10px] text-red-600/80 mt-1.5 leading-relaxed break-all">
                    {oauthError}
                </p>
            {/if}
        </div>
    {:else}
        <!-- Optional API Key for custom endpoint -->
        <div>
            <p class="text-[10px] font-semibold text-black/40 uppercase tracking-wider mb-2">
                API Key <span class="normal-case font-normal text-black/25">(optional)</span>
            </p>
            <div class="flex flex-col gap-1.5">
                <div class="flex items-center gap-1.5 rounded-lg bg-white/50 border border-black/10 px-2.5 py-2 focus-within:border-blue-400 transition-colors">
                    {#if keyLoading}
                        <span class="flex-1 text-xs text-black/30 font-mono animate-pulse">Loading…</span>
                    {:else}
                        <input
                            type={showKey ? "text" : "password"}
                            bind:value={apiKey}
                            placeholder="Optional, if your endpoint requires one"
                            oninput={() => (aiSettings.apiKey = apiKey)}
                            class="flex-1 bg-transparent text-xs text-black/70 placeholder:text-black/25 outline-none font-mono"
                        />
                        <button
                            onclick={() => (showKey = !showKey)}
                            class="text-black/30 hover:text-black/60 transition-colors shrink-0"
                            aria-label={showKey ? "Hide key" : "Show key"}
                        >
                            {#if showKey}
                                <EyeOffIcon size={13} />
                            {:else}
                                <EyeIcon size={13} />
                            {/if}
                        </button>
                    {/if}
                </div>
            </div>
            <p class="text-[10px] text-black/35 mt-1.5 leading-relaxed">
                Some endpoints don't require a key. If yours does, enter it here — it won't be stored in the keychain.
            </p>
        </div>
    {/if}

    <!-- Third-party notice -->
    <p class="text-[10px] text-black/30 leading-relaxed px-0.5">
        By using AI features, your writing is sent directly to
        {#if useCustomEndpoint}
            {#if useChatGPT}
                OpenAI through your ChatGPT account. This beta integration uses the unofficial
                openai-oauth package. Check OpenAI's terms and privacy policy.
            {:else}
                your custom endpoint. Check its terms and privacy policy.
            {/if}
        {:else if selectedTab === "openai"}
            OpenAI. You agree to their
            <button class="inline underline hover:text-black/50 transition-colors" onclick={() => openUrl("https://openai.com/policies/terms-of-use")}>terms of service</button> and <button class="inline underline hover:text-black/50 transition-colors" onclick={() => openUrl("https://openai.com/policies/privacy-policy")}>privacy policy</button>.
        {:else if selectedTab === "anthropic"}
            Anthropic. You agree to their
            <button class="inline underline hover:text-black/50 transition-colors" onclick={() => openUrl("https://www.anthropic.com/legal/consumer-terms")}>terms of service</button> and <button class="inline underline hover:text-black/50 transition-colors" onclick={() => openUrl("https://www.anthropic.com/legal/privacy")}>privacy policy</button>.
        {:else if selectedTab === "google"}
            Google. You agree to their
            <button class="inline underline hover:text-black/50 transition-colors" onclick={() => openUrl("https://ai.google.dev/gemini-api/terms")}>terms of service</button> and <button class="inline underline hover:text-black/50 transition-colors" onclick={() => openUrl("https://policies.google.com/privacy")}>privacy policy</button>.
        {:else if selectedTab === "deepseek"}
            DeepSeek. You agree to their
            <button class="inline underline hover:text-black/50 transition-colors" onclick={() => openUrl("https://cdn.deepseek.com/policies/en-US/deepseek-terms-of-use.html")}>terms of service</button> and <button class="inline underline hover:text-black/50 transition-colors" onclick={() => openUrl("https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html")}>privacy policy</button>.
        {/if}
    </p>
</div>

{#if showModelGuide}
    <ModelGuideModal onclose={() => (showModelGuide = false)} />
{/if}
