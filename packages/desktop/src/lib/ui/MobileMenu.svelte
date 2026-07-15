<!--
    MobileMenu.svelte — In-app overflow menu for touch / small viewports.

    The native menu bar (Settings / Library / History / Export)
    is not reachable in a mobile webview, so this component surfaces the
    SAME actions behind a hamburger button. It does not own any of the
    logic: every item just calls a callback prop that maps to handlers in
    +page.svelte. Feature-flagged actions are omitted entirely when disabled.

    Desktop is left untouched: the trigger is hidden at >=900px via the
    `max-[899px]:flex` responsive class (it is `hidden` otherwise), so the
    native menu bar remains the only entry point on desktop.

    Placement: a bottom-right floating action button — clear of the editor's
    sticky top toolbar (which owns the top strip) and thumb-reachable. The
    menu opens upward (side="top") so it doesn't run off the bottom edge.
-->
<script lang="ts">
import type { ExportFormat } from "$lib/export";
import { DropdownMenu } from "bits-ui";
import {
    DownloadIcon,
    HistoryIcon,
    LibraryIcon,
    LightbulbIcon,
    MenuIcon,
    SettingsIcon,
} from "lucide-svelte";

let {
    onsettings,
    onlibrary,
    onhistory,
    writingPromptsEnabled,
    onwritingprompt,
    onexport,
}: {
    onsettings: () => void;
    onlibrary: () => void;
    onhistory: () => void;
    writingPromptsEnabled: boolean;
    onwritingprompt: () => void;
    onexport: (format: ExportFormat) => void;
} = $props();

// Export formats surfaced in the menu; flat (no nested submenu) since nested
// submenus are awkward on touch. PDF is intentionally omitted: the PDF export
// command is desktop-only (printpdf does not build for mobile), so cmd_export_pdf
// returns an error on iOS/Android — don't surface a known-broken action.
const exportFormats: { label: string; format: ExportFormat }[] = [
    { label: "Plain text (.txt)", format: "txt" },
    { label: "Markdown (.md)", format: "md" },
    { label: "JSON (.json)", format: "json" },
];

const itemClass =
    "flex items-center gap-2 p-2 px-3 mx-2 my-0.5 text-sm text-left text-gray-700 " +
    "rounded-lg hover:inset-shadow-white hover:bg-white/60 hover:inset-shadow-sm cursor-pointer";
</script>

<DropdownMenu.Root>
    <!-- Two layers: outer carries shadow + radius (no overflow → shadow stays rounded);
         inner carries backdrop-blur + radius + overflow-hidden (clips the blur to the
         corner). In WebKit a single element with backdrop-filter + radius + overflow-hidden
         + box-shadow squares the shadow at the corners; splitting avoids it while still
         clipping the blur. The bits-ui trigger keeps its behavior/aria/ref on the outer. -->
    <DropdownMenu.Trigger
        aria-label="Menu"
        class="fixed bottom-6 right-6 z-50 hidden max-[899px]:flex w-12 h-12 rounded-full
            shadow-lg items-center justify-center text-black/70"
    >
        <div
            class="absolute inset-0 rounded-full overflow-hidden bg-white/60 backdrop-blur-md
                inset-shadow-sm inset-shadow-white hover:bg-gray-50/40 transition-colors"
        ></div>
        <MenuIcon size={22} class="relative" />
    </DropdownMenu.Trigger>

    <!-- Two layers: outer carries shadow + radius (no overflow → shadow stays rounded);
         inner carries backdrop-blur + radius + overflow-hidden + bg + border (clips the
         blur to the corner). In WebKit a single element with backdrop-filter + radius +
         overflow-hidden + box-shadow squares the shadow at the corners; splitting avoids it
         while still clipping the blur. The bits-ui popper positioning stays on the outer. -->
    <DropdownMenu.Content
        class="z-50 w-56 rounded-2xl shadow-xl"
        strategy="absolute"
        side="top"
        align="end"
        preventScroll={false}
        sideOffset={6}
    >
      <div class="rounded-2xl overflow-hidden bg-white/10 backdrop-blur-md border border-gray-100 py-2">
        <DropdownMenu.Group>
            <DropdownMenu.Item class="w-full" onSelect={onsettings}>
                <div class={itemClass}>
                    <SettingsIcon size={16} />
                    <span>Settings</span>
                </div>
            </DropdownMenu.Item>
            <DropdownMenu.Item class="w-full" onSelect={onlibrary}>
                <div class={itemClass}>
                    <LibraryIcon size={16} />
                    <span>Library</span>
                </div>
            </DropdownMenu.Item>
            <DropdownMenu.Item class="w-full" onSelect={onhistory}>
                <div class={itemClass}>
                    <HistoryIcon size={16} />
                    <span>Version History</span>
                </div>
            </DropdownMenu.Item>
            {#if writingPromptsEnabled}
                <DropdownMenu.Item class="w-full" onSelect={onwritingprompt}>
                    <div class={itemClass}>
                        <LightbulbIcon size={16} />
                        <span>Writing Prompt</span>
                    </div>
                </DropdownMenu.Item>
            {/if}
        </DropdownMenu.Group>

        <DropdownMenu.Separator class="my-1 h-px bg-black/10 mx-3" />

        <DropdownMenu.Group>
            <DropdownMenu.GroupHeading class="px-5 py-1 text-[11px] font-medium text-black/35">
                Export
            </DropdownMenu.GroupHeading>
            {#each exportFormats as fmt (fmt.format)}
                <DropdownMenu.Item class="w-full" onSelect={() => onexport(fmt.format)}>
                    <div class={itemClass}>
                        <DownloadIcon size={16} />
                        <span>{fmt.label}</span>
                    </div>
                </DropdownMenu.Item>
            {/each}
        </DropdownMenu.Group>
      </div>
    </DropdownMenu.Content>
</DropdownMenu.Root>
