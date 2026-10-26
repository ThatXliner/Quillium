<script lang="ts">
import { getUser, signInAnonymously } from "$lib/auth/auth.svelte";
import type { LiveSessionController } from "$lib/collab/liveSession.svelte";
import { ModalResizeHandles, RestoreSizeButton } from "@quillium/share";
import { Loader2, Radio, X } from "lucide-svelte";
import { onMount } from "svelte";
import { get } from "svelte/store";
import { collabSession } from "../store";
import { parseInvitationToken } from "./deepLink";
import {
    InvitationError,
    invitationRepository,
    roleLabel,
    type ResolvedInvitation,
} from "./repository";

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
let stage = $state<"name" | "checking" | "ready" | "ownRoom" | "error">("checking");
let prepared = $state<ResolvedInvitation | null>(null);
let anonymousBusy = $state(false);
let anonymousError = $state("");
let restoreSize = $state<(() => void) | undefined>();
const busy = $derived(session.connecting || anonymousBusy || stage === "checking");
const error = $derived(anonymousError || session.lastJoinError?.message || "");
const title = $derived.by(() => {
    if (stage === "name" || stage === "ready") return "Join a Live Room";
    if (stage === "ownRoom") return "This is your Live Room";
    if (stage === "checking")
        return session.connecting ? "Joining the Live Room" : "Checking your invitation";
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
    if (dialog && !dialog.open) dialog.showModal();
});
$effect(() => {
    stage;
    if (stage === "name") nameInput?.focus();
    else heading?.focus();
});
async function prepare(): Promise<void> {
    const token = parseInvitationToken(invitation);
    if (!token) {
        session.lastJoinError = {
            code: "invalid_invitation",
            message:
                "Check that you copied the whole invitation link, or ask the owner for a new one.",
        };
        stage = "error";
        return;
    }
    stage = "checking";
    anonymousError = "";
    try {
        prepared = await invitationRepository.resolve(token);
        const current = get(collabSession);
        stage =
            session.isLive && current?.isOwner && current.docId === prepared.documentId
                ? "ownRoom"
                : "ready";
    } catch (error) {
        session.lastJoinError =
            error instanceof InvitationError
                ? { code: error.code, message: error.message }
                : {
                      code: "unavailable",
                      message: "Couldn't check this invitation. Try again.",
                  };
        stage = "error";
    }
}

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
        await prepare();
        if (stage === "ready") await join();
    } catch {
        anonymousError =
            "Couldn't create a temporary session. Try again, or sign in with a Quillium account.";
        stage = "error";
    } finally {
        anonymousBusy = false;
    }
}

function signIn(): void {
    onclose();
    onopenauth();
}

onMount(() => {
    if (getUser()) void prepare();
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
                    class="rounded-full p-1.5 text-black/60 hover:bg-black/5 disabled:opacity-40"
                    ><X size={16} /></button
                >
            </div>
        </header>
        {#if stage === "name"}
            <p class="mb-4 text-sm text-black/65">
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
                class="mt-3 min-h-9 text-xs font-semibold text-black/65 hover:text-black/80"
                >Sign in instead</button
            >
        {:else if stage === "ready"}
            <p class="text-sm leading-relaxed text-black/65">
                You'll join with {prepared ? roleLabel[prepared.role] : "invitation"} access.
            </p>
            {#if session.isLive}
                <p
                    role="note"
                    class="mt-3 rounded-xl bg-amber-50 p-3 text-sm leading-relaxed text-black/75"
                >
                    {get(collabSession)?.isOwner
                        ? "Your current Live Room will end and everyone in it will leave."
                        : "You'll leave your current Live Room."} Join this invitation instead?
                </p>
            {/if}
            <div class="mt-5 flex flex-wrap gap-2">
                <button
                    type="button"
                    onclick={() => void join()}
                    class="min-h-10 rounded-[10px] bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700"
                    >{session.isLive
                        ? get(collabSession)?.isOwner
                            ? "End room and join"
                            : "Leave room and join"
                        : "Join"}</button
                >
                <button
                    type="button"
                    onclick={onclose}
                    class="min-h-10 rounded-[10px] bg-black/5 px-4 text-sm font-semibold text-black/65"
                    >Cancel</button
                >
            </div>
        {:else if stage === "ownRoom"}
            <p class="text-sm leading-relaxed text-black/65">
                You're already the owner of this room. It stays open, and everyone can keep writing.
            </p>
            <button
                type="button"
                onclick={onclose}
                class="mt-5 min-h-10 rounded-[10px] bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700"
                >Keep room open</button
            >
        {:else if stage === "checking"}
            <p
                role="status"
                aria-live="polite"
                class="flex items-center gap-2 text-sm text-black/65"
            >
                <Loader2 size={16} class="motion-safe:animate-spin" />{session.connecting
                    ? "Saving your current draft and joining the room."
                    : "Checking your invitation."}
            </p>
        {:else}
            <p role="alert" class="text-sm leading-relaxed text-black/60">
                {error}
            </p>
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
                            if (getUser()) void prepare();
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
