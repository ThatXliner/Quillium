<!-- McpConnection.svelte — Local MCP install button and setup modal. -->
<script lang="ts">
import { ModalResizeHandles, RestoreSizeButton } from "@quillium/share";
import { invoke } from "@tauri-apps/api/core";
import { CheckIcon, CopyIcon, X } from "lucide-svelte";
import { tick } from "svelte";

interface McpConnectionInfo {
    configuration: string;
}

let open = $state(false);
let dialogEl = $state<HTMLDialogElement>();
let opener = $state<HTMLButtonElement>();
let configuration = $state("");
let client = $state<"codex" | "claude" | "other">("codex");
let server = $state<{ command: string; args: string[] } | null>(null);
let loadError = $state("");
let copyStatus = $state<"idle" | "copied" | "error">("idle");
let copyTimer: ReturnType<typeof setTimeout>;
let restoreSize = $state<(() => void) | undefined>();

$effect(() => {
    if (open && dialogEl && !dialogEl.open) dialogEl.showModal();
});

async function showSetup(): Promise<void> {
    open = true;
    copyStatus = "idle";
    loadError = "";
    try {
        configuration = (await invoke<McpConnectionInfo>("cmd_mcp_connection_info")).configuration;
        server = JSON.parse(configuration).mcpServers.quillium;
    } catch (error) {
        loadError = error instanceof Error ? error.message : String(error);
    }
}

async function close(): Promise<void> {
    open = false;
    await tick();
    opener?.focus();
}

async function copyConfiguration(text = configuration): Promise<void> {
    clearTimeout(copyTimer);
    try {
        await navigator.clipboard.writeText(text);
        copyStatus = "copied";
    } catch {
        copyStatus = "error";
    }
    copyTimer = setTimeout(() => {
        copyStatus = "idle";
    }, 3000);
}
</script>

<button bind:this={opener} type="button" onclick={showSetup} aria-haspopup="dialog" class="mcp-button">
    <svg aria-hidden="true" viewBox="0 0 195 195" class="h-[22px] w-[22px] shrink-0">
        <path d="M25 97.853 92.882 29.971c9.373-9.373 24.569-9.373 33.941 0 9.373 9.372 9.373 24.568 0 33.941l-51.265 51.265" />
        <path d="m76.265 114.47 50.558-50.558c9.373-9.373 24.569-9.373 33.942 0l.353.353c9.373 9.373 9.373 24.569 0 33.941L99.725 159.6a8 8 0 0 0 0 11.313l12.606 12.607" />
        <path d="m109.853 46.941-50.205 50.205c-9.372 9.372-9.372 24.568 0 33.941 9.373 9.372 24.569 9.372 33.941 0l50.205-50.205" />
    </svg>
    <span>Add MCP</span>
</button>

