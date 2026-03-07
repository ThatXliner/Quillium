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
import { invoke } from "@tauri-apps/api/core";
import { DropdownMenu } from "bits-ui";
import {
	Trash2,
	ChevronDown,
	Images,
	FolderPlus,
	SaveIcon,
	FlameIcon,
} from "lucide-svelte";
import posthog from "posthog-js";

/** Scrap the current draft via Tauri and reload the app. */
function scrapDraftAndReload() {
	posthog.capture("draft_scrapped");
	invoke("scrap").then(() => {
		// TODO: a popup when loaded
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
        class="w-12 h-12 rounded-full bg-white/50 backdrop-blur-md inset-shadow-sm inset-shadow-white shadow-md flex items-center justify-center hover:bg-gray-50/30 transition-colors"
    >
        <SaveIcon size={20} />
    </DropdownMenu.Trigger>

    <DropdownMenu.Content
        class="w-fit bg-white/10 backdrop-blur-md rounded-2xl shadow-xl border border-gray-100 py-2"
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
                        class="flex items-center space-x-2 p-2 px-3 mx-3 my-1 text-sm text-left text-gray-700 rounded-lg hover:inset-shadow-white hover:bg-white/60 hover:inset-shadow-sm"
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
