<script>
import { DropdownMenu } from "bits-ui";
import { Save, ChevronDown, Images, FolderPlus } from "lucide-svelte";
const options = [
	{ name: "New draft", icon: Save },
	{ name: "New project", icon: FolderPlus },
	{ name: "See gallery", icon: Images },
];
</script>

<DropdownMenu.Root>
    <DropdownMenu.Trigger
        class="w-12 h-12 rounded-full bg-white/50 backdrop-blur-md inset-shadow-sm inset-shadow-white shadow-md flex items-center justify-center hover:bg-gray-50/30 transition-colors"
    >
        <Save size={20} />
    </DropdownMenu.Trigger>

    <DropdownMenu.Content
        class="w-fit bg-white/10 backdrop-blur-md rounded-2xl shadow-xl border border-gray-100 py-2"
        strategy="absolute"
        preventScroll={false}
    >
        <!-- <div class="px-4 py-2 flex items-center space-x-2 border-b border-gray-100">
      <input
        type="text"
        placeholder="Delete"
        class="w-full text-sm text-gray-700 focus:outline-none"
      />
      <ChevronDown size={16} class="text-gray-400" />
    </div> -->

        <DropdownMenu.Group>
            {#each options as option}
                <DropdownMenu.Item
                    class="w-full px-3 py-1 text-sm text-left text-gray-700 outline-none"
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
