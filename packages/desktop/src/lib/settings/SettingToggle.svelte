<!--
    SettingToggle.svelte — One settings row with an on/off switch.

    Renders the standard row layout (title + description on the left, controls
    on the right), a "Reset" link when the value differs from its default, and
    the pill switch. `titleExtra`/`descriptionExtra`/`beforeSwitch` snippets
    cover the rows that carry a help button, inline status text, or an extra
    control (e.g. the uninstall-model button).

    Styles come from ./settings.css (imported by SettingsModal).
-->
<script lang="ts">
import type { Snippet } from "svelte";

const {
    title,
    description,
    checked,
    defaultChecked,
    ariaLabel,
    onchange,
    settingId,
    dimmed = false,
    disabled = false,
    titleExtra,
    descriptionExtra,
    beforeSwitch,
}: {
    title: string;
    description?: string;
    checked: boolean;
    /** When set, a Reset link shows whenever `checked` differs from this. */
    defaultChecked?: boolean;
    ariaLabel: string;
    onchange: (checked: boolean) => void;
    settingId?: string;
    /** Fade + disable the whole row (dependent setting whose parent is off). */
    dimmed?: boolean;
    /** Disable just the switch (e.g. while an async toggle is in flight). */
    disabled?: boolean;
    titleExtra?: Snippet;
    descriptionExtra?: Snippet;
    beforeSwitch?: Snippet;
} = $props();
</script>

<div class="setting-row {dimmed ? 'opacity-40 pointer-events-none' : ''}" data-setting-id={settingId}>
    <div class="setting-meta">
        <div class="setting-title flex items-center gap-1.5">
            {title}
            {@render titleExtra?.()}
        </div>
        {#if description !== undefined || descriptionExtra}
            <div class="setting-desc">
                {description}
                {@render descriptionExtra?.()}
            </div>
        {/if}
    </div>
    <div class="flex items-center gap-2 shrink-0">
        {#if defaultChecked !== undefined && checked !== defaultChecked}
            <button
                type="button"
                onclick={() => onchange(defaultChecked)}
                class="text-[11px] text-blue-500 hover:text-blue-600 transition-colors cursor-pointer"
            >Reset</button>
        {/if}
        {@render beforeSwitch?.()}
        <button
            role="switch"
            aria-checked={checked}
            aria-label={ariaLabel}
            {disabled}
            class="relative shrink-0 w-9 h-5 rounded-full transition-colors duration-200
                {checked ? 'bg-blue-500' : 'bg-black/[0.15]'}"
            onclick={() => onchange(!checked)}
        >
            <span
                class="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm
                    transition-transform duration-200
                    {checked ? 'translate-x-4' : 'translate-x-0'}"
            ></span>
        </button>
    </div>
</div>
