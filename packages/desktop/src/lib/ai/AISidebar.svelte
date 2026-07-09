<!-- AISidebar.svelte — Extensible AI shell with one editor and supporting configuration. -->
<script lang="ts">
import { aiProcessing, ensureApiKeyLoaded, hasApiKey, stopAllAi } from "$lib/ai/settings.svelte";
import { appEventBus } from "$lib/events/appEventBus";
import posthog from "$lib/posthog";
import {
    CompassIcon,
    SettingsIcon,
    SparklesIcon,
    SquareIcon,
    UsersIcon,
    XIcon,
} from "lucide-svelte";
import AISettings from "./AISettings.svelte";
import DocumentContext from "./DocumentContext.svelte";
import EditorReview from "./EditorReview.svelte";
import Readers from "./Readers.svelte";

type ActionId = "editor" | "context" | "readers";
type Action = ActionId | "settings" | null;

const actions = [
    {
        id: "editor" as const,
        label: "Quillium",
        icon: SparklesIcon,
        activeClass: "bg-white/65 text-teal-700",
        requiresApiKey: true,
    },
    {
        id: "context" as const,
        label: "Document Context",
        icon: CompassIcon,
        activeClass: "bg-white/65 text-amber-700",
        requiresApiKey: false,
    },
    {
        id: "readers" as const,
        label: "Reader Perspectives",
        icon: UsersIcon,
        activeClass: "bg-white/65 text-rose-700",
        requiresApiKey: false,
    },
];

const panelTitles: Record<Exclude<Action, null>, string> = {
    editor: "Quillium",
    context: "Document Context",
    readers: "Reader Perspectives",
    settings: "AI Settings",
};

const panelHeightClasses: Record<Exclude<Action, null>, string> = {
    editor: "h-[min(430px,calc(100vh-32px))]",
    context: "h-[min(580px,calc(100vh-32px))]",
    readers: "h-[min(560px,calc(100vh-32px))]",
    settings: "h-[min(570px,calc(100vh-32px))]",
};

let action = $state<Action>(null);
let container = $state<HTMLDivElement>();
const expanded = $derived(action !== null);
const panelHeightClass = $derived(action ? panelHeightClasses[action] : "h-[174px]");

function open(actionToOpen: Exclude<Action, null>): void {
    ensureApiKeyLoaded();
    const definition = actions.find((item) => item.id === actionToOpen);
    if (definition?.requiresApiKey && !hasApiKey()) {
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
    if (!(event.metaKey || event.ctrlKey) || !event.shiftKey) return;
    const actionKeys: Record<string, ActionId> = { "1": "editor", "2": "context", "3": "readers" };
    const targetAction = actionKeys[event.key];
    if (targetAction) {
        event.preventDefault();
        open(targetAction);
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
    class="fixed left-4 top-1/2 z-50 -translate-y-1/2 overflow-hidden border border-white/30 bg-gray-300/70 shadow-lg backdrop-blur-md transition-[width,height,border-radius] duration-300 {panelHeightClass} {expanded
        ? 'w-[min(380px,calc(100vw-32px))] rounded-[14px]'
        : 'w-[52px] rounded-[26px]'} {aiProcessing.active ? 'ai-processing' : ''}"
>
    {#if !expanded}
        <div class="flex h-full flex-col items-center py-3">
            <div class="flex flex-col gap-1">
                {#each actions as item}
                    {@const unavailable = item.requiresApiKey && !hasApiKey()}
                    <button
                        id={item.id === "editor" ? "quillium-review-button" : undefined}
                        type="button"
                        disabled={unavailable}
                        onclick={() => open(item.id)}
                        aria-label={item.id === "editor" && !unavailable
                            ? "Open Quillium (Command Shift 1)"
                            : unavailable
                              ? "Quillium unavailable. Add an API key"
                              : item.label}
                        aria-disabled={unavailable}
                        title={unavailable ? "Add an API key to enable Quillium" : item.label}
                        class="rounded-full p-2 transition-colors {unavailable
                            ? 'cursor-not-allowed text-black/20 grayscale opacity-45'
                            : 'text-black/45 hover:bg-white/45 hover:text-black/70'}"
                    >
                        <item.icon size={18} />
                    </button>
                {/each}
            </div>
            <div class="my-1 h-px w-5 bg-black/8"></div>
            <button
                type="button"
                onclick={() => open("settings")}
                aria-label="AI Settings"
                title="AI Settings"
                class="rounded-full p-2 text-black/30 transition-colors hover:bg-white/45 hover:text-black/60"
            >
                <SettingsIcon size={15} />
            </button>
        </div>
    {:else}
        <div class="flex h-full flex-col">
            <!-- Keep this horizontally scrollable action registry even while the list is short.
                 New AI surfaces should extend `actions`, not replace the shell. -->
            <nav
                aria-label="Quillium tools"
                class="flex shrink-0 items-center gap-1 overflow-x-auto px-3 pt-2.5 pb-1 [scrollbar-width:none]"
            >
                {#each actions as item}
                    {@const unavailable = item.requiresApiKey && !hasApiKey()}
                    <button
                        type="button"
                        disabled={unavailable}
                        onclick={() => open(item.id)}
                        aria-label={item.label}
                        aria-disabled={unavailable}
                        title={unavailable ? "Add an API key to enable Quillium" : item.label}
                        class="shrink-0 rounded-full p-2 transition-colors {unavailable
                            ? 'cursor-not-allowed text-black/20 grayscale opacity-40'
                            : action === item.id
                              ? item.activeClass
                              : 'text-black/55 hover:bg-white/35 hover:text-black/75'}"
                    >
                        <item.icon size={16} />
                    </button>
                {/each}
            </nav>

            <header class="flex h-9 shrink-0 items-center gap-1 border-b border-black/10 px-3">
                <span class="min-w-0 flex-1 truncate text-xs font-semibold text-black/50">
                    {action ? panelTitles[action] : ""}
                </span>
                {#if aiProcessing.active}
                    <button
                        id="ai-stop-button"
                        type="button"
                        onclick={stopAllAi}
                        aria-label="Stop AI"
                        title="Stop"
                        class="rounded-full p-1.5 text-red-500/70 hover:bg-red-50 hover:text-red-600"
                    >
                        <SquareIcon size={12} fill="currentColor" />
                    </button>
                {/if}
                <button
                    type="button"
                    onclick={() => (action = "settings")}
                    aria-label="AI Settings"
                    title="AI Settings"
                    class="rounded-full p-1.5 text-black/30 hover:bg-white/40 hover:text-black/60"
                >
                    <SettingsIcon size={14} />
                </button>
                <button
                    type="button"
                    onclick={() => (action = null)}
                    aria-label="Close"
                    class="rounded-full p-1.5 text-black/30 hover:bg-white/40 hover:text-black/60"
                >
                    <XIcon size={14} />
                </button>
            </header>

            <main class="relative min-h-0 flex-1">
                {#if action === "editor"}
                    <EditorReview
                        onOpenContext={() => (action = "context")}
                        onOpenReaders={() => (action = "readers")}
                    />
                {:else if action === "context"}
                    <DocumentContext />
                {:else if action === "readers"}
                    <Readers />
                {:else if action === "settings"}
                    <AISettings />
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
