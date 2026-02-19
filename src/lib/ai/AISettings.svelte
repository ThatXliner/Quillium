<script lang="ts">
    import { invoke } from "@tauri-apps/api/core";
    import { EyeIcon, EyeOffIcon, CheckIcon } from "lucide-svelte";
    import { aiSettings, loadApiKeyForProvider } from "$lib/ai/settings.svelte";
    import type { Provider } from "$lib/ai/provider";

    const PROVIDERS: { id: Provider; label: string; color: string }[] = [
        { id: "openai", label: "OpenAI", color: "#10a37f" },
        { id: "anthropic", label: "Anthropic", color: "#d97706" },
        { id: "google", label: "Google", color: "#4285f4" },
    ];

    const MODEL_OPTIONS: Record<
        Provider,
        { id: string; label: string; description: string }[]
    > = {
        openai: [
            { id: "gpt-4o", label: "GPT-4o", description: "Most capable" },
            { id: "gpt-4o-mini", label: "GPT-4o Mini", description: "Fast and efficient" },
            { id: "o3-mini", label: "o3 Mini", description: "Advanced reasoning" },
        ],
        anthropic: [
            { id: "claude-opus-4-6", label: "Claude Opus 4.6", description: "Most capable" },
            { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", description: "Fast and capable" },
            { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", description: "Fastest, most compact" },
        ],
        google: [
            { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash", description: "Fast multimodal" },
            { id: "gemini-2.0-flash-lite", label: "Gemini 2.0 Flash Lite", description: "Most efficient" },
            { id: "gemini-2.5-pro-preview-03-25", label: "Gemini 2.5 Pro", description: "Most capable" },
        ],
    };

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

    let selectedProvider = $state<Provider>(loadProvider());
    let selectedModel = $state(loadModel());
    let apiKey = $state("");
    let showKey = $state(false);
    let saveStatus = $state<"idle" | "saved" | "error">("idle");
    let saveTimer: ReturnType<typeof setTimeout>;

    $effect(() => {
        const provider = selectedProvider;
        invoke<string | null>("get_api_key", { provider })
            .then((key) => { apiKey = key ?? ""; })
            .catch(() => { apiKey = ""; });
    });

    function selectProvider(id: Provider) {
        selectedProvider = id;
        localStorage.setItem(PROVIDER_KEY, id);
        const first = MODEL_OPTIONS[id][0];
        selectedModel = first.id;
        localStorage.setItem(MODEL_KEY, first.id);
        aiSettings.provider = id;
        aiSettings.model = first.id;
        loadApiKeyForProvider(id).then(() => {
            apiKey = aiSettings.apiKey;
        });
    }

    function selectModel(id: string) {
        selectedModel = id;
        localStorage.setItem(MODEL_KEY, id);
        aiSettings.model = id;
    }

    async function saveApiKey() {
        clearTimeout(saveTimer);
        try {
            if (apiKey.trim()) {
                await invoke("set_api_key", { provider: selectedProvider, key: apiKey.trim() });
                aiSettings.apiKey = apiKey.trim();
            } else {
                await invoke("delete_api_key", { provider: selectedProvider });
                aiSettings.apiKey = "";
            }
            saveStatus = "saved";
        } catch {
            saveStatus = "error";
        }
        saveTimer = setTimeout(() => { saveStatus = "idle"; }, 2000);
    }
</script>

<div class="flex flex-col gap-4 p-3 overflow-y-auto h-full">
    <!-- Provider -->
    <div>
        <p class="text-[10px] font-semibold text-black/40 uppercase tracking-wider mb-2">
            Provider
        </p>
        <div class="flex gap-1.5">
            {#each PROVIDERS as provider}
                {@const active = selectedProvider === provider.id}
                <button
                    onclick={() => selectProvider(provider.id)}
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

    <div class="w-full h-px bg-black/8"></div>

    <!-- Model -->
    <div>
        <p class="text-[10px] font-semibold text-black/40 uppercase tracking-wider mb-2">
            Model
        </p>
        <div class="flex flex-col gap-1">
            {#each MODEL_OPTIONS[selectedProvider] as option}
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
    </div>

    <div class="w-full h-px bg-black/8"></div>

    <!-- API Key -->
    <div>
        <p class="text-[10px] font-semibold text-black/40 uppercase tracking-wider mb-2">
            API Key
        </p>
        <div class="flex flex-col gap-1.5">
            <div class="flex items-center gap-1.5 rounded-lg bg-white/50 border border-black/10 px-2.5 py-2 focus-within:border-blue-400 transition-colors">
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
            </div>
            <button
                onclick={saveApiKey}
                class="flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg text-xs font-medium transition-colors
                    {saveStatus === 'saved'
                        ? 'bg-green-500/15 text-green-700'
                        : saveStatus === 'error'
                          ? 'bg-red-500/15 text-red-700'
                          : 'bg-blue-500/15 text-blue-700 hover:bg-blue-500/25'}"
            >
                {#if saveStatus === "saved"}
                    <CheckIcon size={12} />
                    Saved to keychain
                {:else if saveStatus === "error"}
                    Failed to save
                {:else}
                    Save to keychain
                {/if}
            </button>
        </div>
        <p class="text-[10px] text-black/35 mt-1.5 leading-relaxed">
            Stored securely in your system keychain.
        </p>
    </div>
</div>
