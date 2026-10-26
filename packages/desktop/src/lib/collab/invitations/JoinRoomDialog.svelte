<script lang="ts">
import { getSession, getUser, signInAnonymously } from "$lib/auth/auth.svelte";
import type { LiveSessionController } from "$lib/collab/liveSession.svelte";
import { ModalResizeHandles, RestoreSizeButton } from "@quillium/share";
import { Loader2, Radio, X } from "lucide-svelte";
import { onMount } from "svelte";

const {
    invitation,
    session,
    onclose,
    onopenauth,
}: {
    invitation: string;
    session: LiveSessionController;
    onclose: () => void;
    onopenauth: () => void;
} = $props();
let dialog = $state<HTMLDialogElement>();
let heading = $state<HTMLHeadingElement>();
let nameInput = $state<HTMLInputElement>();
let displayName = $state("");
let stage = $state<"name" | "checking" | "error">("checking");
let anonymousBusy = $state(false);
let anonymousError = $state("");
let suspended = $state(false);
let suspendedToken = $state<string | undefined>();
let restoreSize = $state<(() => void) | undefined>();
const busy = $derived(session.connecting || anonymousBusy);
const error = $derived(anonymousError || session.lastJoinError?.message || "");
const title = $derived.by(() => {
    if (stage === "name") return "Join a Live Room";
    if (stage === "checking") return "Joining the Live Room";
    switch (session.lastJoinError?.code) {
        case "expired_invitation":
            return "This invitation has expired";
        case "revoked_invitation":
            return "The owner turned off this invitation";
        case "invalid_invitation":
            return "This invitation link doesn't work";
        case "insufficient_permission":
            return "This invitation is for another account";
        case "owner_offline":
            return "The owner hasn't opened the room yet";
        case "save_failed":
            return "Quillium couldn't save your draft";
        default:
            return "Couldn't join the Live Room";
    }
});

$effect(() => {
    if (dialog && !suspended && !dialog.open) dialog.showModal();
});
$effect(() => {
    stage;
    if (stage === "name") nameInput?.focus();
    else heading?.focus();
});
$effect(() => {
    if (suspended && getSession()?.access_token && getSession()?.access_token !== suspendedToken) {
        suspended = false;
        void join();
    }
});

async function join(): Promise<void> {
    stage = "checking";
    anonymousError = "";
    if (await session.join(invitation)) onclose();
    else stage = "error";
}

async function joinWithName(): Promise<void> {
    if (!displayName.trim() || displayName.trim().length > 40) return;
    anonymousBusy = true;
    anonymousError = "";
    try {
        await signInAnonymously(displayName.trim());
        await join();
    } catch {
        anonymousError =
            "Couldn't create a temporary session. Try again, or sign in with a Quillium account.";
        stage = "error";
    } finally {
        anonymousBusy = false;
    }
}

function signIn(): void {
    suspendedToken = getSession()?.access_token;
    suspended = true;
    dialog?.close();
    onopenauth();
}

onMount(() => {
    if (getUser()) void join();
    else stage = "name";
});
</script>

<dialog
    bind:this={dialog}
    aria-labelledby="join-room-title"
    oncancel={(event) => {
        event.preventDefault();
        if (!busy) onclose();
    }}
    class="m-auto max-h-[calc(100vh-32px)] w-[min(440px,calc(100vw-32px))] overflow-visible rounded-2xl border border-black/5 bg-white/95 p-0 text-black/75 shadow-xl backdrop:bg-black/20 backdrop:backdrop-blur-[5px]"
>
    <div class="relative flex max-h-[calc(100vh-32px)] flex-col overflow-auto rounded-2xl p-6">
        <header class="mb-4 flex items-start justify-between gap-3">
            <div class="flex items-center gap-2">
                <Radio size={18} />
                <h2
                    bind:this={heading}
                    tabindex="-1"
                    id="join-room-title"
                    class="m-0 text-lg font-semibold outline-none"
                >
                    {title}
                </h2>
            </div>
            <div class="flex shrink-0 items-center gap-1">
                <RestoreSizeButton {restoreSize} /><button
                    type="button"
                    onclick={onclose}
                    disabled={busy}
                    aria-label="Close invitation"
                    class="rounded-full p-1.5 text-black/40 hover:bg-black/5 disabled:opacity-40"
                    ><X size={16} /></button
                >
            </div>
        </header>
        {#if stage === "name"}
            <p class="mb-4 text-sm text-black/55">
                Others in the room see this name. You don't need a Quillium account.
            </p>
            <form
                onsubmit={(event) => {
                    event.preventDefault();
                    void joinWithName();
                }}
                class="grid gap-3"
            >
                <label for="join-display-name" class="text-xs font-semibold">Display name</label>
                <input
                    bind:this={nameInput}
                    id="join-display-name"
                    bind:value={displayName}
                    required
                    maxlength={40}
                    autocomplete="nickname"
                    class="h-10 rounded-[10px] border border-black/15 bg-black/[0.025] px-3 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/15"
                />
                <button
                    type="submit"
                    disabled={busy || !displayName.trim()}
                    class="min-h-10 rounded-[10px] bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
                    >{busy ? "Joining" : "Join"}</button
                >
            </form>
            <button
                type="button"
                onclick={signIn}
                disabled={busy}
                class="mt-3 min-h-9 text-xs font-semibold text-black/55 hover:text-black/80"
                >Sign in instead</button
            >
        {:else if stage === "checking"}
            <p
                role="status"
                aria-live="polite"
                class="flex items-center gap-2 text-sm text-black/55"
            >
                <Loader2 size={16} class="motion-safe:animate-spin" />Checking your invitation and
                saving your current draft.
            </p>
        {:else}
            <p role="alert" class="text-sm leading-relaxed text-black/60">{error}</p>
            <div class="mt-5 flex flex-wrap gap-2">
                {#if session.lastJoinError?.code === "insufficient_permission" || session.lastJoinError?.code === "authentication_required"}
                    <button
                        type="button"
                        onclick={signIn}
                        class="min-h-9 rounded-[10px] bg-blue-600 px-4 text-xs font-semibold text-white"
                        >Sign in with the invited account</button
                    >
                {:else if !["invalid_invitation", "expired_invitation", "revoked_invitation"].includes(session.lastJoinError?.code ?? "")}
                    <button
                        type="button"
                        onclick={() => {
                            if (getUser()) void join();
                            else stage = "name";
                        }}
                        class="min-h-9 rounded-[10px] bg-blue-600 px-4 text-xs font-semibold text-white"
                        >Try again</button
                    >
                {/if}
                <button
                    type="button"
                    onclick={onclose}
                    class="min-h-9 rounded-[10px] bg-black/5 px-4 text-xs font-semibold text-black/60"
                    >Close</button
                >
            </div>
        {/if}
        <ModalResizeHandles bind:restoreSize />
    </div>
</dialog>
