<script lang="ts">
import { ChevronDownIcon, SlidersHorizontalIcon } from "lucide-svelte";

type QuickAction = {
    label: string;
    prompt: string;
};

type Theme = "blue" | "green" | "purple";

const {
    prompts,
    disabled = false,
    compact = false,
    theme = "blue",
    onPrompt,
}: {
    prompts: QuickAction[];
    disabled?: boolean;
    compact?: boolean;
    theme?: Theme;
    onPrompt: (prompt: string) => void | Promise<void>;
} = $props();

let expanded = $state(false);

const palette = $derived(
    theme === "green"
        ? {
              border: "border-green-100",
              hover: "hover:bg-green-50",
              text: "text-green-700",
              toggle: "border-green-200/70 bg-green-50/70 hover:bg-green-50",
              ring: "focus:ring-green-500",
          }
        : theme === "purple"
          ? {
                border: "border-purple-100",
                hover: "hover:bg-purple-50",
                text: "text-purple-700",
                toggle: "border-purple-200/70 bg-purple-50/70 hover:bg-purple-50",
                ring: "focus:ring-purple-500",
            }
          : {
                border: "border-blue-100",
                hover: "hover:bg-blue-50",
                text: "text-blue-700",
                toggle: "border-blue-200/70 bg-blue-50/70 hover:bg-blue-50",
                ring: "focus:ring-blue-500",
            },
);

function choose(prompt: string) {
    if (compact) expanded = false;
    onPrompt(prompt);
}
</script>

{#if prompts.length > 0}
    {#if compact}
        <div class="mb-2">
            <button
                type="button"
                onclick={() => (expanded = !expanded)}
                {disabled}
                aria-expanded={expanded}
                class="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-colors
                    disabled:opacity-45 disabled:cursor-not-allowed {palette.toggle} {palette.text}
                    focus:outline-none focus:ring-2 {palette.ring}"
            >
                <SlidersHorizontalIcon size={13} />
                <span>Actions</span>
                <ChevronDownIcon
                    size={12}
                    class="transition-transform {expanded ? 'rotate-180' : ''}"
                />
            </button>
            {#if expanded}
                <div class="mt-2 flex flex-wrap gap-1.5">
                    {#each prompts as { label, prompt }}
                        <button
                            type="button"
                            onclick={() => choose(prompt)}
                            {disabled}
                            class="px-2 py-1 text-xs bg-white rounded border transition-all disabled:opacity-50 disabled:cursor-not-allowed {palette.hover} {palette.border}"
                        >
                            {label}
                        </button>
                    {/each}
                </div>
            {/if}
        </div>
    {:else}
        <div class="mb-2 flex flex-wrap gap-1.5">
            {#each prompts as { label, prompt }}
                <button
                    type="button"
                    onclick={() => choose(prompt)}
                    {disabled}
                    class="px-2 py-1 text-xs bg-white rounded border transition-all disabled:opacity-50 disabled:cursor-not-allowed {palette.hover} {palette.border}"
                >
                    {label}
                </button>
            {/each}
        </div>
    {/if}
{/if}
