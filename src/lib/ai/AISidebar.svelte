<script lang="ts">
    import { tick } from "svelte";
    import Chat from "./Chat.svelte";
    import Feedback from "./Feedback.svelte";
    import Revise from "./Revise.svelte";
    import AISettings from "./AISettings.svelte";
    import DocumentContext from "./DocumentContext.svelte";
    import { MessageCircleIcon, ZapIcon, PenLineIcon, XIcon, Settings2Icon, CompassIcon } from "lucide-svelte";

    type Action = null | "chat" | "feedback" | "revise" | "context" | "settings";
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
        {
            id: "context",
            icon: CompassIcon,
            label: "Document Context",
            activeClass: "text-amber-600 bg-white/60",
            hoverClass: "hover:text-amber-600",
        },
    ];

    const panelTitles: Record<NonNullable<Action>, string> = {
        chat: "Chat with AI",
        feedback: "Get Feedback",
        revise: "Revise & Rewrite",
        context: "Document Context",
        settings: "AI Settings",
    };

    const expanded = $derived(action !== null);

    let container: HTMLDivElement;
    let iconStrip = $state<HTMLDivElement>();
    let iconEls = $state<HTMLButtonElement[]>([]);

    function handleClickOutside(e: MouseEvent) {
        const target = e.target as Node;
        if (
            expanded &&
            container &&
            !container.contains(target) &&
            !(target as Element).closest?.(".cm-editor")
        ) {
            action = null;
        }
    }

    function selectAction(id: NonNullable<Action>) {
        action = id;
        scrollActiveIntoCenter(id);
    }

    function scrollActiveIntoCenter(id: NonNullable<Action>) {
        tick().then(() => {
            if (!iconStrip) return;
            const idx = actions.findIndex((a) => a.id === id);
            const el = iconEls[idx];
            if (!el) return;
            const stripRect = iconStrip.getBoundingClientRect();
            const elRect = el.getBoundingClientRect();
            const offset = elRect.left - stripRect.left + elRect.width / 2 - stripRect.width / 2;
            iconStrip.scrollBy({ left: offset, behavior: "smooth" });
        });
    }

    // Center the active icon whenever the panel opens
    $effect(() => {
        if (expanded && action && action !== "settings") {
            scrollActiveIntoCenter(action);
        }
    });
</script>

<svelte:window onclick={handleClickOutside} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
    id="ai-sidebar"
    bind:this={container}
    onclick={(e) => e.stopPropagation()}
    class="
        fixed left-4 top-1/2 -translate-y-1/2 z-50
        backdrop-blur-md bg-gray-300/70 border border-white/30 shadow-lg
        overflow-hidden transition-[width,height,border-radius] duration-[340ms] ease-[cubic-bezier(0.33,0,0.2,1)]
        {expanded ? 'w-[320px] h-[520px] rounded-[14px]' : 'w-[52px] h-[240px] rounded-[100px]'}
    "
>
    <!-- Collapsed pill icons -->
    <div
        class="absolute inset-0 flex flex-col items-center py-3 px-2 transition-opacity duration-150
            {expanded ? 'opacity-0 pointer-events-none' : 'opacity-100'}"
    >
        <div class="flex flex-col gap-1">
            {#each actions as a}
                <button
                    id="ai-tab-{a.id}"
                    onclick={() => (action = a.id)}
                    aria-label={a.label}
                    title={a.label}
                    class="p-2 rounded-full text-black/50 transition-colors {a.hoverClass}"
                >
                    <a.icon size={18} />
                </button>
            {/each}
        </div>
        <div class="flex-1"></div>
        <button
            onclick={() => (action = "settings")}
            aria-label="AI Settings"
            title="AI Settings"
            class="p-2 rounded-full text-black/30 hover:text-black/60 transition-colors"
        >
            <Settings2Icon size={15} />
        </button>
    </div>

    <!-- Expanded panel -->
    <div
        class="w-[320px] h-[520px] flex flex-col transition-opacity duration-150
            {expanded ? 'opacity-100 delay-[80ms]' : 'opacity-0 pointer-events-none'}"
    >
        <!-- Row 1: icon wheel -->
        <div class="shrink-0 pt-2.5 pb-1">
            <div
                bind:this={iconStrip}
                class="flex items-center gap-0.5 overflow-x-auto px-4 scroll-smooth"
                style="scrollbar-width: none; -ms-overflow-style: none; mask-image: linear-gradient(to right, transparent 0%, black 18%, black 82%, transparent 100%); -webkit-mask-image: linear-gradient(to right, transparent 0%, black 18%, black 82%, transparent 100%);"
            >
                {#each actions as a, i}
                    {@const activeIdx = actions.findIndex(x => x.id === action)}
                    {@const dist = Math.abs(i - activeIdx)}
                    {@const scale = activeIdx < 0 ? 1 : dist === 0 ? 1 : dist === 1 ? 0.88 : 0.76}
                    {@const opacity = activeIdx < 0 ? 0.5 : dist === 0 ? 1 : dist === 1 ? 0.45 : 0.25}
                    <button
                        bind:this={iconEls[i]}
                        onclick={() => selectAction(a.id)}
                        aria-label={a.label}
                        title={a.label}
                        style="transform: scale({scale}); opacity: {opacity};"
                        class="p-2 rounded-full shrink-0 transition-all duration-200
                            {action === a.id
                                ? a.activeClass
                                : 'text-black/70 hover:bg-white/30'}"
                    >
                        <a.icon size={16} />
                    </button>
                {/each}
            </div>
        </div>

        <!-- Row 2: title + settings + close -->
        <div class="flex items-center px-3 pb-2 shrink-0">
            <span class="flex-1 text-xs font-semibold text-black/50 truncate">
                {action ? panelTitles[action] : ""}
            </span>
            <button
                onclick={() => (action = action === "settings" ? null : "settings")}
                aria-label="AI Settings"
                title="AI Settings"
                class="p-1.5 rounded-full transition-colors shrink-0
                    {action === 'settings'
                        ? 'text-black/60 bg-white/60'
                        : 'text-black/30 hover:text-black/60 hover:bg-white/40'}"
            >
                <Settings2Icon size={14} />
            </button>
            <button
                onclick={() => (action = null)}
                aria-label="Close"
                class="p-1.5 rounded-full text-black/30 hover:text-black/60 hover:bg-white/40 transition-colors shrink-0"
            >
                <XIcon size={14} />
            </button>
        </div>

        <div class="w-full h-px bg-black/10 shrink-0"></div>

        <!-- Content — all panels mounted upfront to avoid mount-time jank -->
        <div class="flex-1 flex flex-col min-h-0 relative">
            <div class="absolute inset-0 flex flex-col {action === 'chat' ? '' : 'hidden'}"><Chat /></div>
            <div class="absolute inset-0 flex flex-col {action === 'feedback' ? '' : 'hidden'}"><Feedback /></div>
            <div class="absolute inset-0 flex flex-col {action === 'revise' ? '' : 'hidden'}"><Revise /></div>
            <div class="absolute inset-0 overflow-y-auto {action === 'context' ? '' : 'hidden'}"><DocumentContext /></div>
            <div class="absolute inset-0 flex flex-col {action === 'settings' ? '' : 'hidden'}"><AISettings /></div>
        </div>
    </div>
</div>

<style>
    div[style*="scrollbar-width"]::-webkit-scrollbar {
        display: none;
    }

    @media (prefers-reduced-motion: reduce) {
        * { transition-duration: 0.01ms !important; }
    }
</style>
