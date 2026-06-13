<!--
    MobileMenu.svelte — In-app overflow menu for touch / small viewports.

    The native menu bar (Settings / Library / History / Export)
    is not reachable in a mobile webview, so this component surfaces the
    SAME actions behind a hamburger button. It does not own any of the
    logic: every item just calls a callback prop that maps 1:1 to the
    existing handlers in +page.svelte (toggle settings, goToHistory,
    goToLibrary, toggle licenses, exportDocument).

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
import { DownloadIcon, HistoryIcon, LibraryIcon, MenuIcon, SettingsIcon } from "lucide-svelte";

let {
    onsettings,
    onlibrary,
    onhistory,
    onexport,
}: {
    onsettings: () => void;
    onlibrary: () => void;
    onhistory: () => void;
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
    "flex items-center gap-2 p-2 px-3 mx-2 my-0.5 text-sm text-left text-[color:var(--text)] " +
    "rounded-lg hover:bg-[color:var(--surface)] hover:inset-shadow-sm hover:inset-shadow-[color:var(--inset-highlight)] cursor-pointer";
</script>

<DropdownMenu.Root>
    <DropdownMenu.Trigger
        aria-label="Menu"
        class="fixed bottom-6 right-6 z-50 hidden max-[899px]:flex w-12 h-12 rounded-full
            bg-[color:var(--surface)] backdrop-blur-md inset-shadow-sm inset-shadow-[color:var(--inset-highlight)] shadow-lg
            items-center justify-center text-[color:var(--text)] hover:bg-[color:var(--surface-2)] transition-colors"
    >
        <MenuIcon size={22} />
    </DropdownMenu.Trigger>

    <DropdownMenu.Content
        class="z-50 w-56 bg-[color:var(--surface)] backdrop-blur-md rounded-2xl shadow-xl border border-[color:var(--border)] py-2"
        strategy="absolute"
        side="top"
        align="end"
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
        </DropdownMenu.Group>

        <DropdownMenu.Separator class="my-1 h-px bg-[color:var(--border)] mx-3" />

        <DropdownMenu.Group>
            <DropdownMenu.GroupHeading class="px-5 py-1 text-[11px] font-medium text-[color:var(--text-faint)]">
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
