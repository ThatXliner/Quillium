<script lang="ts">
import { getUser } from "$lib/auth/auth.svelte";
import {
    MAX_RECONNECT_ATTEMPTS,
    collabSession,
    collabState,
    reconnectAttempt,
    registerDocumentForCollab,
    relayConfigured,
} from "$lib/collab";
import type { LiveSessionController } from "$lib/collab/liveSession.svelte";
import { isCollabJoiner } from "$lib/collab/store";
import { currentDocumentTitle } from "$lib/stores";
import { Cloud, Loader2, Radio } from "lucide-svelte";
import InvitePanel from "./invitations/InvitePanel.svelte";
import { roleLabel } from "./invitations/repository";

const {
    authenticated,
    session,
    currentId,
    onopenauth,
    onjoin,
    onpreview,
}: {
    authenticated: boolean;
    session: LiveSessionController;
    currentId: string;
    onopenauth: () => void;
    onjoin: (invitation: string) => void;
    onpreview: () => void;
} = $props();
let joinInput = $state("");
const canManage = $derived(authenticated && !getUser()?.is_anonymous && !$isCollabJoiner);

async function ensureRegistered(): Promise<void> {
    const user = getUser();
    if (!user || !currentId) throw new Error("Open a document and sign in to invite people.");
    await registerDocumentForCollab(currentId, user.id, $currentDocumentTitle || "Untitled");
}
</script>

<div class="grid gap-4">
    <div class="flex items-start gap-3">
        <div
            class="grid size-9 shrink-0 place-items-center rounded-[10px] bg-blue-500/10 text-blue-600"
        >
            <Cloud size={18} />
        </div>
        <div>
            <h3 class="mb-1 text-sm font-semibold text-black/70">Live collaboration</h3>
            <p class="text-xs leading-relaxed text-black/50">
                Write together in your open room. The session ends when the owner leaves.
            </p>
        </div>
    </div>
    {#if authenticated}
        <div class="flex items-center justify-between gap-3 rounded-xl bg-black/[0.025] p-3">
            <div class="flex items-center gap-2.5">
                <Radio size={17} class={session.isLive ? "text-emerald-600" : "text-black/35"} />
                <div>
                    <h3 class="text-sm font-semibold text-black/70">
                        {session.isLive
                            ? $isCollabJoiner
                                ? "You're in a Live Room"
                                : "Live Room is open"
                            : "Live Room is off"}
                    </h3>
                    {#if session.isLive && $isCollabJoiner}<p class="mt-1 text-xs text-black/50">
                            {roleLabel[$collabSession?.role ?? "viewer"]}
                        </p>{/if}
                </div>
            </div>
            <button
                type="button"
                onclick={() => session.toggle()}
                disabled={!session.isLive &&
                    (!canManage || !relayConfigured || !currentId || session.connecting)}
                class="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-[10px] bg-black/[0.055] px-3 text-xs font-semibold text-black/65 hover:bg-black/[0.085] disabled:opacity-45"
                >{#if session.connecting}<Loader2
                        size={14}
                        class="motion-safe:animate-spin"
                    />Connecting{:else if $collabState === "reconnecting"}<Loader2
                        size={14}
                        class="motion-safe:animate-spin"
                    />Retrying {Math.min(
                        $reconnectAttempt,
                        MAX_RECONNECT_ATTEMPTS,
                    )}/{MAX_RECONNECT_ATTEMPTS}{:else if session.isLive}{$isCollabJoiner
                        ? "Leave"
                        : "End session"}{:else}Start room{/if}</button
            >
        </div>
    {/if}
    {#if canManage && currentId && relayConfigured}<InvitePanel
            documentId={currentId}
            isLive={session.isLive}
            {ensureRegistered}
        />{:else if !$isCollabJoiner}<div class="rounded-xl bg-black/[0.035] p-3">
            <p class="text-xs leading-relaxed text-black/55">
                Sign in with a Quillium account to open a room and invite people. You can join an
                invitation without an account.
            </p>
            <button
                type="button"
                onclick={onopenauth}
                class="mt-2 min-h-8 rounded-lg bg-black/5 px-3 text-xs font-semibold text-black/65"
                >Sign in</button
            >
        </div>{/if}
    <form
        onsubmit={(event) => {
            event.preventDefault();
            onjoin(joinInput);
        }}
        class="border-t border-black/[0.065] pt-4"
    >
        <label for="join-invitation" class="mb-2 block text-xs font-semibold text-black/65"
            >Join with an invitation link</label
        >
        <div class="flex flex-wrap gap-2">
            <input
                id="join-invitation"
                bind:value={joinInput}
                autocomplete="off"
                spellcheck="false"
                placeholder="Paste your invitation link"
                class="h-9 min-w-0 flex-1 rounded-[10px] border border-black/10 bg-black/[0.025] px-3 text-xs text-black/65 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/15"
            /><button
                type="submit"
                disabled={!joinInput.trim() || session.connecting}
                class="h-9 rounded-[10px] bg-black/[0.055] px-4 text-xs font-semibold text-black/65 disabled:opacity-45"
                >Join</button
            >
        </div>
    </form>
    <p class="border-t border-black/[0.065] pt-4 text-xs leading-relaxed text-black/50">
        Need a read-only page anyone can open in a browser? <button
            type="button"
            onclick={onpreview}
            class="font-semibold text-blue-700 underline-offset-2 hover:underline"
            >Use Web Preview</button
        >
    </p>
</div>
