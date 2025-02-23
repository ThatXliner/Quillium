<script>
import { DropdownMenu } from "bits-ui";
import { Save, ChevronDown, FileEdit, Images, FolderPlus } from "lucide-svelte";
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger class="w-12 h-12 rounded-full bg-white shadow-lg flex items-center justify-center hover:bg-gray-50 transition-colors">
      <Save size={20} class="text-gray-700" />
  </DropdownMenu.Trigger>

  <DropdownMenu.Content class="w-48 bg-white rounded-lg shadow-xl border border-gray-100 py-2 z-[99]!important"
      strategy="absolute"
      preventScroll={false}

  >
    <div class="px-4 py-2 flex items-center space-x-2 border-b border-gray-100">
      <input
        type="text"
        placeholder="Delete"
        class="w-full text-sm text-gray-700 focus:outline-none"
      />
      <ChevronDown size={16} class="text-gray-400" />
    </div>

    <DropdownMenu.Group class="py-1">
      <DropdownMenu.Item class="w-full px-4 py-2 text-sm text-left text-gray-700 hover:bg-gray-50 flex items-center space-x-2 outline-none">
        <FileEdit size={16} />
        <span>New draft</span>
      </DropdownMenu.Item>

      <DropdownMenu.Item class="w-full px-4 py-2 text-sm text-left text-gray-700 hover:bg-gray-50 flex items-center space-x-2 outline-none">
        <Images size={16} />
        <span>See gallery</span>
      </DropdownMenu.Item>

      <DropdownMenu.Item class="w-full px-4 py-2 text-sm text-left text-gray-700 hover:bg-gray-50 flex items-center space-x-2 outline-none">
        <FolderPlus size={16} />
        <span>New project</span>
      </DropdownMenu.Item>
    </DropdownMenu.Group>
  </DropdownMenu.Content>
</DropdownMenu.Root>
