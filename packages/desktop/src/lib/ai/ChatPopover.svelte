<script lang="ts">
import { Popover } from "bits-ui";
import { X } from "lucide-svelte";
import type { Snippet } from "svelte";

let {
    label,
    trigger,
    children,
    open = $bindable(false),
    align = "start",
    active = true,
}: {
    label: string;
    trigger: Snippet;
    children: Snippet;
    open?: boolean;
    align?: "start" | "end";
    active?: boolean;
} = $props();
let button = $state<HTMLButtonElement | null>(null);
let sideOffset = $state(8);
let dismissedOutside = false;
function opening(next: boolean) {
    if (!next) return;
    dismissedOutside = false;
    const composer = button?.closest("form");
    sideOffset = button && composer
        ? Math.max(8, button.getBoundingClientRect().top - composer.getBoundingClientRect().top + 8)
        : 8;
}
$effect(() => { if (!active) open = false; });
</script>

<Popover.Root bind:open onOpenChange={opening}>
    <Popover.Trigger title={label} bind:ref={button} class="chat-popover-trigger flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1.5 text-xs text-black/65 hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-blue-500">
        {@render trigger()}
    </Popover.Trigger>
    <Popover.Portal to={button?.closest("dialog") ?? undefined}>
        <Popover.Content side="top" {align} {sideOffset} collisionPadding={16}
            role="dialog" aria-label={label} trapFocus={false}
            onInteractOutside={() => { dismissedOutside = true; }}
            onCloseAutoFocus={(event) => { if (dismissedOutside || !active) event.preventDefault(); }}
            onclick={(event) => event.stopPropagation()}
            class="z-[200] w-80 max-w-[calc(100vw-32px)] rounded-xl border border-black/10 bg-gray-50 p-3 text-black/85 shadow-lg outline-none">
            <div class="mb-2 flex items-center justify-between gap-2">
                <p class="text-xs font-medium">{label}</p>
                <Popover.Close aria-label="Close details" class="rounded-full p-1 text-black/60 hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-blue-500"><X size={14} /></Popover.Close>
            </div>
            <div class="max-h-[min(360px,45dvh)] overflow-y-auto overscroll-contain text-xs">{@render children()}</div>
        </Popover.Content>
    </Popover.Portal>
</Popover.Root>
