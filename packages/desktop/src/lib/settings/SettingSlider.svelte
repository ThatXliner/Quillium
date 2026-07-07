<!--
    SettingSlider.svelte — One settings row with a range slider.

    Standard row layout with the slider, a formatted value readout, and a
    Reset link when the value differs from its default. Styles come from
    ./settings.css.
-->
<script lang="ts">
let {
    title,
    description,
    min,
    max,
    step,
    value = $bindable(),
    defaultValue,
    format = (v: number) => String(v),
    valueWidthClass = "w-7",
    oninput,
    dimmed = false,
}: {
    title: string;
    description: string;
    min: number;
    max: number;
    step: number;
    value: number;
    defaultValue?: number;
    format?: (value: number) => string;
    /** Tailwind width class for the value readout (keeps columns aligned). */
    valueWidthClass?: string;
    oninput: () => void;
    dimmed?: boolean;
} = $props();
</script>

<div class="setting-row {dimmed ? 'opacity-40 pointer-events-none' : ''}">
    <div class="setting-meta">
        <div class="setting-title">{title}</div>
        <div class="setting-desc">{description}</div>
    </div>
    <div class="flex items-center gap-3 shrink-0">
        <input
            type="range"
            {min}
            {max}
            {step}
            bind:value
            {oninput}
            class="w-28 accent-blue-500 cursor-pointer"
        />
        <span class="text-[12px] text-black/50 {valueWidthClass} text-right tabular-nums">{format(value)}</span>
        {#if defaultValue !== undefined && value !== defaultValue}
            <button
                type="button"
                onclick={() => {
                    value = defaultValue;
                    oninput();
                }}
                class="text-[11px] text-blue-500 hover:text-blue-600 transition-colors cursor-pointer"
            >Reset</button>
        {/if}
    </div>
</div>
