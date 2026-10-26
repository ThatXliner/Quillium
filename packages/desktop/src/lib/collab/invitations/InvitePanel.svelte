<script lang="ts">
import { type LiveRole, LiveRoleSchema } from "@quillium/share/collab-contract";
import { Copy, Link2, Mail, RefreshCw } from "lucide-svelte";
import { toast } from "svelte-sonner";
import { type LiveRoomGrant, invitationRepository, roleHelp, roleLabel } from "./repository";

const {
    documentId,
    isLive,
    ensureRegistered,
}: { documentId: string; isLive: boolean; ensureRegistered: () => Promise<void> } = $props();
let kind = $state<"link" | "email">("link");
let email = $state("");
let role = $state<LiveRole>("commenter");
let expiryDays = $state("7");
let grants = $state<LiveRoomGrant[]>([]);
let loading = $state(false);
let busy = $state("");
let error = $state("");
let confirmRevoke = $state<string | null>(null);
let pendingRole = $state<{ id: string; role: LiveRole } | null>(null);
let freshLinks = $state<Record<string, string>>({});
const order: Record<LiveRole, number> = { viewer: 0, commenter: 1, editor: 2 };

$effect(() => {
    const id = documentId;
    let cancelled = false;
    loading = true;
    error = "";
    void ensureRegistered()
        .then(() => invitationRepository.list(id))
        .then((result) => {
            if (!cancelled) grants = result;
        })
        .catch((cause: unknown) => {
            if (!cancelled)
                error = cause instanceof Error ? cause.message : "Couldn't load invitations.";
        })
        .finally(() => {
            if (!cancelled) loading = false;
        });
    return () => {
        cancelled = true;
    };
});

function status(grant: LiveRoomGrant): string {
    if (grant.revoked_at) return "Revoked";
    if (Date.parse(grant.expires_at) <= Date.now()) return "Expired";
    if (grant.delivery_status === "failed") return "Email failed";
    if (grant.delivery_status === "pending") return "Sending";
    return grant.invited_email ? "Email sent" : "Active";
}
function active(grant: LiveRoomGrant): boolean {
    return !grant.revoked_at && Date.parse(grant.expires_at) > Date.now();
}
function replaceGrant(grant: LiveRoomGrant): void {
    grants = grants.map((item) => (item.id === grant.id ? grant : item));
}
async function perform(id: string, operation: () => Promise<void>): Promise<void> {
    busy = id;
    error = "";
    try {
        await operation();
    } catch (cause) {
        error =
            cause instanceof Error ? cause.message : "Couldn't update this invitation. Try again.";
    } finally {
        busy = "";
    }
}
async function copy(link: string): Promise<void> {
    try {
        await navigator.clipboard.writeText(link);
        toast.success("Invitation link copied");
    } catch {
        error = "Couldn't copy the link. Select the invitation link and copy it manually.";
    }
}
async function create(): Promise<void> {
    await perform("create", async () => {
        const expiresAt = new Date(Date.now() + Number(expiryDays) * 86_400_000).toISOString();
        const result = await invitationRepository.create(documentId, {
            role,
            expiresAt,
            ...(kind === "email" ? { email: email.trim() } : {}),
        });
        grants = [result.grant, ...grants];
        if (kind === "link") freshLinks = { ...freshLinks, [result.grant.id]: result.joinUrl };
        else {
            email = "";
            toast.success("Invitation email sent");
        }
    });
}
function chooseRole(grant: LiveRoomGrant, value: string): void {
    const next = LiveRoleSchema.parse(value);
    if (order[next] < order[grant.role]) {
        pendingRole = { id: grant.id, role: next };
        return;
    }
    void changeRole(grant.id, next);
}
async function changeRole(id: string, next: LiveRole): Promise<void> {
    pendingRole = null;
    await perform(id, async () => {
        replaceGrant(await invitationRepository.changeRole(documentId, id, next));
        toast.success("Invitation access changed");
    });
}
async function revoke(grant: LiveRoomGrant): Promise<void> {
    await perform(grant.id, async () => {
        replaceGrant(await invitationRepository.revoke(documentId, grant.id));
        confirmRevoke = null;
        delete freshLinks[grant.id];
        toast.success("Invitation revoked");
    });
}
async function replaceLink(grant: LiveRoomGrant): Promise<void> {
    await perform(grant.id, async () => {
        const result = await invitationRepository.replace(documentId, grant.id);
        replaceGrant(result.grant);
        freshLinks = { ...freshLinks, [grant.id]: result.joinUrl };
        toast.success("New invitation link created. The old link no longer works.");
    });
}
</script>

