<script lang="ts">
import type { SidebarPanelProps } from "$lib/sidebar/panels";
import { throwingPanelState } from "./probe";

let { active: _active, session: _session }: SidebarPanelProps = $props();

function renderPanel(): string {
    if (throwingPanelState.shouldThrow) {
        throw new Error("fixture panel failure");
    }
    return "Recovered panel";
}
</script>

<div data-testid="throwing-panel">{renderPanel()}</div>
