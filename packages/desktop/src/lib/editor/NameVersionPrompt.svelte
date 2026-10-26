<!-- NameVersionPrompt.svelte — A focused checkpoint prompt for the active editor. -->
<script lang="ts">
import { ModalResizeHandles, RestoreSizeButton } from "@quillium/share";
import { onMount } from "svelte";
import { toast } from "svelte-sonner";

const { save, onclose }: {
    save: (label: string) => Promise<number | null>;
    onclose: () => void;
} = $props();
let dialog: HTMLDialogElement;
let input: HTMLInputElement;
let label = $state("");
let saving = $state(false);
let error = $state("");

onMount(() => {
    dialog.showModal();
    input.focus();
});

async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (saving || !label.trim()) return;
    saving = true;
    error = "";
    try {
        const id = await save(label.trim());
        if (id === null) {
            error = "The active draft changed. Close this prompt and try again.";
            return;
        }
        toast.success("Version saved");
        onclose();
    } catch (cause) {
        console.error("[NameVersionPrompt] save failed", cause);
        error = "Could not save this version. Check that your changes are saved and try again.";
    } finally {
        saving = false;
    }
}

let restoreSize = $state<(() => void) | undefined>();
</script>

<dialog
    bind:this={dialog}
    aria-labelledby="name-version-title"
    class="open:flex flex-col overflow-hidden m-auto w-[360px] max-w-[calc(100vw-2rem)] rounded-2xl border border-white/40 bg-gray-200 p-6 text-black/80 shadow-xl backdrop:bg-black/25 backdrop:backdrop-blur-sm"
    oncancel={(event) => { event.preventDefault(); if (!saving) onclose(); }}
    onkeydown={(event) => { event.stopPropagation(); }}
>
    <form onsubmit={submit} class="min-h-0 overflow-y-auto flex flex-col gap-4">
        <div class="flex min-h-[26px] items-center justify-between gap-2">
            <h2 id="name-version-title" class="text-sm font-semibold">Name this version</h2>
            <RestoreSizeButton {restoreSize} />
        </div>
        <label class="flex flex-col gap-2 text-xs">
            Version name
            <input bind:this={input} bind:value={label} disabled={saving} placeholder="Before revising the opening"
                class="rounded-lg border border-black/15 bg-white/80 px-3 py-2 text-sm outline-blue-500" />
        </label>
        {#if error}<p role="alert" class="text-xs text-red-700">{error}</p>{/if}
        <div class="flex justify-end gap-2">
            <button type="button" onclick={onclose} disabled={saving}
                class="rounded-full px-4 py-2 text-xs hover:bg-white/50 disabled:opacity-50">Cancel</button>
            <button type="submit" disabled={saving || !label.trim()}
                class="rounded-full bg-blue-600 px-4 py-2 text-xs text-white hover:bg-blue-700 disabled:opacity-50">
                {saving ? "Saving…" : "Save"}
            </button>
        </div>
    </form>
    <ModalResizeHandles bind:restoreSize minHeight={160} />
</dialog>
