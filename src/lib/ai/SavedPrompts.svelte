<script lang="ts">
    import {
        PlusIcon,
        PencilIcon,
        TrashIcon,
        CheckIcon,
        XIcon,
    } from "lucide-svelte";
    import {
        savedPrompts,
        addPrompt,
        updatePrompt,
        deletePrompt,
        type PromptMode,
    } from "./promptStore.svelte";

    interface Props {
        mode: PromptMode;
        onuse: (text: string) => void;
    }

    let { mode, onuse }: Props = $props();

    // Editing state
    let isAdding = $state(false);
    let editingId = $state<string | null>(null);
    let newLabel = $state("");
    let newText = $state("");
    let editLabel = $state("");
    let editText = $state("");

    const prompts = $derived(savedPrompts[mode]);

    // Precomputed color classes to avoid dynamic Tailwind purging
    const colors = {
        chat: {
            rowBorder: "border-blue-100",
            rowHover: "hover:bg-blue-50",
            rowText: "text-blue-700",
            formBorder: "border-blue-200",
            inputRing: "focus:ring-blue-400",
            actionBtn: "text-blue-600 hover:bg-blue-50",
            addBtn: "border-blue-200 text-blue-500 hover:bg-blue-50",
        },
        feedback: {
            rowBorder: "border-green-100",
            rowHover: "hover:bg-green-50",
            rowText: "text-green-700",
            formBorder: "border-green-200",
            inputRing: "focus:ring-green-400",
            actionBtn: "text-green-600 hover:bg-green-50",
            addBtn: "border-green-200 text-green-500 hover:bg-green-50",
        },
        revise: {
            rowBorder: "border-purple-100",
            rowHover: "hover:bg-purple-50",
            rowText: "text-purple-700",
            formBorder: "border-purple-200",
            inputRing: "focus:ring-purple-400",
            actionBtn: "text-purple-600 hover:bg-purple-50",
            addBtn: "border-purple-200 text-purple-500 hover:bg-purple-50",
        },
    } as const;

    const c = $derived(colors[mode]);

    function startAdd() {
        isAdding = true;
        editingId = null;
        newLabel = "";
        newText = "";
    }

    function cancelAdd() {
        isAdding = false;
        newLabel = "";
        newText = "";
    }

    function confirmAdd() {
        if (!newLabel.trim() || !newText.trim()) return;
        addPrompt(mode, newLabel.trim(), newText.trim());
        isAdding = false;
        newLabel = "";
        newText = "";
    }

    function startEdit(id: string, label: string, text: string) {
        editingId = id;
        isAdding = false;
        editLabel = label;
        editText = text;
    }

    function cancelEdit() {
        editingId = null;
    }

    function confirmEdit(id: string) {
        if (!editLabel.trim() || !editText.trim()) return;
        updatePrompt(mode, id, editLabel.trim(), editText.trim());
        editingId = null;
    }
</script>

<div class="space-y-1">
    {#each prompts as prompt (prompt.id)}
        {#if editingId === prompt.id}
            <!-- Inline edit form -->
            <div
                class="rounded-lg border bg-white p-2 space-y-1.5 {c.formBorder}"
            >
                <input
                    bind:value={editLabel}
                    placeholder="Label (short name)"
                    class="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:ring-1 {c.inputRing}"
                    autocomplete="off"
                />
                <textarea
                    bind:value={editText}
                    placeholder="Prompt text"
                    rows="2"
                    class="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:ring-1 {c.inputRing} resize-none"
                ></textarea>
                <div class="flex gap-1 justify-end">
                    <button
                        onclick={cancelEdit}
                        class="p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                        title="Cancel"
                    >
                        <XIcon size={12} />
                    </button>
                    <button
                        onclick={() => confirmEdit(prompt.id)}
                        disabled={!editLabel.trim() || !editText.trim()}
                        class="p-1 rounded transition-colors disabled:opacity-40 {c.actionBtn}"
                        title="Save"
                    >
                        <CheckIcon size={12} />
                    </button>
                </div>
            </div>
        {:else}
            <!-- Saved prompt row -->
            <div
                class="group flex items-center gap-1 rounded border bg-white transition-colors {c.rowBorder} {c.rowHover}"
            >
                <button
                    onclick={() => onuse(prompt.text)}
                    class="flex-1 px-2 py-1.5 text-left text-xs truncate {c.rowText}"
                    title={prompt.text}
                >
                    {prompt.label}
                </button>
                <div
                    class="flex items-center gap-0.5 pr-1 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                    <button
                        onclick={() =>
                            startEdit(prompt.id, prompt.label, prompt.text)}
                        class="p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-white/70 transition-colors"
                        title="Edit prompt"
                    >
                        <PencilIcon size={11} />
                    </button>
                    <button
                        onclick={() => deletePrompt(mode, prompt.id)}
                        class="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-white/70 transition-colors"
                        title="Delete prompt"
                    >
                        <TrashIcon size={11} />
                    </button>
                </div>
            </div>
        {/if}
    {/each}

    {#if isAdding}
        <!-- Inline add form -->
        <div
            class="rounded-lg border bg-white p-2 space-y-1.5 {c.formBorder}"
        >
            <input
                bind:value={newLabel}
                placeholder="Label (short name)"
                class="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:ring-1 {c.inputRing}"
                autocomplete="off"
            />
            <textarea
                bind:value={newText}
                placeholder="Prompt text"
                rows="2"
                class="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:ring-1 {c.inputRing} resize-none"
            ></textarea>
            <div class="flex gap-1 justify-end">
                <button
                    onclick={cancelAdd}
                    class="p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                    title="Cancel"
                >
                    <XIcon size={12} />
                </button>
                <button
                    onclick={confirmAdd}
                    disabled={!newLabel.trim() || !newText.trim()}
                    class="p-1 rounded transition-colors disabled:opacity-40 {c.actionBtn}"
                    title="Add prompt"
                >
                    <CheckIcon size={12} />
                </button>
            </div>
        </div>
    {:else}
        <button
            onclick={startAdd}
            class="flex w-full items-center gap-1 rounded border border-dashed px-2 py-1.5 text-xs transition-colors {c.addBtn}"
        >
            <PlusIcon size={11} />
            Add saved prompt
        </button>
    {/if}
</div>
