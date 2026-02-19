<script lang="ts">
    export const MODEL_OPTIONS = [
        {
            id: "gpt-4o",
            label: "GPT-4o",
            description: "Most capable, slower",
        },
        {
            id: "gpt-4o-mini",
            label: "GPT-4o Mini",
            description: "Fast and efficient",
        },
        {
            id: "o3-mini",
            label: "o3 Mini",
            description: "Advanced reasoning",
        },
    ];

    const STORAGE_KEY = "quillium-ai-model";

    function loadModel(): string {
        if (typeof localStorage === "undefined") return "gpt-4o-mini";
        return localStorage.getItem(STORAGE_KEY) ?? "gpt-4o-mini";
    }

    let selectedModel = $state(loadModel());

    function selectModel(id: string) {
        selectedModel = id;
        localStorage.setItem(STORAGE_KEY, id);
    }

    export function getSelectedModel(): string {
        if (typeof localStorage === "undefined") return "gpt-4o-mini";
        return localStorage.getItem(STORAGE_KEY) ?? "gpt-4o-mini";
    }
</script>

<div class="flex flex-col gap-5 p-4 overflow-y-auto">
    <div>
        <p class="text-xs font-semibold text-black/40 uppercase tracking-wider mb-3">
            AI Model
        </p>
        <div class="flex flex-col gap-2">
            {#each MODEL_OPTIONS as option}
                <button
                    onclick={() => selectModel(option.id)}
                    class="flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors
                        {selectedModel === option.id
                            ? 'bg-white/70 shadow-sm border border-black/8'
                            : 'hover:bg-white/40 border border-transparent'}"
                >
                    <div class="flex-1 min-w-0">
                        <div class="text-sm font-medium text-black/80 leading-tight">
                            {option.label}
                        </div>
                        <div class="text-xs text-black/40 mt-0.5">
                            {option.description}
                        </div>
                    </div>
                    {#if selectedModel === option.id}
                        <div class="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0"></div>
                    {/if}
                </button>
            {/each}
        </div>
    </div>

    <div class="w-full h-px bg-black/8"></div>

    <div>
        <p class="text-xs font-semibold text-black/40 uppercase tracking-wider mb-1">
            Applied to
        </p>
        <p class="text-xs text-black/50 leading-relaxed">
            Chat, Feedback, and Revise all use the selected model.
        </p>
    </div>
</div>
