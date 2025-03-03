<script>
import { invoke } from "@tauri-apps/api/core";
import { Label, Popover } from "bits-ui";
import { Trash2, SettingsIcon } from "lucide-svelte";
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
<Popover.Root>
	<Popover.Trigger class="w-12 h-12 rounded-full bg-blue-100/70 backdrop-blur-md inset-shadow-sm inset-shadow-white shadow-md flex items-center justify-center hover:bg-blue-400/30 transition-colors">
	<SettingsIcon size={20} />

	</Popover.Trigger>
	<Popover.Content class="w-fit bg-white/10 backdrop-blur-md rounded-2xl shadow-xl border border-gray-100 py-2"
        strategy="absolute"
        preventScroll={false}>
            <input type="text" placeholder="Enter text">
            <!-- <div class="grid gap-4">
                  <div class="space-y-2">
                    <h4 class="font-medium leading-none">Dimensions</h4>
                    <p class="text-muted-foreground text-sm">
                      Set the dimensions for the layer.
                    </p>
                  </div>
                  <div class="grid gap-2">
                    <div class="grid grid-cols-3 items-center gap-4">
                      <Label.Root for="width">Width</Label.Root>
                      <input id="width" value="100%" class="col-span-2 h-8" />
                    </div>
                    <div class="grid grid-cols-3 items-center gap-4">
                      <Label.Root for="maxWidth">Max. width</Label.Root>
                      <input id="maxWidth" value="300px" class="col-span-2 h-8" />
                    </div>
                    <div class="grid grid-cols-3 items-center gap-4">
                      <Label.Root for="height">Height</Label.Root>
                      <input id="height" value="25px" class="col-span-2 h-8" />
                    </div>
                    <div class="grid grid-cols-3 items-center gap-4">
                      <Label for="maxHeight">Max. height</Label>
                      <input id="maxHeight" value="none" class="col-span-2 h-8" />
                    </div>
                  </div>
                </div> -->
	</Popover.Content>
</Popover.Root>

<!-- <DropdownMenu.Root>
    <DropdownMenu.Trigger

    >

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
                        <svelte:component this={option.icon} size={16} />
                        <span>{option.name}</span>
                    </div>
                </DropdownMenu.Item>
            {/each}
        </DropdownMenu.Group>
    </DropdownMenu.Content>
</DropdownMenu.Root> -->