<div class="mt-4 border-t border-black/[0.065] pt-4">
    <div class="mb-3 flex items-center justify-between gap-3">
        <h3 class="text-sm font-semibold text-black/70">Invite people</h3>
        <div class="flex rounded-full bg-black/5 p-0.5" aria-label="Invitation method">
            <button
                type="button"
                onclick={() => (kind = "link")}
                aria-pressed={kind === "link"}
                class={`rounded-full px-3 py-1.5 text-xs font-semibold ${kind === "link" ? "bg-white shadow-sm" : "text-black/45"}`}
                >Link</button
            ><button
                type="button"
                onclick={() => (kind = "email")}
                aria-pressed={kind === "email"}
                class={`rounded-full px-3 py-1.5 text-xs font-semibold ${kind === "email" ? "bg-white shadow-sm" : "text-black/45"}`}
                >Email</button
            >
        </div>
    </div>
    <p class="mb-3 text-xs text-black/50">
        {isLive
            ? "People you invite can join while this room is open."
            : "People can join once you start the room."}
    </p>
    <form
        onsubmit={(event) => {
            event.preventDefault();
            void create();
        }}
        class="grid gap-3"
    >
        {#if kind === "email"}<div>
                <label for="invited-email" class="mb-1 block text-xs font-semibold text-black/55"
                    >Email address</label
                ><input
                    id="invited-email"
                    type="email"
                    required
                    bind:value={email}
                    autocomplete="email"
                    placeholder="writer@example.com"
                    class="h-9 w-full rounded-[10px] border border-black/10 bg-black/[0.025] px-3 text-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
                />
            </div>{/if}
        <div class="flex flex-wrap items-end gap-2">
            <div class="min-w-32 flex-1">
                <label for="invite-role" class="mb-1 block text-xs font-semibold text-black/55"
                    >Access</label
                ><select
                    id="invite-role"
                    bind:value={role}
                    aria-describedby="invite-role-help"
                    class="h-9 w-full rounded-[10px] border border-black/10 bg-white px-2 text-xs"
                    ><option value="viewer">Can view</option><option value="commenter"
                        >Can comment</option
                    ><option value="editor">Can edit</option></select
                >
            </div>
            <div>
                <label for="invite-expiry" class="mb-1 block text-xs font-semibold text-black/55"
                    >Expires after</label
                ><select
                    id="invite-expiry"
                    bind:value={expiryDays}
                    class="h-9 rounded-[10px] border border-black/10 bg-white px-2 text-xs"
                    ><option value="1">1 day</option><option value="7">7 days</option><option
                        value="30">30 days</option
                    ></select
                >
            </div>
            <button
                type="submit"
                disabled={!!busy || loading || (kind === "email" && !email.trim())}
                class="h-9 rounded-[10px] bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-45"
                >{busy === "create"
                    ? "Creating"
                    : kind === "link"
                      ? "Create link"
                      : "Send invite"}</button
            >
        </div>
        <p id="invite-role-help" class="text-xs text-black/50">{roleHelp[role]}</p>
    </form>
    {#if error}<p role="alert" class="mt-3 text-xs leading-relaxed text-red-700">{error}</p>{/if}
    <div class="mt-5 border-t border-black/[0.065] pt-4">
        <h3 class="mb-3 text-sm font-semibold text-black/70">Access</h3>
        <p class="mb-3 flex justify-between text-xs text-black/55">
            <span>You</span><span>Owner</span>
        </p>
        {#if loading}<p role="status" class="text-xs text-black/45">
                Loading invitations
            </p>{:else if grants.length === 0}<p class="text-xs text-black/45">
                No invitations yet.
            </p>{:else}<ul class="grid gap-3">
                {#each grants as grant (grant.id)}
                    <li class="rounded-xl border border-black/[0.065] p-3">
                        <div class="flex flex-wrap items-center justify-between gap-2">
                            <div class="min-w-0">
                                <p
                                    class="flex items-center gap-1.5 break-all text-xs font-semibold text-black/65"
                                >
                                    {#if grant.invited_email}<Mail
                                            size={13}
                                        />{grant.invited_email}{:else}<Link2 size={13} />Invitation
                                        link{/if}
                                </p>
                                <p class="mt-1 text-[11px] text-black/45">
                                    {status(grant)} · Expires {new Date(
                                        grant.expires_at,
                                    ).toLocaleDateString()}
                                </p>
                            </div>
                            <select
                                value={grant.role}
                                aria-label={`Access for ${grant.invited_email ?? "invitation link"}`}
                                disabled={!active(grant) || !!busy}
                                onchange={(event) => {
                                    chooseRole(grant, event.currentTarget.value);
                                    event.currentTarget.value = grant.role;
                                }}
                                class="h-8 rounded-lg border border-black/10 bg-white px-2 text-xs disabled:opacity-50"
                                ><option value="viewer">Can view</option><option value="commenter"
                                    >Can comment</option
                                ><option value="editor">Can edit</option></select
                            >
                        </div>
                        {#if freshLinks[grant.id] && active(grant)}<label class="mt-3 block"
                                ><span class="sr-only">Invitation link</span><input
                                    readonly
                                    value={freshLinks[grant.id]}
                                    class="h-8 w-full rounded-lg border border-black/10 bg-black/[0.025] px-2 font-mono text-[10px] text-black/60"
                                /></label
                            >{/if}
                        {#if active(grant)}<div class="mt-2 flex flex-wrap gap-2">
                                {#if !grant.invited_email}{#if freshLinks[grant.id]}<button
                                            type="button"
                                            onclick={() => copy(freshLinks[grant.id])}
                                            class="inline-flex min-h-8 items-center gap-1.5 rounded-lg bg-black/5 px-2.5 text-xs font-semibold text-black/60"
                                            ><Copy size={12} />Copy link</button
                                        >{:else}<button
                                            type="button"
                                            disabled={!!busy}
                                            onclick={() => replaceLink(grant)}
                                            class="inline-flex min-h-8 items-center gap-1.5 rounded-lg bg-black/5 px-2.5 text-xs font-semibold text-black/60 disabled:opacity-50"
                                            ><RefreshCw size={12} />Replace link</button
                                        >{/if}{/if}
                                <button
                                    type="button"
                                    disabled={!!busy}
                                    onclick={() => {
                                        if (confirmRevoke === grant.id) void revoke(grant);
                                        else confirmRevoke = grant.id;
                                    }}
                                    class="min-h-8 rounded-lg px-2.5 text-xs font-semibold text-black/50 hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
                                    >{confirmRevoke === grant.id
                                        ? "Confirm revoke"
                                        : "Revoke"}</button
                                >
                                {#if confirmRevoke === grant.id}<button
                                        type="button"
                                        onclick={() => (confirmRevoke = null)}
                                        class="min-h-8 text-xs text-black/50">Cancel</button
                                    >{/if}
                            </div>{/if}
                        {#if !freshLinks[grant.id] && !grant.invited_email && active(grant)}<p
                                class="mt-1 text-[11px] text-black/45"
                            >
                                Replacing a link ends access through the old link.
                            </p>{/if}
                        {#if pendingRole?.id === grant.id}<div
                                class="mt-2 rounded-lg bg-black/[0.035] p-2 text-xs text-black/60"
                            >
                                <p>
                                    Changing to {roleLabel[pendingRole.role]} disconnects people using
                                    this invitation. They can rejoin with their new access.
                                </p>
                                <div class="mt-2 flex gap-3">
                                    <button
                                        type="button"
                                        onclick={() => {
                                            if (pendingRole)
                                                void changeRole(grant.id, pendingRole.role);
                                        }}
                                        class="font-semibold">Change access</button
                                    ><button type="button" onclick={() => (pendingRole = null)}
                                        >Keep current access</button
                                    >
                                </div>
                            </div>{/if}
                    </li>
                {/each}
            </ul>{/if}
    </div>
</div>
