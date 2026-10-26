<script lang="ts">
import type { SidebarPanelProps, SidebarPanelSession } from "$lib/sidebar/panels";
import { onMount } from "svelte";
import { panelProbe } from "./probe";

let { active, session }: SidebarPanelProps = $props();
let selection = $state<string | null>(null);

onMount(() => {
    panelProbe.mountCount += 1;
    return () => {
        panelProbe.unmountCount += 1;
    };
});

$effect(() => {
    panelProbe.updates.push({ active, session });
});

function readSelection(): void {
    selection = session?.readSelection() ?? null;
}
</script>

<div data-testid="panel-fixture">
    <p data-testid="panel-active">{active ? "active" : "inactive"}</p>
    <p data-testid="panel-session">
        {session ? `${session.target.documentId ?? "none"}/${session.target.tabId ?? "none"}/${session.target.draftId ?? "none"}` : "none"}
    </p>
    <button type="button" onclick={readSelection}>Read selection</button>
    <p data-testid="panel-selection">{selection ?? "none"}</p>
</div>
