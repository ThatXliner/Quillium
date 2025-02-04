<script>
    import {
        Camera,
        ChevronDown,
        Type,
        Bold,
        Italic,
        Underline,
        Strikethrough,
        Subscript,
        Superscript,
        List,
        ListOrdered,
        AlignLeft,
        AlignCenter,
        AlignRight,
        AlignJustify,
    } from "lucide-svelte";

    const toolbarItems = [
        { icon: Type, tooltip: "Heading 1" },
        { icon: Bold, tooltip: "Bold" },
        { icon: Italic, tooltip: "Italic" },
        { icon: Underline, tooltip: "Underline" },
        { icon: Strikethrough, tooltip: "Strikethrough" },
        { icon: Subscript, tooltip: "Subscript" },
        { icon: Superscript, tooltip: "Superscript" },
        { icon: List, tooltip: "Bulleted list" },
        { icon: ListOrdered, tooltip: "Numbered list" },
        { icon: AlignLeft, tooltip: "Align left" },
        { icon: AlignCenter, tooltip: "Align center" },
        { icon: AlignRight, tooltip: "Align right" },
        { icon: AlignJustify, tooltip: "Align justify" },
    ];
</script>

<div class="flex items-center justify-between bg-gray-100 border-b">
    {#each toolbarItems as item}
        <button class="p-2 hover:bg-gray-200 rounded-md" title={item.tooltip}>
            <svelte:component this={item.icon} size={20} />
        </button>
    {/each}
    <input
        type="text"
        class="px-2 py-1 bg-white border rounded-md flex-1 mx-2"
        placeholder="Heading 1"
    />
    <div class="flex items-center">
        <button class="p-2 hover:bg-gray-200 rounded-md">
            <ChevronDown size={20} />
        </button>
    </div>
</div>
