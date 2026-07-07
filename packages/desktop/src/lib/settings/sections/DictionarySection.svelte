<!--
    DictionarySection.svelte — Settings: personal dictionary word list.

    The word list is draft-only state owned by the modal (persisted on Save,
    reverted on discard), so it's bound here rather than owned here.
-->
<script lang="ts">
import { Plus, X } from "lucide-svelte";

let { words = $bindable() }: { words: string[] } = $props();

let newDictWord = $state("");

function removeWord(word: string) {
    words = words.filter((w) => w !== word);
}

function addDictWord() {
    const word = newDictWord.trim();
    if (!word || words.includes(word)) return;
    words = [...words, word];
    newDictWord = "";
}
</script>

<div class="section-label">Personal Dictionary</div>

{#if words.length > 0}
    <div class="flex flex-wrap gap-1.5 mb-2.5 px-0.5">
        {#each words.sort() as word}
            <span class="dict-word-chip">
                {word}
                <button
                    onclick={() => removeWord(word)}
                    aria-label="Remove {word} from dictionary"
                    class="dict-word-remove"
                ><X size={9} /></button>
            </span>
        {/each}
    </div>
{:else}
    <div class="text-[11px] text-black/30 px-0.5 mb-2.5">No custom words yet. Add words to skip spell-check on them.</div>
{/if}

<!-- Add word form -->
<div class="flex items-center gap-2 mb-1 px-0.5">
    <input
        bind:value={newDictWord}
        onkeydown={(e) => e.key === "Enter" && addDictWord()}
        placeholder="Add a word…"
        class="flex-1 px-2.5 py-1.5 text-[12px] border border-black/[0.1] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/40 placeholder:text-black/25"
    />
    <button
        onclick={addDictWord}
        disabled={!newDictWord.trim() || words.includes(newDictWord.trim())}
        class="flex items-center gap-1 px-2.5 py-1.5 text-[12px] font-medium
            bg-blue-500/80 text-white rounded-lg hover:bg-blue-600/80 transition-colors
            disabled:opacity-40 disabled:cursor-not-allowed"
    >
        <Plus size={12} />
        Add
    </button>
</div>
