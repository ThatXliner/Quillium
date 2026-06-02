<!--
    MobileMenu.svelte — In-app overflow menu for touch / small viewports.

    The native menu bar (Settings / Library / History / Licenses / Export)
    is not reachable in a mobile webview, so this component surfaces the
    SAME actions behind a hamburger button. It does not own any of the
    logic: every item just calls a callback prop that maps 1:1 to the
    existing handlers in +page.svelte (toggle settings, goToHistory,
    goToLibrary, toggle licenses, exportDocument).

    Desktop is left untouched: the trigger is hidden at >=900px via the
    `max-[899px]:flex` responsive class (it is `hidden` otherwise), so the
    native menu bar remains the only entry point on desktop.
-->
<script lang="ts">
import { DropdownMenu } from "bits-ui";
import {
    MenuIcon,
    SettingsIcon,
    LibraryIcon,
    HistoryIcon,
    ScaleIcon,
    DownloadIcon,
} from "lucide-svelte";
import type { ExportFormat } from "$lib/export";

let {
    onsettings,
    onlibrary,
    onhistory,
    onlicenses,
    onexport,
}: {
    onsettings: () => void;
    onlibrary: () => void;
    onhistory: () => void;
    onlicenses: () => void;
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
    <DropdownMenu.Trigger
        aria-label="Menu"
        class="fixed top-4 left-4 z-50 hidden max-[899px]:flex w-11 h-11 rounded-full
            bg-white/50 backdrop-blur-md inset-shadow-sm inset-shadow-white shadow-md
            items-center justify-center text-black/70 hover:bg-gray-50/30 transition-colors"
    >
        <MenuIcon size={20} />
    </DropdownMenu.Trigger>

    <DropdownMenu.Content
        class="z-50 w-56 bg-white/10 backdrop-blur-md rounded-2xl shadow-xl border border-gray-100 py-2"
        strategy="absolute"
        preventScroll={false}
        sideOffset={6}
    >
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
            <DropdownMenu.Item class="w-full" onSelect={onlicenses}>
                <div class={itemClass}>
                    <ScaleIcon size={16} />
                    <span>Licenses</span>
                </div>
            </DropdownMenu.Item>
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
    </DropdownMenu.Content>
</DropdownMenu.Root>
