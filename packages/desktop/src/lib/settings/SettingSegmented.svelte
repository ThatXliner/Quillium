<!--
    SettingSegmented.svelte — One settings row with a segmented button group.

    Standard row layout with a Reset link (when the value differs from its
    default) and one button per option. Styles come from ./settings.css.
-->
<script lang="ts">
const {
    title,
    description,
    options,
    value,
    defaultValue,
    onchange,
    dimmed = false,
}: {
    title: string;
    description: string;
    options: ReadonlyArray<readonly [string, string]>;
    value: string;
    /** When set, a Reset link shows whenever `value` differs from this. */
    defaultValue?: string;
    onchange: (value: string) => void;
    dimmed?: boolean;
} = $props();
</script>

<div class="setting-row {dimmed ? 'opacity-40 pointer-events-none' : ''}">
    <div class="setting-meta">
        <div class="setting-title">{title}</div>
        <div class="setting-desc">{description}</div>
    </div>
    <div class="flex items-center gap-2 shrink-0">
        {#if defaultValue !== undefined && value !== defaultValue}
            <button
                type="button"
                onclick={() => onchange(defaultValue)}
                class="text-[11px] text-blue-500 hover:text-blue-600 transition-colors cursor-pointer"
            >Reset</button>
        {/if}
        <div class="flex rounded-lg overflow-hidden border border-black/[0.09]">
            {#each options as [val, label]}
                <button
                    onclick={() => onchange(val)}
                    class="px-3 py-1.5 text-[11px] font-medium transition-colors
                        {value === val
                            ? 'bg-blue-500 text-white'
                            : 'bg-white text-black/50 hover:bg-black/[0.04]'}"
                >{label}</button>
            {/each}
        </div>
    </div>
</div>