{#if open}
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
    <dialog
        bind:this={dialogEl}
        class="mcp-modal"
        aria-labelledby="mcp-modal-title"
        onclick={(event) => { if (event.target === event.currentTarget) void close(); }}
        oncancel={(event) => { event.preventDefault(); void close(); }}
    >
        <div class="mcp-modal-inner">
            <header class="flex items-center justify-between border-b border-black/[0.06] px-5 py-3.5">
                <div class="flex items-center gap-2.5">
                    <div class="mcp-mark">
                        <svg aria-hidden="true" viewBox="0 0 195 195" class="h-[19px] w-[19px]">
                            <path d="M25 97.853 92.882 29.971c9.373-9.373 24.569-9.373 33.941 0 9.373 9.372 9.373 24.568 0 33.941l-51.265 51.265" />
                            <path d="m76.265 114.47 50.558-50.558c9.373-9.373 24.569-9.373 33.942 0l.353.353c9.373 9.373 9.373 24.569 0 33.941L99.725 159.6a8 8 0 0 0 0 11.313l12.606 12.607" />
                            <path d="m109.853 46.941-50.205 50.205c-9.372 9.372-9.372 24.568 0 33.941 9.373 9.372 24.569 9.372 33.941 0l50.205-50.205" />
                        </svg>
                    </div>
                    <div>
                        <h2 id="mcp-modal-title" class="text-sm font-semibold text-black/75">Add Quillium to your AI app</h2>
                        <p class="text-[10px] text-black/35">Local Model Context Protocol</p>
                    </div>
                </div>
                <div class="flex items-center gap-1">
                    <RestoreSizeButton {restoreSize} />
                    <button type="button" onclick={() => void close()} aria-label="Close MCP setup" class="flex items-center gap-1 rounded-md py-1 pl-1.5 pr-1 text-black/25 hover:bg-black/5 hover:text-black/55">
                        <span class="font-mono text-[9px] text-black/20">esc</span><X size={15} />
                    </button>
                </div>
            </header>

            <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
                <div class="rounded-xl border border-black/[0.06] bg-black/[0.025] px-3.5 py-3">
                    <p class="text-[12px] leading-relaxed text-black/55">Quillium runs a private MCP server on this computer. Connected apps can read every non-trashed document, but cannot edit or delete your writing.</p>
                </div>

                <div class="flex gap-1 rounded-xl bg-black/5 p-1" aria-label="Choose your AI app">
                    {#each ["codex", "claude", "other"] as choice}
                        <button type="button" aria-pressed={client === choice}
                            class="flex-1 rounded-lg px-3 py-2 text-xs font-medium {client === choice ? 'bg-white shadow-sm text-black/80' : 'text-black/45 hover:text-black/70'}"
                            onclick={() => { client = choice as typeof client; copyStatus = "idle"; }}>
                            {choice === "codex" ? "Codex" : choice === "claude" ? "Claude Desktop" : "Other apps"}
                        </button>
                    {/each}
                </div>

                {#if client === "codex"}
                    <ol class="install-steps">
                        <li>In Codex, open <strong>Settings → MCP servers → Add server</strong>.</li>
                        <li>Name it <strong>quillium</strong> and choose <strong>STDIO</strong>.</li>
                        <li>Copy the command below into <strong>Command</strong>. Add each argument separately, in the order shown.</li>
                        <li>Save, then select <strong>Restart</strong>. Start a new chat and ask “List my Quillium documents.”</li>
                    </ol>
                    {#if server}
                        {#each [{ label: "Command", value: server.command }, ...server.args.map((value, index) => ({ label: `Argument ${index + 1}`, value }))] as field}
                            <div class="flex items-center gap-3 rounded-lg border border-black/10 px-3 py-2">
                                <div class="min-w-0 flex-1"><p class="text-[10px] text-black/45">{field.label}</p><code class="block break-all text-xs">{field.value}</code></div>
                                <button type="button" aria-label={`Copy ${field.label.toLowerCase()}`} onclick={() => copyConfiguration(field.value)} class="rounded p-2 hover:bg-black/5"><CopyIcon size={14} /></button>
                            </div>
                        {/each}
                        <p role="status" class="text-xs text-black/50">{copyStatus === "copied" ? "Copied" : copyStatus === "error" ? "Copy failed. Select and copy the value above." : ""}</p>
                    {/if}
                {:else if client === "claude"}
                    <ol class="install-steps">
                        <li>Open the <strong>Claude desktop app</strong>. From its application menu, choose <strong>Settings → Developer → Edit Config</strong>.</li>
                        <li>Open <code>claude_desktop_config.json</code> in a text editor and paste the configuration below. If you already have servers, add only the <code>quillium</code> entry inside the existing <code>mcpServers</code> object.</li>
                        <li>Save the file, fully quit Claude, then reopen it.</li>
                        <li>Start a new chat and ask “List my Quillium documents.” Allow the Quillium tools when prompted.</li>
                    </ol>
                {:else}
                    <p class="text-xs leading-relaxed text-black/60">For local clients that accept <code>mcpServers</code> JSON, merge the configuration below into their MCP configuration file, then restart the client. For clients with a setup form, use the command and arguments from the Codex tab.</p>
                {/if}

                {#if configuration && client !== "codex"}
                    <pre class="max-h-36 overflow-auto rounded-xl bg-black p-3 text-[10px] leading-relaxed text-white/65"><code>{configuration}</code></pre>
                    <button type="button" onclick={() => copyConfiguration()} class="flex w-full items-center justify-center gap-2 rounded-xl bg-black py-3 text-xs font-semibold text-white transition-transform hover:scale-[1.01] active:scale-[0.99]">
                        {#if copyStatus === "copied"}<CheckIcon size={14} /> Configuration copied
                        {:else if copyStatus === "error"}Copy failed. Try again
                        {:else}<CopyIcon size={14} /> Copy configuration{/if}
                    </button>
                {:else if loadError}
                    <p class="rounded-xl border border-red-200/70 bg-red-50/60 px-3.5 py-3 text-[11px] text-red-700/80">Quillium could not prepare the configuration. {loadError}</p>
                {:else if !configuration}
                    <div class="h-24 animate-pulse rounded-xl bg-black/[0.04]"></div>
                {/if}
            </div>
            <ModalResizeHandles bind:restoreSize minWidth={480} minHeight={420} />
        </div>
    </dialog>
{/if}

<style>
    .mcp-button { display:flex; width:100%; align-items:center; justify-content:center; gap:.625rem; border-radius:.75rem; background:#050505; padding:.8rem 1rem; color:white; font-size:.8rem; font-weight:650; letter-spacing:-.01em; box-shadow:0 8px 20px rgba(0,0,0,.16); transition:transform 180ms ease,background 180ms ease; }
    .mcp-button svg,.mcp-mark svg { fill:none; stroke:currentColor; stroke-width:12; stroke-linecap:round; }
    .mcp-button { position:relative; isolation:isolate; border:1px solid #ffffff18; background:linear-gradient(160deg,#242424,#080808 65%); transition:transform 350ms cubic-bezier(.2,.8,.2,1),box-shadow 350ms ease; }
    .mcp-button::before { content:""; position:absolute; inset:-3px; z-index:-2; border-radius:inherit; background:linear-gradient(110deg,#818cf8,#c084fc,#f472b6,#fb923c,#818cf8); background-size:300% 100%; filter:blur(9px); opacity:0; transition:opacity 450ms ease; animation:mcp-spectrum 6s linear infinite; pointer-events:none; }
    .mcp-button::after { content:""; position:absolute; inset:0; z-index:-1; border-radius:inherit; background:linear-gradient(160deg,#242424,#080808 65%); pointer-events:none; }
    .mcp-button:hover,.mcp-button:focus-visible { transform:translateY(-2px); box-shadow:0 10px 24px #0003; }
    .mcp-button:hover::before,.mcp-button:focus-visible::before { opacity:.85; }
    .mcp-button:focus-visible { outline:2px solid #a5b4fc; outline-offset:4px; }
    @keyframes mcp-spectrum { to { background-position:300% 0; } }
    .install-steps { list-style:decimal; padding-left:1.25rem; display:grid; gap:.85rem; font-size:.75rem; line-height:1.6; color:#0009; }
    .install-steps strong { font-weight:600; color:#000c; }
    .mcp-button:active { transform:translateY(0) scale(.99); }
    .mcp-modal { display:flex; width:100vw; height:100vh; max-width:100vw; max-height:100vh; align-items:center; justify-content:center; border:0; background:transparent; padding:0; }
    .mcp-modal::backdrop { background:rgba(0,0,0,.25); backdrop-filter:blur(4px); }
    .mcp-modal-inner { position:relative; display:flex; width:540px; max-height:82vh; flex-direction:column; overflow:hidden; border-radius:1rem; background:white; box-shadow:0 25px 50px -12px rgba(0,0,0,.24); }
    .mcp-mark { display:flex; width:2rem; height:2rem; align-items:center; justify-content:center; border-radius:.5rem; background:black; color:white; }
    @media (prefers-reduced-motion:reduce) { .mcp-button,.mcp-button::before { animation:none; transition:none; } .mcp-button:hover,.mcp-button:focus-visible { transform:none; } }
</style>
