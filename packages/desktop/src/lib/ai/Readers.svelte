<!--
    Readers.svelte — Reader persona configuration panel (rose theme).

    Displays a scrollable list of persona cards (builtin + custom),
    each with an emoji-in-colored-circle avatar, toggle switch,
    and per-persona chattiness dots. Clicking a card expands it into
    a personality profile. Includes a "Create custom reader"
    form at the bottom.

    Dependencies: readers/settings.svelte.ts, readers/presets.ts, posthog.
-->
<script lang="ts">
import { collegeState } from "$lib/college/state.svelte";
import CollegeContext from "$lib/college/CollegeContext.svelte";
import posthog from "$lib/posthog";
import { lightTint, mediumTint } from "$lib/readers/colors";
import {
    addCustomPersona,
    cycleChattiness,
    readersSettings,
    getEffectivePersonas,
    removeCustomPersona,
    togglePersona,
} from "$lib/readers/settings.svelte";
import type { SidebarPanelProps } from "$lib/sidebar/panels";
import { Plus, Trash2 } from "lucide-svelte";
import { slide } from "svelte/transition";

// Built-in request adapters retain their existing lifecycle and validated operations.
let { active: _active, session: _session }: SidebarPanelProps = $props();

let showCreateForm = $state(false);
let expandedId = $state<string | null>(null);
let newName = $state("");
let newEmoji = $state("📝");
let newColor = $state("#6b7280");
let newInstruction = $state("");

const enabledPersonas = $derived(getEffectivePersonas().filter((p) => p.enabled));
const disabledPersonas = $derived(getEffectivePersonas().filter((p) => !p.enabled));

const colorSwatches = [
    "#ef4444",
    "#f59e0b",
    "#22c55e",
    "#3b82f6",
    "#8b5cf6",
    "#ec4899",
    "#6366f1",
    "#f97316",
    "#6b7280",
    "#14b8a6",
];

function handleToggle(id: string) {
    togglePersona(id);
    posthog.capture("reader_persona_toggled", { persona: id });
}

function handleCycleChattiness(id: string) {
    cycleChattiness(id);
    posthog.capture("reader_chattiness_changed", { persona: id });
}

function handleCreate() {
    if (!newName.trim() || !newInstruction.trim()) return;
    addCustomPersona({
        name: newName.trim(),
        emoji: newEmoji || "📝",
        color: newColor,
        description: newInstruction.trim(),
        instruction: newInstruction.trim(),
        enabled: true,
        chattiness: "quiet",
    });
    posthog.capture("reader_persona_created", { name: newName.trim() });
    newName = "";
    newEmoji = "📝";
    newColor = "#6b7280";
    newInstruction = "";
    showCreateForm = false;
}

function handleRemove(id: string) {
    removeCustomPersona(id);
    posthog.capture("reader_persona_removed", { persona: id });
}

const chattinessLevels = ["quiet", "normal", "verbose"] as const;
</script>

<CollegeContext />

