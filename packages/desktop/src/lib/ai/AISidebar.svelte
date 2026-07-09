<!-- AISidebar.svelte — One Quillium surface with secondary configuration screens. -->
<script lang="ts">
import { aiProcessing, ensureApiKeyLoaded, hasApiKey, stopAllAi } from "$lib/ai/settings.svelte";
import { appEventBus } from "$lib/events/appEventBus";
import posthog from "$lib/posthog";
import { ArrowLeftIcon, SettingsIcon, SparklesIcon, SquareIcon, XIcon } from "lucide-svelte";
import AISettings from "./AISettings.svelte";
import DocumentContext from "./DocumentContext.svelte";
import EditorReview from "./EditorReview.svelte";
import Readers from "./Readers.svelte";

type Action = null | "editor" | "settings" | "context" | "readers";

let action = $state<Action>(null);
let container = $state<HTMLDivElement>();
const expanded = $derived(action !== null);
const panelTitles: Record<Exclude<Action, null>, string> = {
    editor: "Quillium",
    settings: "AI Settings",
    context: "Document Context",
    readers: "Reader Perspectives",
};

function open(actionToOpen: Exclude<Action, null>): void {
    ensureApiKeyLoaded();
    if (actionToOpen === "editor" && !hasApiKey()) {
        action = "settings";
        return;
    }
    action = actionToOpen;
    posthog.capture("ai_sidebar_opened", { mode: actionToOpen });
}

function handleClickOutside(event: MouseEvent): void {
    const target = event.target as Node;
    if (
        expanded &&
        container &&
        !container.contains(target) &&
        !(target as Element).closest?.(".cm-editor") &&
        !(target as Element).closest?.(".dictionary-popover") &&
        !(target as Element).closest?.(".dictionary-backdrop") &&
        !(target as Element).closest?.("#ai-stop-button")
    ) {
        action = null;
    }
}

function handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape" && expanded) {
        const target = event.target as HTMLElement;
        if (target.tagName !== "INPUT" && target.tagName !== "TEXTAREA") action = null;
        return;
    }
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key === "1") {
        event.preventDefault();
        open("editor");
    }
}

$effect(() =>
    appEventBus.on("ai-open-settings", () => {
        action = "settings";
    }),
);
$effect(() => appEventBus.on("ai-open-chat", () => open("editor")));
</script>

<svelte:window onclick={handleClickOutside} onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
    id="ai-sidebar"
    bind:this={container}
    onclick={(event) => event.stopPropagation()}
    class="fixed left-4 top-1/2 z-50 -translate-y-1/2 overflow-hidden border border-white/30 bg-gray-300/70 shadow-lg backdrop-blur-md transition-[width,height,border-radius] duration-300 {expanded
        ? 'h-[min(620px,calc(100vh-32px))] w-[min(360px,calc(100vw-32px))] rounded-lg'
        : 'h-[116px] w-[52px] rounded-full'} {aiProcessing.active ? 'ai-processing' : ''}"
>
    {#if !expanded}
        <div class="flex h-full flex-col items-center justify-between py-3">
            <button
                id="quillium-review-button"
                type="button"
                onclick={() => open("editor")}
                aria-label={hasApiKey()
                    ? "Open Quillium (Command Shift 1)"
                    : "Configure Quillium"}
                title={hasApiKey() ? "Quillium ⌘⇧1" : "Configure Quillium"}
                class="rounded-full p-2 text-teal-700 transition-colors hover:bg-white/45"
            >
                <SparklesIcon size={19} />
            </button>
            <button
                type="button"
                onclick={() => open("settings")}
                aria-label="AI Settings"
                title="AI Settings"
                class="rounded-full p-2 text-black/35 transition-colors hover:bg-white/45 hover:text-black/60"
            >
                <SettingsIcon size={16} />
            </button>
        </div>
    {:else}
        <div class="flex h-full flex-col">
            <header class="flex h-11 shrink-0 items-center gap-1 border-b border-black/10 px-2.5">
                {#if action !== "editor"}
                    <button
                        type="button"
                        onclick={() => (action = hasApiKey() ? "editor" : null)}
                        aria-label="Back to Quillium"
                        class="rounded p-1.5 text-black/35 hover:bg-white/40 hover:text-black/60"
                    >
                        <ArrowLeftIcon size={15} />
                    </button>
                {:else}
                    <SparklesIcon size={15} class="ml-1 text-teal-700" />
                {/if}
                <span class="min-w-0 flex-1 truncate text-xs font-semibold text-black/55">
                    {action ? panelTitles[action] : ""}
                </span>
                {#if aiProcessing.active}
                    <button
                        id="ai-stop-button"
                        type="button"
                        onclick={stopAllAi}
                        aria-label="Stop AI"
                        title="Stop"
                        class="rounded p-1.5 text-red-500/70 hover:bg-red-50 hover:text-red-600"
                    >
                        <SquareIcon size={13} fill="currentColor" />
                    </button>
                {/if}
                {#if action === "editor"}
                    <button
                        type="button"
                        onclick={() => (action = "settings")}
                        aria-label="AI Settings"
                        class="rounded p-1.5 text-black/30 hover:bg-white/40 hover:text-black/60"
                    >
                        <SettingsIcon size={14} />
                    </button>
                {/if}
                <button
                    type="button"
                    onclick={() => (action = null)}
                    aria-label="Close"
                    class="rounded p-1.5 text-black/30 hover:bg-white/40 hover:text-black/60"
                >
                    <XIcon size={15} />
                </button>
            </header>

            <main class="relative min-h-0 flex-1">
                {#if action === "editor"}
                    <EditorReview
                        onOpenContext={() => (action = "context")}
                        onOpenReaders={() => (action = "readers")}
                    />
                {:else if action === "settings"}
                    <AISettings />
                {:else if action === "context"}
                    <DocumentContext />
                {:else if action === "readers"}
                    <Readers />
                {/if}
            </main>
        </div>
    {/if}
</div>

<style>
    .ai-processing {
        animation: ai-glow 2s linear infinite;
    }

    @keyframes ai-glow {
        0% { box-shadow: 0 0 14px rgb(45 212 191 / 24%); }
        50% { box-shadow: 0 0 20px rgb(59 130 246 / 30%); }
        100% { box-shadow: 0 0 14px rgb(45 212 191 / 24%); }
    }
</style>
