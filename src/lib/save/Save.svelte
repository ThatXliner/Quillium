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
			onclick: () => {
				invoke("scrap").then(() => {
					// TODO: a popup when loaded
					window.location.reload();
				});
			},
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
                    class="w-full px-3 py-1 text-sm text-left text-gray-700 outline-none"
                    {...option.props}
                >
                    <div
                        class="flex items-center space-x-2 p-2 px-3 rounded-lg hover:inset-shadow-white hover:bg-white/60 hover:inset-shadow-sm"
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
