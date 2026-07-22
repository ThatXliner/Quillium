<script lang="ts">
interface Props {
    version: string;
    installing?: boolean;
    ready?: boolean;
    masMode?: boolean;
    error?: string;
    oninstall: () => void;
    ondismiss: () => void;
}

let {
    version,
    installing = false,
    ready = false,
    masMode = false,
    error = "",
    oninstall,
    ondismiss,
}: Props = $props();

let label = $derived(
    masMode
        ? "Open App Store"
        : installing
          ? ready
              ? "Relaunching\u2026"
              : "Downloading\u2026"
          : ready
            ? "Relaunch"
            : error
              ? "Try Again"
              : "Update",
);
</script>

<div
    class="fixed right-4 bottom-4 z-50 flex max-w-[34rem] items-center gap-3 rounded-xl border border-black/[0.07] bg-white px-4 py-3 text-[13px] shadow-xl"
>
    <div class="flex min-w-0 flex-1 flex-col gap-1">
        <span class="text-black/60"
            >Quillium <span class="font-semibold text-black/80">{version}</span> {!masMode && ready
                ? "is ready — relaunch to finish"
                : "is available"}</span
        >
        {#if error}
            <span role="alert" class="text-xs leading-relaxed text-red-700">{error}</span>
        {/if}
    </div>
    <button
        onclick={oninstall}
        disabled={!masMode && installing}
        class="shrink-0 rounded-full bg-blue-500 px-3 py-1 text-[12px] font-medium text-white transition-colors hover:bg-blue-600 disabled:opacity-50"
    >{label}</button>
    <button
        onclick={ondismiss}
        class="shrink-0 text-black/25 transition-colors hover:text-black/50"
        aria-label="Dismiss"
    >✕</button>
</div>
