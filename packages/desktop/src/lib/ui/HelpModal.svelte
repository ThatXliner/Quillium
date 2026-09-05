<!-- HelpModal.svelte — A tabbed reference guide with concrete examples. -->
<script lang="ts" module>
export type HelpTab = {
    id: string;
    label: string;
    description: string;
    scenario: string;
    examples: { label: string; response: string; explanation?: string }[];
    guidance: string;
};
</script>

<script lang="ts">
import { Tabs } from "bits-ui";
import { X } from "lucide-svelte";
import { untrack } from "svelte";

const {
    title,
    tabs,
    initialTab,
    footer,
    onclose,
}: {
    title: string;
    tabs: HelpTab[];
    initialTab: string;
    footer: string;
    onclose: () => void;
} = $props();

const id = $props.id();
let activeTab = $state(untrack(() => initialTab));
let dialogEl = $state<HTMLDialogElement>();

function closeGuide(): void {
    dialogEl?.close();
    // Clear the parent immediately; a queued native close event could dismiss a reopened guide.
    onclose();
}

$effect(() => {
    const dialog = dialogEl;
    if (!dialog) return;
    dialog.showModal();
    return () => dialog.close();
});
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<dialog
    bind:this={dialogEl}
    aria-labelledby={`${id}-title`}
    class="help-modal"
    oncancel={(event) => { event.preventDefault(); closeGuide(); }}
    onclick={(event) => { if (event.target === event.currentTarget) closeGuide(); }}
    onkeydown={(event) => {
        // Escape belongs to this dialog, not the sidebar behind it.
        if (event.key === "Escape") event.stopPropagation();
    }}
>
    <div class="flex max-h-[85dvh] w-[620px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl bg-gray-50 shadow-xl">
        <div class="flex shrink-0 items-center justify-between border-b border-black/[0.06] px-5 py-3.5">
            <h2 id={`${id}-title`} class="text-sm font-semibold text-black/80">{title}</h2>
            <button
                type="button"
                onclick={closeGuide}
                aria-label="Close guide"
                class="flex size-7 items-center justify-center rounded-full text-black/50 hover:text-black/70 hover:bg-black/5 transition-colors focus-visible:outline-2 focus-visible:outline-blue-500"
            >
                <X size={16} aria-hidden="true" />
            </button>
        </div>
        <Tabs.Root bind:value={activeTab} class="flex min-h-0 flex-col">
            <Tabs.List aria-label={`${title} topics`} class="flex shrink-0 gap-1 overflow-x-auto border-b border-black/[0.06] px-4 py-2">
                {#each tabs as tab (tab.id)}
                    <Tabs.Trigger
                        value={tab.id}
                        class="shrink-0 rounded-lg px-3 py-2 text-xs font-medium text-black/60 transition-colors hover:bg-black/5 data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700 focus-visible:outline-2 focus-visible:outline-blue-500"
                    >
                        {tab.label}
                    </Tabs.Trigger>
                {/each}
            </Tabs.List>
            {#each tabs as tab (tab.id)}
                <Tabs.Content value={tab.id} class="overflow-y-auto px-5 py-4 text-[13px] leading-relaxed text-black/75 focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-blue-500">
                    <p>{tab.description}</p>
                    <div class="mt-4 rounded-xl border border-black/[0.06] bg-black/[0.025] px-4 py-3">
                        <h3 class="text-xs font-semibold text-black/80">Example</h3>
                        <p class="mt-1 whitespace-pre-line">{tab.scenario}</p>
                    </div>
                    <div class="mt-5 space-y-5">
                        {#each tab.examples as example}
                            <section>
                                <h3 class="font-semibold text-black/85">{example.label}</h3>
                                <blockquote class="mt-2 whitespace-pre-line border-l-2 border-blue-200 pl-3 text-black/80">{example.response}</blockquote>
                                {#if example.explanation}
                                    <p class="mt-2 text-xs text-black/65">{example.explanation}</p>
                                {/if}
                            </section>
                        {/each}
                    </div>
                    <div class="mt-5 border-t border-black/[0.06] pt-4">
                        <h3 class="text-xs font-semibold text-black/80">When to use it</h3>
                        <p class="mt-1">{tab.guidance}</p>
                    </div>
                    <p class="mt-4 text-xs text-black/60">{footer}</p>
                    <p class="mt-2 text-[11px] text-black/55">Illustrative examples. Responses depend on your writing, request, and other AI settings.</p>
                </Tabs.Content>
            {/each}
        </Tabs.Root>
    </div>
</dialog>

<style>
    .help-modal {
        border: none;
        padding: 0;
        background: transparent;
        width: 100vw;
        height: 100dvh;
        max-width: 100vw;
        max-height: 100dvh;
    }

    .help-modal[open] {
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .help-modal::backdrop {
        background: rgba(0, 0, 0, 0.25);
        backdrop-filter: blur(4px);
    }
</style>
