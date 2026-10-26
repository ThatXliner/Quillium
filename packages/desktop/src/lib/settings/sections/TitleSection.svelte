<!--
    TitleSection.svelte — Settings (advanced): document-title visibility in the
    status bar and its hover-delay / linger-duration timings.
    Mutates the shared settings draft and calls onchange() for live apply.
-->
<script lang="ts">
import type { AppSettings } from "$lib/settings.svelte";
import SettingSegmented from "../SettingSegmented.svelte";
import SettingSlider from "../SettingSlider.svelte";

const { draft, onchange }: { draft: AppSettings; onchange: () => void } = $props();
</script>

<SettingSegmented
    title="Document title"
    description="When to show the title in the status bar"
    options={[
        ["hover", "On hover"],
        ["always", "Always"],
        ["never", "Never"],
    ]}
    value={draft.titleVisibility}
    defaultValue="hover"
    onchange={(value) => {
        draft.titleVisibility = value as AppSettings["titleVisibility"];
        onchange();
    }}
/>

<SettingSlider
    title="Title hover delay"
    description="How long to hover before the title appears (ms)"
    min={0}
    max={3000}
    step={100}
    bind:value={draft.titleHoverDelay}
    defaultValue={350}
    format={(v) => `${v}ms`}
    valueWidthClass="w-10"
    oninput={onchange}
    dimmed={draft.titleVisibility !== "hover"}
/>

<SettingSlider
    title="Title linger duration"
    description="How long the title stays visible after editing stops (ms)"
    min={500}
    max={10000}
    step={500}
    bind:value={draft.titleLingerDuration}
    defaultValue={3000}
    format={(v) => (v >= 1000 ? `${v / 1000}s` : `${v}ms`)}
    valueWidthClass="w-10"
    oninput={onchange}
    dimmed={draft.titleVisibility !== "hover"}
/>
