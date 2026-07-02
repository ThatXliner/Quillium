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
    <!--
        Two layers on purpose. The OUTER element carries the shadow + radius but NO
        overflow clip, and the INNER carries the backdrop-blur + radius + overflow-hidden.
        In WebKit (Tauri) a single element with backdrop-filter + border-radius leaks a
        square blur halo past the corners unless it has overflow:hidden — BUT adding
        overflow:hidden to an element that ALSO has a box-shadow makes WebKit clip the
        shadow to a square. Splitting the two responsibilities fixes both: the shadow
        stays rounded (outer, unclipped) and the blur is clipped to the radius (inner).
    -->
    <DropdownMenu.Trigger class="w-12 h-12 rounded-full shadow-md">
        <div
            class="w-full h-full rounded-full overflow-hidden bg-white/50 backdrop-blur-md inset-shadow-sm inset-shadow-white flex items-center justify-center hover:bg-gray-50/30 transition-colors"
        >
            <SaveIcon size={20} />
        </div>
    </DropdownMenu.Trigger>

    <DropdownMenu.Content
        class="w-fit rounded-2xl shadow-xl"
        strategy="absolute"
        preventScroll={false}
    >
        <!-- See the split comment above: outer keeps shadow+radius, inner clips the blur. -->
        <div
            class="overflow-hidden bg-white/10 backdrop-blur-md rounded-2xl border border-gray-100 py-2"
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
        </div>
    </DropdownMenu.Content>
</DropdownMenu.Root>
