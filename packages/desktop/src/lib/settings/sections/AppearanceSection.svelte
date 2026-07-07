<!--
    AppearanceSection.svelte — Settings: document/UI fonts, font size, zoom.
    Mutates the shared settings draft and calls onchange() for live apply.
    The FontGuideModal itself is rendered by the parent (it overlays the
    whole modal), so help clicks bubble up via onFontGuide.
-->
<script lang="ts">
import type { AppSettings } from "$lib/settings.svelte";
import FontPickerRow from "../FontPickerRow.svelte";
import SettingSlider from "../SettingSlider.svelte";
import { DOC_FONTS, UI_FONTS, sansStack } from "../fontOptions";

const {
    draft,
    onchange,
    onFontGuide,
}: {
    draft: AppSettings;
    onchange: () => void;
    onFontGuide: (tab: "doc" | "ui") => void;
} = $props();
</script>

<div class="section-label">Appearance</div>

<FontPickerRow
    title="Font family"
    description="Editor font"
    fonts={DOC_FONTS}
    value={draft.docFontFamily}
    defaultValue="Georgia, serif"
    onchange={(value) => {
        draft.docFontFamily = value;
        onchange();
    }}
    onhelp={() => onFontGuide("doc")}
/>

<SettingSlider
    title="Font size"
    description="Text size (14-24 px)"
    min={14}
    max={24}
    step={1}
    bind:value={draft.docFontSize}
    defaultValue={18}
    format={(v) => `${v}px`}
    oninput={onchange}
/>

<!-- UI zoom row (read-only display; changed via Cmd+= / Cmd+-) -->
<div class="setting-row">
    <div class="setting-meta">
        <div class="setting-title">Zoom</div>
        <div class="setting-desc">Scale the entire interface (Cmd+= / Cmd+-)</div>
    </div>
    <div class="flex items-center gap-3 shrink-0">
        <span class="text-[12px] text-black/50 tabular-nums">{Math.round(draft.uiZoom * 100)}%</span>
        {#if draft.uiZoom !== 1}
            <button
                type="button"
                onclick={() => {
                    draft.uiZoom = 1;
                    onchange();
                }}
                class="text-[11px] text-blue-500 hover:text-blue-600 transition-colors cursor-pointer"
            >Reset to 100%</button>
        {/if}
    </div>
</div>

<FontPickerRow
    title="UI font family"
    description="UI font"
    fonts={UI_FONTS}
    value={draft.uiFontFamily}
    defaultValue={sansStack}
    onchange={(value) => {
        draft.uiFontFamily = value;
        onchange();
    }}
    onhelp={() => onFontGuide("ui")}
/>
