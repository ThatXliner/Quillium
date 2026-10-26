<!--
    AISection.svelte — Settings (advanced): AI feature master switch and the
    AI-dependent display toggles.
    Mutates the shared settings draft and calls onchange() for live apply.
-->
<script lang="ts">
import type { AppSettings } from "$lib/settings.svelte";
import { openUrl } from "@tauri-apps/plugin-opener";
import { HelpCircle } from "lucide-svelte";
import SettingToggle from "../SettingToggle.svelte";
import SettingSegmented from "../SettingSegmented.svelte";

const { draft, onchange }: { draft: AppSettings; onchange: () => void } = $props();
</script>

<div class="section-label">AI</div>

<SettingToggle
    title="Enable AI features"
    description="Enable AI panels, auto-AI collaborator, and AI-powered tools"
    checked={draft.aiEnabled}
    ariaLabel="Toggle AI features"
    onchange={(checked) => {
        draft.aiEnabled = checked;
        onchange();
    }}
>
    {#snippet titleExtra()}
        <button
            onclick={() => openUrl("https://quillium.bryanhu.com/blog/ai-is-not-the-point")}
            aria-label="Why is this off by default?"
            title="Why is this off by default?"
            class="text-black/25 hover:text-black/50 transition-colors"
        >
            <HelpCircle size={13} />
        </button>
    {/snippet}
</SettingToggle>

{#if draft.aiEnabled}
    <SettingSegmented
        title="AI panel layout"
        description={draft.aiSidebarLayout === "combined"
            ? "One assistant with selectable document tools and separate response preferences. Past discussions are preserved."
            : "Chat, Feedback, and Revise each have their own panel and history. Choose One assistant to try it."}
        options={[["separate", "Separate panels"], ["combined", "One assistant"]]}
        value={draft.aiSidebarLayout}
        defaultValue="separate"
        onchange={(value) => {
            draft.aiSidebarLayout = value === "combined" ? "combined" : "separate";
            onchange();
        }}
    />

    <SettingToggle
        title="AI suggestion underlines"
        description="Show green underlines in the editor for AI suggestions. When hidden, suggestions still appear in the sidebar."
        checked={draft.showAiSuggestions}
        defaultChecked={true}
        ariaLabel="Toggle AI suggestion underlines"
        onchange={(checked) => {
            draft.showAiSuggestions = checked;
            onchange();
        }}
    />

    <SettingToggle
        title="Collapse context summary"
        description={'Hide the context card in separate AI panels and keep its details in the header info icon. Unified Chat always uses a compact context chip.'}
        checked={draft.collapseContextSummary}
        defaultChecked={false}
        ariaLabel="Toggle collapse context summary"
        onchange={(checked) => {
            draft.collapseContextSummary = checked;
            onchange();
        }}
    />
{/if}
