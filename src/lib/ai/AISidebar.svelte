<script lang="ts">
    import Chat from "./Chat.svelte";
    import Feedback from "./Feedback.svelte";
    import Revise from "./Revise.svelte";
    import { MessageCircleIcon, ZapIcon, PenLineIcon, XIcon } from "lucide-svelte";

    type Action = null | "chat" | "feedback" | "revise";
    let action = $state<Action>(null);

    const actions: {
        id: NonNullable<Action>;
        icon: any;
        label: string;
        activeClass: string;
        hoverClass: string;
    }[] = [
        {
            id: "chat",
            icon: MessageCircleIcon,
            label: "Chat",
            activeClass: "text-blue-600 bg-white/60",
            hoverClass: "hover:text-blue-600",
        },
        {
            id: "feedback",
            icon: ZapIcon,
            label: "Feedback",
            activeClass: "text-green-600 bg-white/60",
            hoverClass: "hover:text-green-600",
        },
        {
            id: "revise",
            icon: PenLineIcon,
            label: "Revise",
            activeClass: "text-purple-600 bg-white/60",
            hoverClass: "hover:text-purple-600",
        },
    ];

    const panelTitles: Record<NonNullable<Action>, string> = {
        chat: "Chat with AI",
        feedback: "Get Feedback",
        revise: "Revise & Rewrite",
    };

    const expanded = $derived(action !== null);
</script>

<!--
    Single morphing container.
    Collapsed: tall pill (narrow + very tall border-radius).
    Expanded: rounded panel (wide + short border-radius + taller).
    max-width / max-height animate the shape; opacity + translate animate content.
-->
<div
    class="
        fixed left-4 top-1/2 -translate-y-1/2 z-50
        backdrop-blur-md bg-gray-300/70 border border-white/30 shadow-lg
        overflow-hidden flex flex-col
        transition-[max-width,max-height,border-radius]
        duration-[350ms] ease-[cubic-bezier(0.25,1,0.5,1)]
        {expanded
            ? 'max-w-[320px] max-h-[520px] rounded-2xl'
            : 'max-w-[52px] max-h-[164px] rounded-full'}
    "
    style="will-change: max-width, max-height, border-radius;"
>
    {#if !expanded}
        <!-- Collapsed pill: vertical icon stack -->
        <div class="flex flex-col gap-1 py-3 px-2 items-center">
            {#each actions as a}
                <button
                    onclick={() => (action = a.id)}
                    aria-label={a.label}
                    title={a.label}
                    class="p-2 rounded-full text-black/50 transition-colors {a.hoverClass}"
                >
                    <a.icon size={18} />
                </button>
            {/each}
        </div>
    {:else}
        <!-- Expanded panel -->
        <div
            class="flex flex-col w-[320px] h-[520px] animate-panel"
        >
            <!-- Header: icon tabs + close -->
            <div class="flex items-center gap-1 px-3 pt-3 pb-2 shrink-0">
                {#each actions as a}
                    <button
                        onclick={() => (action = a.id)}
                        aria-label={a.label}
                        title={a.label}
                        class="p-2 rounded-full transition-colors text-sm
                            {action === a.id
                                ? a.activeClass
                                : 'text-black/40 hover:text-black/70 hover:bg-white/30'}"
                    >
                        <a.icon size={16} />
                    </button>
                {/each}
                <span class="flex-1 text-xs font-semibold text-black/60 pl-1 truncate">
                    {action ? panelTitles[action] : ""}
                </span>
                <button
                    onclick={() => (action = null)}
                    aria-label="Close"
                    class="p-1.5 rounded-full text-black/30 hover:text-black/60 hover:bg-white/40 transition-colors shrink-0"
                >
                    <XIcon size={14} />
                </button>
            </div>

            <div class="w-full h-px bg-black/10 shrink-0"></div>

            <!-- Content -->
            <div class="flex-1 flex flex-col min-h-0">
                {#if action === "chat"}
                    <Chat />
                {:else if action === "feedback"}
                    <Feedback />
                {:else if action === "revise"}
                    <Revise />
                {/if}
            </div>
        </div>
    {/if}
</div>

<style>
    /* Content fades + slides up slightly after the shape morphs */
    .animate-panel {
        animation: panel-content-in 280ms cubic-bezier(0.25, 1, 0.5, 1) both;
        animation-delay: 80ms;
    }

    @keyframes panel-content-in {
        from {
            opacity: 0;
            transform: translateY(6px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }

    @media (prefers-reduced-motion: reduce) {
        .animate-panel {
            animation: none;
        }
        /* Override the morph transitions too */
        :global(.transition-\[max-width\,max-height\,border-radius\]) {
            transition-duration: 0.01ms !important;
        }
    }
</style>
