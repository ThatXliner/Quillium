<script lang="ts">
interface Props {
    version: string;
    installing?: boolean;
    ready?: boolean;
    masMode?: boolean;
    oninstall: () => void;
    ondismiss: () => void;
}

let {
    version,
    installing = false,
    ready = false,
    masMode = false,
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
            : "Update",
);
</script>

<div class="fixed bottom-4 right-4 z-50 flex items-center gap-3 px-4 py-3 bg-[color:var(--surface)] rounded-xl shadow-xl border border-[color:var(--border)] text-[13px]">
    <span class="text-[color:var(--text-soft)]">Quillium <span class="font-semibold text-[color:var(--text)]">{version}</span> {!masMode && ready ? "is ready — relaunch to finish" : "is available"}</span>
    <button
        onclick={oninstall}
        disabled={!masMode && installing}
        class="px-3 py-1 bg-[color:var(--chip-blue)] hover:bg-[color:var(--chip-blue-strong)] text-[color:var(--accent-blue-text)] rounded-full text-[12px] font-medium transition-colors disabled:opacity-50"
    >{label}</button>
    <button
        onclick={ondismiss}
        class="text-[color:var(--text-ghost)] hover:text-[color:var(--text-soft)] transition-colors"
        aria-label="Dismiss"
    >✕</button>
</div>
