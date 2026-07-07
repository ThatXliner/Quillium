<!--
    PrivacySection.svelte — Settings: usage analytics + auto-update toggles.
    Mutates the shared settings draft and calls onchange() for live apply.
-->
<script lang="ts">
import type { AppSettings } from "$lib/settings.svelte";
import { openUrl } from "@tauri-apps/plugin-opener";
import { HelpCircle } from "lucide-svelte";
import SettingToggle from "../SettingToggle.svelte";

const { draft, onchange }: { draft: AppSettings; onchange: () => void } = $props();
</script>

<div class="section-label">Privacy</div>

<SettingToggle
    title="Usage analytics"
    description="Help improve Quillium by sending anonymous usage data"
    checked={draft.analyticsEnabled}
    defaultChecked={true}
    ariaLabel="Toggle usage analytics"
    onchange={(checked) => {
        draft.analyticsEnabled = checked;
        onchange();
    }}
>
    {#snippet titleExtra()}
        <button
            onclick={() => openUrl("https://quillium.bryanhu.com/privacy")}
            aria-label="Privacy policy and your data rights"
            title="Privacy policy and your data rights"
            class="text-black/25 hover:text-black/50 transition-colors"
        >
            <HelpCircle size={13} />
        </button>
    {/snippet}
</SettingToggle>

<!-- TODO(#191): restore document sharing toggle when re-enabled -->

<SettingToggle
    title="Check for updates"
    description="Automatically check for new versions on startup"
    checked={draft.checkForUpdates}
    defaultChecked={true}
    ariaLabel="Toggle automatic update checks"
    onchange={(checked) => {
        draft.checkForUpdates = checked;
        onchange();
    }}
/>
