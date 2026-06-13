<script lang="ts">
import { ChevronDownIcon, ChevronRightIcon, SlidersHorizontalIcon } from "lucide-svelte";
import { settingsOpen } from "$lib/stores";

type QuickAction = {
    label: string;
    prompt: string;
};

type Theme = "blue" | "green" | "purple";
type Panel = "chat" | "feedback" | "revise";

const {
    prompts,
    disabled = false,
    compact = false,
    theme = "blue",
    panel = "chat",
    onPrompt,
}: {
    prompts: QuickAction[];
    disabled?: boolean;
    compact?: boolean;
    theme?: Theme;
    panel?: Panel;
    onPrompt: (prompt: string) => void | Promise<void>;
} = $props();

let expanded = $state(false);

const palette = $derived(
    theme === "green"
        ? {
              border: "border-green-100",
              hover: "hover:bg-green-50 hover:border-green-200/80",
              link: "text-green-700 hover:text-green-800 hover:bg-green-50",
              text: "text-green-700",
              toggle: "border-green-200/70 bg-green-50/70 hover:bg-green-50",
              ring: "focus:ring-green-500",
          }
        : theme === "purple"
          ? {
                border: "border-purple-100",
                hover: "hover:bg-purple-50 hover:border-purple-200/80",
                link: "text-purple-700 hover:text-purple-800 hover:bg-purple-50",
                text: "text-purple-700",
                toggle: "border-purple-200/70 bg-purple-50/70 hover:bg-purple-50",
                ring: "focus:ring-purple-500",
            }
          : {
                border: "border-blue-100",
                hover: "hover:bg-blue-50 hover:border-blue-200/80",
                link: "text-blue-700 hover:text-blue-800 hover:bg-blue-50",
                text: "text-blue-700",
                toggle: "border-blue-200/70 bg-blue-50/70 hover:bg-blue-50",
                ring: "focus:ring-blue-500",
            },
);

function choose(prompt: string) {
    if (compact) expanded = false;
    onPrompt(prompt);
}

function openQuickActionSettings() {
    settingsOpen.set(`quick-actions:${panel}`);
}
</script>

{#if prompts.length > 0}
    {#if compact}
        <div class="mb-2 pt-1">
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
                    <div class="flex items-center justify-between gap-2 px-1 pb-0.5">
                        <span class="text-[10px] font-medium text-black/35">Your custom chips</span>
                        <button
                            type="button"
                            onclick={openQuickActionSettings}
                            class="rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors {palette.link}
                                focus:outline-none focus:ring-2 {palette.ring}"
                        >
                            Settings
                        </button>
                    </div>
                    {#each prompts as { label, prompt }}
                        <button
                            type="button"
                            onclick={() => choose(prompt)}
                            {disabled}
                            class="group flex w-full items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-left transition-all
                                disabled:opacity-50 disabled:cursor-not-allowed {palette.hover}
                                focus:outline-none focus:ring-2 {palette.ring}"
                        >
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
        <div class="mb-2 pt-2">
            <div class="mb-1.5 flex items-center justify-between gap-2">
                <span class="text-[10px] font-medium text-black/35">Your custom chips</span>
                <button
                    type="button"
                    onclick={openQuickActionSettings}
                    class="rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors {palette.link}
                        focus:outline-none focus:ring-2 {palette.ring}"
                >
                    Edit in settings
                </button>
            </div>
            <div class="flex flex-wrap gap-2">
                {#each prompts as { label, prompt }}
                    <button
                        type="button"
                        onclick={() => choose(prompt)}
                        {disabled}
                        class="group inline-flex max-w-full items-center gap-1.5 rounded-full border bg-white/75 px-2.5 py-1.5 text-left text-xs shadow-sm transition-all
                            disabled:opacity-50 disabled:cursor-not-allowed {palette.hover} {palette.border}
                            focus:outline-none focus:ring-2 {palette.ring}"
                    >
                        <span class="min-w-0 truncate font-semibold text-black/75">{label}</span>
                        <ChevronRightIcon
                            size={12}
                            class="shrink-0 text-black/25 transition-transform group-hover:translate-x-0.5 group-hover:text-black/45"
                        />
                    </button>
                {/each}
            </div>
        </div>
    {/if}
{/if}
