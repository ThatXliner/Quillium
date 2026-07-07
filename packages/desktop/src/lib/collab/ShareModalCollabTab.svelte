<!--
    ShareModalCollabTab.svelte — "Omni" (live collaboration) tab of the share
    modal.

    Presentational: renders the Live Room toggle, room-id copy/join controls,
    and the Omni upsell for signed-out users. Session lifecycle lives in the
    LiveSessionController passed from GoLiveButton.
-->
<script lang="ts">
import {
    MAX_RECONNECT_ATTEMPTS,
    collabState,
    reconnectAttempt,
    relayConfigured,
} from "$lib/collab";
import type { LiveSessionController } from "$lib/collab/liveSession.svelte";
import { isCollabJoiner } from "$lib/collab/store";
import { OMNI_WAITLIST_URL } from "$lib/constants";
import { ArrowLeftRight, Cloud, Copy, ExternalLink, Loader2, LogIn, Radio } from "lucide-svelte";
import { toast } from "svelte-sonner";

const {
    authenticated,
    session,
    currentId,
    onopenauth,
}: {
    authenticated: boolean;
    session: LiveSessionController;
    currentId: string;
    onopenauth: () => void;
} = $props();

let joinIdInput = $state("");

function copyId() {
    navigator.clipboard.writeText(currentId);
    toast.success("Document ID copied");
}

async function joinById() {
    if (await session.join(joinIdInput)) {
        joinIdInput = "";
    }
}
</script>