{#snippet personaCard(persona: typeof readersSettings.personas[0], dimmed: boolean)}
    {@const filledDots = chattinessLevels.indexOf(persona.chattiness) + 1}
    {@const isExpanded = expandedId === persona.id}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        class="flex flex-col rounded-lg cursor-pointer transition-all duration-200 bg-white"
        class:opacity-55={dimmed && !isExpanded}
        class:hover:opacity-70={dimmed && !isExpanded}
        class:hover:bg-gray-50={!isExpanded}
        style="border-left: 3px solid {dimmed && !isExpanded ? '#d1d5db' : persona.color};"
        onclick={() => (expandedId = isExpanded ? null : persona.id)}
    >
        <!-- Collapsed row -->
        <div class="flex items-center gap-2 p-2.5">
            <div
                class="shrink-0 rounded-full flex items-center justify-center transition-all duration-200"
                class:w-7={!isExpanded}
                class:h-7={!isExpanded}
                class:text-sm={!isExpanded}
                class:w-10={isExpanded}
                class:h-10={isExpanded}
                class:text-xl={isExpanded}
                style="background: {lightTint(persona.color)}; border: 1.5px solid {mediumTint(persona.color)};"
            >
                {persona.emoji}
            </div>
            <div class="flex-1 min-w-0">
                <div
                    class="font-semibold text-gray-800 truncate transition-all duration-200"
                    class:text-xs={!isExpanded}
                    class:text-sm={isExpanded}
                >{persona.name}</div>
                {#if !isExpanded}
                    <div class="text-[10px] text-gray-400 truncate">{persona.description}</div>
                {/if}
            </div>
            <div class="flex items-center gap-1.5" onclick={(e) => e.stopPropagation()}>
                <button
                    onclick={() => handleCycleChattiness(persona.id)}
                    title="Detail level: {persona.chattiness}"
                    aria-label="Detail level: {persona.chattiness}"
                    class="flex gap-0.5 items-center cursor-pointer bg-transparent border-none p-0.5"
                >
                    {#each { length: 3 } as _, i}
                        <div
                            class="w-1 h-1 rounded-full transition-colors"
                            style="background: {i < filledDots
                                ? (dimmed && !isExpanded ? '#9ca3af' : '#f59e0b')
                                : '#e5ddd3'};"
                        ></div>
                    {/each}
                </button>
                <button
                    onclick={() => handleToggle(persona.id)}
                    aria-label="{persona.enabled ? 'Disable' : 'Enable'} {persona.name}"
                    class="w-7 h-4 rounded-full relative cursor-pointer border-none transition-colors"
                    class:bg-amber-400={persona.enabled}
                    class:bg-gray-300={!persona.enabled}
                >
                    <span
                        class="absolute top-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-all duration-150"
                        class:right-0.5={persona.enabled}
                        class:left-0.5={!persona.enabled}
                    ></span>
                </button>
                {#if !persona.builtin}
                    <button
                        onclick={() => handleRemove(persona.id)}
                        class="p-0.5 text-gray-300 hover:text-red-400 transition-colors bg-transparent border-none cursor-pointer"
                        title="Remove custom reader"
                    >
                        <Trash2 size={12} />
                    </button>
                {/if}
            </div>
        </div>

        <!-- Expanded personality profile -->
        {#if isExpanded}
            <div
                transition:slide={{ duration: 150 }}
                class="px-3 pb-4 space-y-3"
            >
                <div class="h-px" style="background: {lightTint(persona.color)};"></div>
                <div class="text-[10px] text-gray-400 italic">{persona.description}</div>
                {#if persona.profile}
                    <p class="text-[11px] text-gray-600 leading-relaxed m-0">
                        {persona.profile.about}
                    </p>
                    <div>
                        <div class="text-[9px] font-semibold text-gray-400 uppercase tracking-wider my-2">Good for</div>
                        <div class="flex flex-wrap gap-1">
                            {#each persona.profile.goodFor as tag}
                                <span
                                    class="text-[10px] px-1.5 py-0.5 rounded-full"
                                    style="background: {lightTint(persona.color)}; color: {persona.color};"
                                >{tag}</span>
                            {/each}
                        </div>
                    </div>
                    <div>
                        <div class="text-[9px] font-semibold text-gray-400 uppercase tracking-wider my-2">Example</div>
                        <p class="text-[10px] text-gray-500 italic leading-snug m-0">
                            {persona.profile.example}
                        </p>
                    </div>
                {:else}
                    <p class="text-[11px] text-gray-600 leading-relaxed m-0">
                        {persona.description}
                    </p>
                {/if}
            </div>
        {/if}
    </div>
{/snippet}

<div class="flex-1 flex flex-col min-h-0" inert={collegeState.hostEnabled && (collegeState.saving || ["loading", "error", "unsupported"].includes(collegeState.status))}>
    <div class="px-3 pt-1.5 pb-1 text-[10px] text-gray-400">
        Dots control how much detail each reader gives in their feedback.
        Turn personas on per mode (the toggle in Feedback / Revise) to use them —
        they run one reply per reader, so they cost more tokens.
    </div>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- Persona list -->
    <div class="flex-1 overflow-y-auto p-2 space-y-1" onclick={(e) => {
        if (e.target === e.currentTarget) expandedId = null;
    }}>
        {#each enabledPersonas as persona (persona.id)}
            {@render personaCard(persona, false)}
        {/each}

        {#if enabledPersonas.length > 0 && disabledPersonas.length > 0}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="h-px bg-gray-200 my-1" onclick={() => (expandedId = null)}></div>
        {/if}

        {#each disabledPersonas as persona (persona.id)}
            {@render personaCard(persona, true)}
        {/each}
    </div>

    <div class="border-t border-black/10 p-2">
        {#if showCreateForm}
            <div class="space-y-2 p-2 bg-white rounded-lg">
                <input
                    bind:value={newName}
                    placeholder="Reader name"
                    class="w-full px-2 py-1.5 text-xs border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-rose-400"
                    maxlength={30}
                />
                <div class="flex gap-2">
                    <input
                        bind:value={newEmoji}
                        placeholder="📝"
                        class="w-12 px-2 py-1.5 text-xs text-center border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-rose-400"
                        maxlength={2}
                    />
                    <div class="flex gap-1 items-center flex-wrap flex-1">
                        {#each colorSwatches as swatch}
                            <button
                                onclick={() => (newColor = swatch)}
                                aria-label="Select color {swatch}"
                                class="w-4 h-4 rounded-full border-2 cursor-pointer"
                                style="background: {swatch}; border-color: {newColor === swatch ? '#1f2937' : 'transparent'};"
                            ></button>
                        {/each}
                    </div>
                </div>
                <textarea
                    bind:value={newInstruction}
                    placeholder="What should this reader focus on? (e.g., 'looks for technical inaccuracies and missing citations')"
                    class="w-full px-2 py-1.5 text-xs border border-gray-200 rounded resize-none focus:outline-none focus:ring-1 focus:ring-rose-400"
                    rows={3}
                ></textarea>
                <div class="flex gap-2">
                    <button
                        onclick={handleCreate}
                        disabled={!newName.trim() || !newInstruction.trim()}
                        class="flex-1 py-1.5 text-xs font-medium bg-rose-500 text-white rounded hover:bg-rose-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >Save</button>
                    <button
                        onclick={() => (showCreateForm = false)}
                        class="flex-1 py-1.5 text-xs text-gray-500 rounded hover:bg-gray-100 transition-colors"
                    >Cancel</button>
                </div>
            </div>
        {:else}
            <button
                onclick={() => (showCreateForm = true)}
                class="w-full py-1.5 rounded-lg border border-dashed border-gray-300 bg-transparent text-gray-400 text-xs cursor-pointer hover:border-gray-400 hover:text-gray-500 transition-colors"
            >
                <Plus size={12} class="inline -mt-0.5" /> Create custom reader
            </button>
        {/if}
    </div>

    <div class="px-3 pb-2 text-[10px] text-center text-gray-400">
        Selected readers provide feedback via Feedback & Revise
    </div>
</div>
