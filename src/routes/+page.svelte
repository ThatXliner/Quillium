<script>
    import Annotations from "$lib/editor/plugins/annotations/Annotations.svelte";
    import Editor from "$lib/editor/Editor.svelte";
    import AiSidebar from "$lib/ai/AISidebar.svelte";
    import { PaneGroup, Pane, PaneResizer } from "paneforge";
    import { GripVerticalIcon } from "lucide-svelte";
</script>

<!-- TODO: snap to default -->
<PaneGroup direction="horizontal">
    <Pane defaultSize={17} minSize={17}><AiSidebar /></Pane>
    <PaneResizer
        class="bg-border focus-visible:ring-ring focus-visible:outline-hidden relative flex w-px items-center justify-center after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 focus-visible:ring-1 focus-visible:ring-offset-1 data-[direction=vertical]:h-px data-[direction=vertical]:w-full data-[direction=vertical]:after:left-0 data-[direction=vertical]:after:h-1 data-[direction=vertical]:after:w-full data-[direction=vertical]:after:-translate-y-1/2 data-[direction=vertical]:after:translate-x-0 [&[data-direction=vertical]>div]:rotate-90"
    >
        <div
            class="bg-white rounded-xs z-10 flex h-4 w-3 items-center justify-center border"
        >
            <GripVerticalIcon class="size-2.5" />
        </div>
    </PaneResizer>
    <Pane defaultSize={65}><Editor /></Pane>
    <PaneResizer
        class="bg-border focus-visible:ring-ring focus-visible:outline-hidden relative flex w-px items-center justify-center after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 focus-visible:ring-1 focus-visible:ring-offset-1 data-[direction=vertical]:h-px data-[direction=vertical]:w-full data-[direction=vertical]:after:left-0 data-[direction=vertical]:after:h-1 data-[direction=vertical]:after:w-full data-[direction=vertical]:after:-translate-y-1/2 data-[direction=vertical]:after:translate-x-0 [&[data-direction=vertical]>div]:rotate-90"
    >
        <div
            class="bg-white rounded-xs z-10 flex h-4 w-3 items-center justify-center border"
        >
            <GripVerticalIcon class="size-2.5" />
        </div>
    </PaneResizer>
    <Pane defaultSize={18} minSize={18}><Annotations /></Pane>
</PaneGroup>

<style>
    :global(html) {
        background-color: lightgray;
    }
</style>
