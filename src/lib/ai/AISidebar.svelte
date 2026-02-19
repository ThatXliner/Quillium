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

<div
    class="
        fixed left-4 top-1/2 -translate-y-1/2 z-50
        backdrop-blur-md bg-gray-300/70 border border-white/30 shadow-lg
        overflow-hidden transition-[width,height,border-radius] duration-[340ms] ease-[cubic-bezier(0.33,0,0.2,1)]
        {expanded ? 'w-[320px] h-[520px] rounded-[14px]' : 'w-[52px] h-[164px] rounded-[100px]'}
    "
    >
        <!-- Collapsed pill icons -->
        <div
            class="absolute inset-0 flex flex-col gap-1 py-3 px-2 items-center transition-opacity duration-150
                {expanded ? 'opacity-0 pointer-events-none' : 'opacity-100'}"
        >
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

        <!-- Expanded panel -->
        <div
            class="w-[320px] h-[520px] flex flex-col transition-opacity duration-150
                {expanded ? 'opacity-100 delay-[80ms]' : 'opacity-0 pointer-events-none'}"
        >
            <!-- Header -->
            <div class="flex items-center gap-1 px-3 pt-3 pb-2 shrink-0">
                {#each actions as a}
                    <button
                        onclick={() => (action = a.id)}
                        aria-label={a.label}
                        title={a.label}
                        class="p-2 rounded-full transition-colors
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

            <!-- Content — all three mounted upfront to avoid mount-time jank -->
            <div class="flex-1 flex flex-col min-h-0 relative">
                <div class="absolute inset-0 flex flex-col {action === 'chat' ? '' : 'hidden'}"><Chat /></div>
                <div class="absolute inset-0 flex flex-col {action === 'feedback' ? '' : 'hidden'}"><Feedback /></div>
                <div class="absolute inset-0 flex flex-col {action === 'revise' ? '' : 'hidden'}"><Revise /></div>
            </div>
        </div>
    </div>

<style>
    @media (prefers-reduced-motion: reduce) {
        * { transition-duration: 0.01ms !important; }
    }
</style>