{#if authenticated}
    <div class="grid gap-4">
        <div class="flex items-start gap-3">
            <div class="grid size-9 shrink-0 place-items-center rounded-[10px] bg-blue-500/10 text-blue-600">
                <Cloud size={18} />
            </div>
            <div>
                <h3 class="mb-1 text-sm/[1.25] font-[650] text-black/70">Live collaboration</h3>
                <p class="m-0 text-xs/[1.45] text-black/50">
                    Bring another writer into this draft right now. Omni will expand this into
                    persistent sync later, but this room flow still works today.
                </p>
            </div>
        </div>
    </div>

    <div class="flex items-center justify-between gap-[18px] pt-2.5 max-[520px]:flex-col max-[520px]:items-stretch">
        <div class="flex items-center gap-3">
            <div class={`grid size-9 shrink-0 place-items-center rounded-[10px] ${session.isLive ? "bg-emerald-500/10 text-emerald-600" : "bg-black/[0.055] text-black/35"}`}>
                <Radio size={17} />
            </div>
            <div>
                <h3 class="mb-1 text-sm/[1.25] font-[650] text-black/70">{session.isLive ? ($isCollabJoiner ? "You're in a Live Room" : "Live Room is open") : "Live Room is off"}</h3>
                <p class="m-0 text-xs/[1.45] text-black/50">Invite another writer into this draft.</p>
            </div>
        </div>
        <button
            onclick={() => session.toggle()}
            disabled={!session.isLive && !(authenticated && relayConfigured && !!currentId && !session.connecting)}
            class={`inline-flex min-h-[38px] min-w-[142px] items-center justify-center gap-[7px] rounded-[10px] border px-4 text-[13px] font-[650] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] transition-[background,color,opacity] duration-150 disabled:cursor-not-allowed disabled:opacity-45 max-[520px]:w-full ${session.isLive ? "border-black/[0.08] bg-black/[0.055] text-black/65 hover:bg-black/[0.085] hover:text-black/80" : "border-emerald-500/20 bg-emerald-500/10 text-black/70 hover:bg-emerald-500/20 hover:text-emerald-800"}`}
        >
            {#if session.connecting}
                <span class="animate-spin" aria-hidden="true">
                    <Loader2 size={15} />
                </span>
                Connecting
            {:else if $collabState === "reconnecting"}
                <span class="animate-spin" aria-hidden="true">
                    <Loader2 size={15} />
                </span>
                Retrying {Math.min($reconnectAttempt, MAX_RECONNECT_ATTEMPTS)}/{MAX_RECONNECT_ATTEMPTS}
            {:else if session.isLive}
                {$isCollabJoiner ? "Leave" : "End session"}
            {:else}
                <Radio size={15} />
                Start live room
            {/if}
        </button>
    </div>

    <div class="mt-[14px] border-t border-black/[0.065] pt-[14px]">
        <div class="grid gap-0.5">
            <span class="text-[13px] font-bold text-black/70">Room details</span>
            <span class="text-xs/[1.4] text-black/[0.44]">Copy this room ID or join another room</span>
        </div>

        <div class="mt-3 grid gap-3">
            <div>
                <div class="mb-1.5 block text-[11px] font-[650] text-black/50">Room ID</div>
                <div class="flex gap-2 max-[520px]:flex-col">
                    <input
                        readonly
                        value={currentId}
                        aria-label="Current document room ID"
                        class="h-9 min-w-0 flex-1 rounded-[10px] border border-black/[0.08] bg-blue-600/[0.04] px-2.5 font-mono text-[11px] text-black/65 outline-none transition-[border-color,box-shadow] focus:border-blue-600/40 focus:shadow-[0_0_0_3px_rgba(37,99,235,0.12)]"
                    />
                    <button
                        onclick={copyId}
                        disabled={!currentId}
                        aria-label="Copy document room ID"
                        class="inline-flex h-9 min-w-[76px] items-center justify-center gap-1.5 rounded-[10px] bg-black/[0.055] px-3 text-xs font-[650] text-black/60 transition-[background,color,opacity] duration-150 hover:bg-black/[0.085] hover:text-black/75 disabled:cursor-not-allowed disabled:opacity-45 max-[520px]:w-full"
                    >
                        <Copy size={14} />
                        Copy
                    </button>
                </div>
            </div>

            <form
                onsubmit={(e) => {
                    e.preventDefault();
                    joinById();
                }}
            >
                <label for="join-id" class="mb-1.5 block text-[11px] font-[650] text-black/50">Join with room ID</label>
                <div class="flex gap-2 max-[520px]:flex-col">
                    <input
                        id="join-id"
                        bind:value={joinIdInput}
                        placeholder="Paste UUID..."
                        autocomplete="off"
                        class="h-9 min-w-0 flex-1 rounded-[10px] border border-black/[0.08] bg-black/[0.035] px-2.5 font-mono text-[11px] text-black/65 outline-none transition-[border-color,box-shadow] focus:border-blue-600/40 focus:shadow-[0_0_0_3px_rgba(37,99,235,0.12)]"
                    />
                    <button
                        type="submit"
                        disabled={session.connecting || !joinIdInput.trim()}
                        class="inline-flex h-9 min-w-[76px] items-center justify-center gap-1.5 rounded-[10px] bg-black/[0.055] px-3 text-xs font-[650] text-black/60 transition-[background,color,opacity] duration-150 hover:bg-black/[0.085] hover:text-black/75 disabled:cursor-not-allowed disabled:opacity-45 max-[520px]:w-full"
                    >
                        Join
                    </button>
                </div>
            </form>
        </div>
    </div>

    <div class="mt-[14px] flex items-center justify-end max-[520px]:justify-start">
        <a
            href={OMNI_WAITLIST_URL}
            target="_blank"
            rel="noreferrer"
            class="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-[650] text-black/50 transition-colors duration-150 hover:text-black/70"
        >
            Learn about Omni
            <ExternalLink size={14} />
        </a>
    </div>

    <div class="mt-[18px] border-t border-black/[0.065] pt-4">
        <div class="mb-2 text-[10px] font-[750] uppercase tracking-[0.06em] text-black/35">In the making</div>
        <div class="flex items-start gap-3 rounded-xl bg-black/[0.035] p-3 opacity-70">
            <div class="grid size-9 shrink-0 place-items-center rounded-[10px] bg-black/[0.055] text-black/35">
                <ArrowLeftRight size={17} />
            </div>
            <div>
                <h3 class="mb-1 text-sm/[1.25] font-[650] text-black/70">Async Collaboration</h3>
                <p class="m-0 text-xs/[1.45] text-black/50">
                    Stored on our servers to stay available even after you close Quillium.
                </p>
            </div>
        </div>
        <div class="mt-2 flex items-start gap-3 rounded-xl bg-black/[0.035] p-3 opacity-70">
            <div class="grid size-9 shrink-0 place-items-center rounded-[10px] bg-black/[0.055] text-black/35">
                <Cloud size={17} />
            </div>
            <div>
                <h3 class="mb-1 text-sm/[1.25] font-[650] text-black/70">Cloud Sync</h3>
                <p class="m-0 text-xs/[1.45] text-black/50">Make this document available on all of your devices.</p>
            </div>
        </div>
    </div>
{:else}
    <div class="grid gap-4">
        <div class="flex items-start gap-3">
            <div class="grid size-9 shrink-0 place-items-center rounded-[10px] bg-blue-500/10 text-blue-600">
                <Cloud size={18} />
            </div>
            <div>
                <h3 class="mb-1 text-sm/[1.25] font-[650] text-black/70">Collaboration is part of Quillium Omni</h3>
                <p class="m-0 text-xs/[1.45] text-black/50">
                    Live Room, shared invites, cloud sync, and the rest of Quillium's collaboration
                    features are available exclusively to Omni users.
                </p>
            </div>
        </div>

        <div class="grid gap-2.5 rounded-2xl border border-black/[0.055] bg-black/[0.035] px-4 py-[14px]">
            <div class="grid gap-1">
                <span class="text-[10px] font-[750] uppercase tracking-[0.06em] text-black/40">Account</span>
                <strong class="break-words text-[13px]/[1.45] text-black/75">Not signed in</strong>
            </div>
            <div class="grid gap-1">
                <span class="text-[10px] font-[750] uppercase tracking-[0.06em] text-black/40">Status</span>
                <strong class="break-words text-[13px]/[1.45] text-black/75">Omni is currently waitlist only</strong>
            </div>
            <div class="grid gap-1">
                <span class="text-[10px] font-[750] uppercase tracking-[0.06em] text-black/40">Access</span>
                <strong class="break-words text-[13px]/[1.45] text-black/75">You can't sign up for Omni directly yet. Join the waitlist to get access.</strong>
            </div>
        </div>

        <div class="mt-1 flex flex-wrap gap-2.5 max-[520px]:flex-col max-[520px]:items-stretch">
            <a
                href={OMNI_WAITLIST_URL}
                target="_blank"
                rel="noreferrer"
                class="inline-flex min-h-[38px] flex-1 basis-[220px] items-center justify-center gap-[7px] rounded-[10px] bg-blue-600 px-4 text-[13px] font-[650] text-white transition-[background,opacity] duration-150 hover:bg-blue-700"
            >
                <ExternalLink size={15} />
                Join the Omni waitlist
            </a>

            <button
                class="inline-flex min-h-[38px] items-center justify-center gap-[7px] rounded-[10px] bg-black/[0.055] px-4 text-[13px] font-[650] text-black/70 transition-[background,color] duration-150 hover:bg-black/[0.085] hover:text-black/80 max-[520px]:w-full"
                onclick={onopenauth}
            >
                <LogIn size={15} />
                Sign in
            </button>
        </div>
    </div>

    <div class="mt-[18px] border-t border-black/[0.065] pt-4">
        <div class="flex items-start gap-3">
            <div class="grid size-9 shrink-0 place-items-center rounded-[10px] bg-black/[0.055] text-black/35">
                <ArrowLeftRight size={17} />
            </div>
            <div>
                <h3 class="mb-1 text-sm/[1.25] font-[650] text-black/70">Already have access?</h3>
                <p class="m-0 text-xs/[1.45] text-black/50">
                    Sign in with the account tied to your Omni invite once access has been enabled for you.
                </p>
            </div>
        </div>
    </div>
{/if}
