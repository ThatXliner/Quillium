<!--
    Readers.svelte — Reader persona configuration panel (rose theme).

    Displays a scrollable list of persona cards (builtin + custom),
    each with an emoji-in-colored-circle avatar, toggle switch,
    and per-persona chattiness dots. Includes a "Create custom reader"
    form at the bottom.

    Dependencies: readers/settings.svelte.ts, readers/presets.ts, posthog.
-->
<script lang="ts">
import { Plus, Trash2 } from "lucide-svelte";
import {
    readersSettings,
    togglePersona,
    cycleChattiness,
    addCustomPersona,
    removeCustomPersona,
} from "$lib/readers/settings.svelte";
import { lightTint, mediumTint } from "$lib/readers/colors";
import posthog from "$lib/posthog";

let showCreateForm = $state(false);
let newName = $state("");
let newEmoji = $state("📝");
let newColor = $state("#6b7280");
let newInstruction = $state("");

const enabledPersonas = $derived(readersSettings.personas.filter((p) => p.enabled));
const disabledPersonas = $derived(readersSettings.personas.filter((p) => !p.enabled));

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

<div class="flex-1 flex flex-col min-h-0">
    <!-- Persona list -->
    <div class="flex-1 overflow-y-auto p-2 space-y-1">
        <!-- Enabled personas -->
        {#each enabledPersonas as persona (persona.id)}
            {@const filledDots = chattinessLevels.indexOf(persona.chattiness) + 1}
            <div
                class="flex items-center gap-2 p-2 bg-white rounded-lg"
                style="border-left: 3px solid {persona.color};"
            >
                <div
                    class="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm"
                    style="background: {lightTint(persona.color)}; border: 1.5px solid {mediumTint(persona.color)};"
                >
                    {persona.emoji}
                </div>
                <div class="flex-1 min-w-0">
                    <div class="text-xs font-semibold text-gray-800 truncate">{persona.name}</div>
                    <div class="text-[10px] text-gray-400 truncate">{persona.instruction.slice(0, 40)}…</div>
                </div>
                <div class="flex items-center gap-1.5">
                    <button
                        onclick={() => handleCycleChattiness(persona.id)}
                        title="Chattiness: {persona.chattiness}"
                        class="flex gap-0.5 items-center cursor-pointer bg-transparent border-none p-0.5"
                    >
                        {#each { length: 3 } as _, i}
                            <div
                                class="w-1 h-1 rounded-full"
                                style="background: {i < filledDots ? '#f59e0b' : '#e5ddd3'};"
                            ></div>
                        {/each}
                    </button>
                    <button
                        onclick={() => handleToggle(persona.id)}
                        class="w-7 h-4 rounded-full relative cursor-pointer border-none bg-amber-400"
                    >
                        <span class="absolute top-0.5 right-0.5 w-3 h-3 rounded-full bg-white shadow-sm"></span>
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
        {/each}

        {#if enabledPersonas.length > 0 && disabledPersonas.length > 0}
            <div class="h-px bg-gray-200 my-1"></div>
        {/if}

        {#each disabledPersonas as persona (persona.id)}
            <div class="flex items-center gap-2 p-2 bg-white rounded-lg opacity-55">
                <div
                    class="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm"
                    style="background: {lightTint(persona.color)}; border: 1.5px solid {mediumTint(persona.color)};"
                >
                    {persona.emoji}
                </div>
                <div class="flex-1 min-w-0">
                    <div class="text-xs font-semibold text-gray-800 truncate">{persona.name}</div>
                    <div class="text-[10px] text-gray-400 truncate">{persona.instruction.slice(0, 40)}…</div>
                </div>
                <div class="flex items-center gap-1.5">
                    <div class="flex gap-0.5 items-center opacity-40 p-0.5">
                        {#each { length: 3 } as _}
                            <div class="w-1 h-1 rounded-full bg-gray-300"></div>
                        {/each}
                    </div>
                    <button
                        onclick={() => handleToggle(persona.id)}
                        class="w-7 h-4 rounded-full relative cursor-pointer border-none bg-gray-300"
                    >
                        <span class="absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white shadow-sm"></span>
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
