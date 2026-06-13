<!--
    Save.svelte — Glassmorphic dropdown menu for document actions.

    Rendered inside the StatusBar. Provides destructive document
    operations (currently "Scrap draft") behind a dropdown trigger
    styled with backdrop-blur and inset shadows to match the
    neumorphic/glassmorphic design language.

    Interacts with:
      - Tauri backend via `invoke("scrap")` to delete the current
        draft on disk, then reloads the page for a fresh start.
      - PostHog for analytics event tracking ("draft_scrapped").
-->
<script>
import posthog from "$lib/posthog";
import { invoke } from "@tauri-apps/api/core";
import { DropdownMenu } from "bits-ui";
import { ChevronDown, FlameIcon, FolderPlus, Images, SaveIcon, Trash2 } from "lucide-svelte";

/** Scrap the current draft via Tauri and reload the app. */
function scrapDraftAndReload() {
    posthog.capture("draft_scrapped");
    invoke("scrap").then(() => {
        // See issue #80: show a confirmation toast after reload.
        window.location.reload();
    });
}

const options = [
    // {
    // 	name: "Clear history",
    // 	icon: FlameIcon,
    // 	props: {
    // 		onclick: () => {
    //
    // 		},
    // 	},
    // },
    {
        name: "Scrap draft",
        icon: Trash2,
        props: {
            onclick: scrapDraftAndReload,
        },
    },
    // {
    // 	name: "New project",
    // 	icon: FolderPlus,
    // 	props: { onclick: () => console.log("New project") },
    // },
    // {
    // 	name: "See gallery",
    // 	icon: Images,
    // 	props: { onclick: () => console.log("See gallery") },
    // },
];
</script>

<DropdownMenu.Root>
    <DropdownMenu.Trigger
        class="w-12 h-12 rounded-full bg-[color:var(--surface)] backdrop-blur-md inset-shadow-sm inset-shadow-[color:var(--inset-highlight)] shadow-md flex items-center justify-center hover:bg-[color:var(--surface-2)] transition-colors"
    >
        <SaveIcon size={20} />
    </DropdownMenu.Trigger>

    <DropdownMenu.Content
        class="w-fit bg-[color:var(--surface)] backdrop-blur-md rounded-2xl shadow-xl border border-[color:var(--border)] py-2"
        strategy="absolute"
        preventScroll={false}
    >
        <DropdownMenu.Group>
            {#each options as option}
                <DropdownMenu.Item
                    class="w-full"
                    {...option.props}
                >
                    <div
                        class="flex items-center space-x-2 p-2 px-3 mx-3 my-1 text-sm text-left text-[color:var(--text)] rounded-lg hover:bg-[color:var(--surface-2)]"
                    >
                        <!-- <div class="flex items-center space-x-2 p-2 px-3 rounded-lg hover:inset-shadow-gray-400 hover:inset-shadow-sm"> -->
                        <svelte:component this={option.icon} size={16} />
                        <span>{option.name}</span>
                    </div>
                </DropdownMenu.Item>
            {/each}
        </DropdownMenu.Group>
    </DropdownMenu.Content>
</DropdownMenu.Root>
