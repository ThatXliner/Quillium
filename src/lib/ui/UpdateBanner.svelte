<script lang="ts">
    interface Props {
        version: string;
        installing?: boolean;
        oninstall: () => void;
        ondismiss: () => void;
    }

    let { version, installing = false, oninstall, ondismiss }: Props = $props();
</script>

<div class="fixed bottom-4 right-4 z-50 flex items-center gap-3 px-4 py-3 bg-white rounded-xl shadow-xl border border-black/[0.07] text-[13px]">
    <span class="text-black/60">Quillium <span class="font-semibold text-black/80">{version}</span> is available</span>
    <button
        onclick={oninstall}
        disabled={installing}
        class="px-3 py-1 bg-blue-500 hover:bg-blue-600 text-white rounded-full text-[12px] font-medium transition-colors disabled:opacity-50"
    >{installing ? "Installing…" : "Update"}</button>
    <button
        onclick={ondismiss}
        class="text-black/25 hover:text-black/50 transition-colors"
        aria-label="Dismiss"
    >✕</button>
</div>
