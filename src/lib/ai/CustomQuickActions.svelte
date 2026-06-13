<script lang="ts">
import {
    ChevronDownIcon,
    ChevronRightIcon,
    SlidersHorizontalIcon,
    SparklesIcon,
} from "lucide-svelte";

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
              hover: "hover:bg-green-50 hover:border-green-200/80",
              icon: "bg-green-100 text-green-700",
              text: "text-green-700",
              toggle: "border-green-200/70 bg-green-50/70 hover:bg-green-50",
              ring: "focus:ring-green-500",
          }
        : theme === "purple"
          ? {
                border: "border-purple-100",
                hover: "hover:bg-purple-50 hover:border-purple-200/80",
                icon: "bg-purple-100 text-purple-700",
                text: "text-purple-700",
                toggle: "border-purple-200/70 bg-purple-50/70 hover:bg-purple-50",
                ring: "focus:ring-purple-500",
            }
          : {
                border: "border-blue-100",
                hover: "hover:bg-blue-50 hover:border-blue-200/80",
                icon: "bg-blue-100 text-blue-700",
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
                class="inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold shadow-sm transition-colors
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
                <div class="mt-2 grid gap-1.5 rounded-lg border border-black/10 bg-white/70 p-1.5 shadow-sm">
                    {#each prompts as { label, prompt }}
                        <button
                            type="button"
                            onclick={() => choose(prompt)}
                            {disabled}
                            class="group flex w-full items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-left transition-all
                                disabled:opacity-50 disabled:cursor-not-allowed {palette.hover}
                                focus:outline-none focus:ring-2 {palette.ring}"
                        >
                            <SparklesIcon size={12} class="shrink-0 {palette.text}" />
                            <span class="min-w-0 flex-1 truncate text-xs font-medium text-black/70">{label}</span>
                            <ChevronRightIcon
                                size={12}
                                class="shrink-0 text-black/25 transition-transform group-hover:translate-x-0.5 group-hover:text-black/45"
                            />
                        </button>
                    {/each}
                </div>
            {/if}
        </div>
    {:else}
        <div class="mb-2 flex flex-wrap gap-2">
            {#each prompts as { label, prompt }}
                <button
                    type="button"
                    onclick={() => choose(prompt)}
                    {disabled}
                    class="group inline-flex max-w-full items-center gap-2 rounded-full border bg-white/75 px-2.5 py-1.5 text-left text-xs shadow-sm transition-all
                        disabled:opacity-50 disabled:cursor-not-allowed {palette.hover} {palette.border}
                        focus:outline-none focus:ring-2 {palette.ring}"
                >
                    <span class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full {palette.icon}">
                        <SparklesIcon size={12} />
                    </span>
                    <span class="min-w-0 truncate font-semibold text-black/75">{label}</span>
                    <ChevronRightIcon
                        size={12}
                        class="shrink-0 text-black/25 transition-transform group-hover:translate-x-0.5 group-hover:text-black/45"
                    />
                </button>
            {/each}
        </div>
    {/if}
{/if}
