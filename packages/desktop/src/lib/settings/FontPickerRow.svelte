<!--
    FontPickerRow.svelte — One settings row with the custom font dropdown.

    Renders the row (title + help button + Reset link) and the two-tier
    dropdown ("Our Picks" / "All Fonts") with live font samples. Owns its own
    open state and outside-click dismissal. Styles come from ./settings.css.
-->
<script lang="ts">
import { Check, ChevronDown, HelpCircle } from "lucide-svelte";
import { FONT_SAMPLE_PLACEHOLDER, type FontOption } from "./fontOptions";

const {
    title,
    description,
    fonts,
    value,
    defaultValue,
    onchange,
    onhelp,
}: {
    title: string;
    description: string;
    fonts: FontOption[];
    value: string;
    defaultValue: string;
    onchange: (value: string) => void;
    onhelp: () => void;
} = $props();

let open = $state(false);

function fontLabel() {
    return fonts.find((f) => f.value === value)?.label ?? fonts[0].label;
}

function pick(font: FontOption) {
    open = false;
    onchange(font.value);
}

// Close the dropdown on outside click.
$effect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
        if (!(e.target as HTMLElement).closest(".font-dropdown")) {
            open = false;
        }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
});
</script>

<div class="setting-row">
    <div class="setting-meta">
        <div class="flex items-center gap-1.5">
            <div class="setting-title">{title}</div>
            <button
                onclick={onhelp}
                aria-label="Font guide"
                class="text-black/25 hover:text-black/50 transition-colors"
            >
                <HelpCircle size={13} />
            </button>
        </div>
        <div class="setting-desc">{description}</div>
    </div>
    <div class="flex items-center gap-2 shrink-0">
        {#if value !== defaultValue}
            <button
                type="button"
                onclick={() => onchange(defaultValue)}
                class="text-[11px] text-blue-500 hover:text-blue-600 transition-colors cursor-pointer"
            >Reset</button>
        {/if}
        <div class="font-dropdown relative" role="none">
            <button
                onclick={() => (open = !open)}
                class="dropdown-trigger {open ? 'dropdown-trigger-open' : ''}"
            >
                <span style="font-family: {value}; font-size: 13px;">{fontLabel()}</span>
                <ChevronDown size={11} class="text-black/35 transition-transform duration-150 {open ? 'rotate-180' : ''}" />
            </button>
            {#if open}
                <div class="dropdown-popover">
                    <div class="dropdown-section-label">Our Picks</div>
                    {#each fonts.filter((f) => f.featured) as font}
                        {@const selected = value === font.value}
                        <button
                            class="dropdown-option {selected ? 'dropdown-option-active' : ''}"
                            onclick={() => pick(font)}
                        >
                            <div class="flex-1 min-w-0">
                                <div class="dropdown-option-label" style="font-family: {font.value};">{font.label}</div>
                                <div class="dropdown-option-sample" style="font-family: {font.value};">{font?.sample ?? FONT_SAMPLE_PLACEHOLDER}</div>
                            </div>
                            {#if selected}
                                <Check size={11} class="text-blue-500 shrink-0" />
                            {/if}
                        </button>
                    {/each}
                    <div class="dropdown-divider"></div>
                    <div class="dropdown-section-label">All Fonts</div>
                    {#each fonts.filter((f) => !f.featured).sort((a, b) => a.label.localeCompare(b.label)) as font}
                        {@const selected = value === font.value}
                        <button
                            class="dropdown-option {selected ? 'dropdown-option-active' : ''}"
                            onclick={() => pick(font)}
                        >
                            <div class="flex-1 min-w-0">
                                <div class="dropdown-option-label" style="font-family: {font.value};">{font.label}</div>
                                <div class="dropdown-option-sample" style="font-family: {font.value};">{FONT_SAMPLE_PLACEHOLDER}</div>
                            </div>
                            {#if selected}
                                <Check size={11} class="text-blue-500 shrink-0" />
                            {/if}
                        </button>
                    {/each}
                </div>
            {/if}
        </div>
    </div>
</div>
