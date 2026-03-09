<!--
    KeyboardShortcuts.svelte — Modal overlay listing all keyboard shortcuts.

    Shows a grouped cheat sheet of every keyboard shortcut in Quillium,
    adapted to the user's OS (⌘ on macOS, Ctrl on Windows/Linux).
    Closes on Escape or by clicking the backdrop.

    Props:
      - onclose: () => void — called when the modal should close
-->
<script lang="ts">
const { onclose }: { onclose: () => void } = $props();

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const mod = isMac ? "⌘" : "Ctrl";
const opt = isMac ? "⌥" : "Alt";

type Shortcut = { keys: string[]; label: string };
type Group = { title: string; shortcuts: Shortcut[] };

const groups: Group[] = [
    {
        title: "Navigation",
        shortcuts: [{ keys: [mod, "O"], label: "Open library" }],
    },
    {
        title: "AI Panels",
        shortcuts: [
            { keys: [mod, "⇧", "1"], label: "Open Chat" },
            { keys: [mod, "⇧", "2"], label: "Open Feedback" },
            { keys: [mod, "⇧", "3"], label: "Open Revise" },
            { keys: [mod, "⇧", "4"], label: "Open Document Context" },
            { keys: ["Esc"], label: "Close AI sidebar" },
        ],
    },
    {
        title: "Annotations",
        shortcuts: [
            { keys: [mod, opt, "M"], label: "Add comment" },
            { keys: [mod, opt, "K"], label: "Add revision" },
            { keys: [mod, "↵"], label: "Send reply / comment" },
        ],
    },
];

function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
        e.preventDefault();
        onclose();
    }
}
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- Backdrop -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
    class="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm"
    onclick={onclose}
>
    <!-- Panel -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        class="relative bg-gray-100 border border-white/60 shadow-2xl rounded-2xl p-6 w-[420px] max-w-[90vw]"
        onclick={(e) => e.stopPropagation()}
    >
        <div class="flex items-center justify-between mb-5">
            <h2 class="text-sm font-semibold text-black/70 tracking-wide uppercase">
                Keyboard Shortcuts
            </h2>
            <button
                onclick={onclose}
                class="text-black/30 hover:text-black/60 transition-colors text-lg leading-none"
                aria-label="Close"
            >×</button>
        </div>

        <div class="space-y-5">
            {#each groups as group}
                <div>
                    <h3 class="text-[10px] font-semibold text-black/40 uppercase tracking-widest mb-2">
                        {group.title}
                    </h3>
                    <div class="space-y-1.5">
                        {#each group.shortcuts as shortcut}
                            <div class="flex items-center justify-between">
                                <span class="text-sm text-black/70">{shortcut.label}</span>
                                <div class="flex items-center gap-1">
                                    {#each shortcut.keys as key, i}
                                        <kbd class="inline-flex items-center justify-center min-w-[24px] h-[22px] px-1.5 text-[11px] font-mono bg-white border border-black/15 shadow-sm rounded text-black/60">
                                            {key}
                                        </kbd>
                                        {#if i < shortcut.keys.length - 1}
                                            <span class="text-[10px] text-black/30">+</span>
                                        {/if}
                                    {/each}
                                </div>
                            </div>
                        {/each}
                    </div>
                </div>
            {/each}
        </div>

        <p class="mt-5 text-[10px] text-black/30 text-center">
            Press <kbd class="inline-flex items-center justify-center min-w-[24px] h-[18px] px-1 text-[10px] font-mono bg-white border border-black/15 shadow-sm rounded text-black/40">Esc</kbd> to close
        </p>
    </div>
</div>
