<!--
    DraftDeleteModal.svelte — Orphan-vs-cascade prompt for deleting a draft
    that has children (iterations or branches under it).

    Only shown when the draft is NOT a leaf; a childless draft deletes
    straight away. Follows the app's hand-rolled overlay pattern
    (see ChangelogModal.svelte) and BRANDING.md.

    Props:
      label        — the draft being deleted (for the heading)
      descendants  — how many drafts would go with it on a cascade delete
      onorphan     — keep the children, re-attach them; delete only this draft
      oncascade    — delete this draft and its whole subtree
      oncancel     — dismiss without deleting
-->
<script lang="ts">
import { GitBranchIcon, Trash2Icon } from "lucide-svelte";

const {
    label,
    descendants,
    onorphan,
    oncascade,
    oncancel,
}: {
    label: string;
    descendants: number;
    onorphan: () => void;
    oncascade: () => void;
    oncancel: () => void;
} = $props();

// Total drafts a cascade removes (the draft itself plus its descendants).
const cascadeCount = $derived(descendants + 1);
</script>

<svelte:window
    onkeydown={(e) => {
        if (e.key === "Escape") {
            e.preventDefault();
            oncancel();
        }
    }}
/>

<div
    class="fixed inset-0 z-[9999]"
    role="dialog"
    aria-modal="true"
    aria-label="Delete draft"
>
    <button
        type="button"
        class="absolute inset-0 bg-black/55 border-0 p-0 cursor-default"
        aria-label="Cancel"
        tabindex="-1"
        onclick={oncancel}
    ></button>

    <div
        class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[420px] bg-white shadow-2xl rounded-2xl flex flex-col overflow-hidden border border-black/[0.06]"
        role="document"
    >
        <div class="px-7 pt-7 pb-5">
            <h3 class="text-xl font-bold text-black/85 leading-tight">
                Delete “{label}”?
            </h3>
            <p class="text-sm text-black/50 mt-2 leading-relaxed">
                This draft has {descendants}
                {descendants === 1 ? "draft" : "drafts"} under it. Keep them, or delete
                everything together? Either way you can undo right after.
            </p>
        </div>

        <div class="flex flex-col gap-2 px-7 pb-7">
            <button
                onclick={onorphan}
                class="flex items-start gap-3 w-full text-left rounded-xl border border-black/[0.08] px-4 py-3 hover:bg-black/[0.03] hover:border-black/15 transition-colors"
            >
                <GitBranchIcon size={18} class="shrink-0 mt-0.5 text-black/45" />
                <span class="min-w-0">
                    <span class="block text-sm font-medium text-black/80">Keep the children</span>
                    <span class="block text-xs text-black/45 mt-0.5">
                        Re-attach them so they live on without this draft.
                    </span>
                </span>
            </button>

            <button
                onclick={oncascade}
                class="flex items-start gap-3 w-full text-left rounded-xl border border-red-500/20 px-4 py-3 hover:bg-red-500/[0.04] hover:border-red-500/40 transition-colors"
            >
                <Trash2Icon size={18} class="shrink-0 mt-0.5 text-red-500/70" />
                <span class="min-w-0">
                    <span class="block text-sm font-medium text-red-600/90">
                        Delete all {cascadeCount}
                    </span>
                    <span class="block text-xs text-black/45 mt-0.5">
                        Remove this draft and everything under it.
                    </span>
                </span>
            </button>

            <button
                onclick={oncancel}
                class="self-end mt-1 px-3 py-1.5 text-sm text-black/45 hover:text-black/70 rounded-lg hover:bg-black/[0.04] transition-colors"
            >
                Cancel
            </button>
        </div>
    </div>
</div>
