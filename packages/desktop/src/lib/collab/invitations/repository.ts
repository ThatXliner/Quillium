import { PUBLIC_RELAY_URL } from "$env/static/public";
import { getSession } from "$lib/auth/auth.svelte";
import { type LiveRole, LiveRoleSchema } from "@quillium/share/collab-contract";
import { z } from "zod";

export const GrantSchema = z.object({
    id: z.string().uuid(),
    document_id: z.string().uuid(),
    created_by: z.string().uuid(),
    invited_email: z.string().nullable(),
    role: LiveRoleSchema,
    delivery_status: z.enum(["link", "pending", "sent", "failed"]),
    created_at: z.string(),
    updated_at: z.string(),
    expires_at: z.string(),
    revoked_at: z.string().nullable(),
});
export type LiveRoomGrant = z.infer<typeof GrantSchema>;
const createdGrant = z.object({ grant: GrantSchema, token: z.string(), joinUrl: z.string() });
const resolvedInvitation = z.object({
    documentId: z.string().uuid(),
    grantId: z.string().uuid(),
    role: LiveRoleSchema,
    expiresAt: z.string(),
});
export type ResolvedInvitation = z.infer<typeof resolvedInvitation>;
const errorResponse = z.object({ code: z.string(), message: z.string() });

export class InvitationError extends Error {
    constructor(
        public readonly code: string,
        message: string,
    ) {
        super(message);
        this.name = "InvitationError";
    }
}

function relayHttpUrl(): URL {
    if (!PUBLIC_RELAY_URL)
        throw new InvitationError("unavailable", "Live Rooms are unavailable in this build.");
    const url = new URL(PUBLIC_RELAY_URL);
    url.protocol = url.protocol === "wss:" ? "https:" : "http:";
    return url;
}

async function request<T>(
    path: string,
    schema: z.ZodType<T>,
    method = "GET",
    body?: unknown,
): Promise<T> {
    const session = getSession();
    if (!session) throw new InvitationError("authentication_required", "Sign in to continue.");
    let response: Response;
    try {
        response = await fetch(new URL(path, relayHttpUrl()), {
            method,
            headers: {
                Authorization: `Bearer ${session.access_token}`,
                "Content-Type": "application/json",
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            signal: AbortSignal.timeout(15_000),
        });
    } catch {
        throw new InvitationError(
            "unavailable",
            "Couldn't reach the Live Room. Check your connection and try again.",
        );
    }
    const json: unknown = await response.json().catch(() => null);
    if (!response.ok) {
        const error = errorResponse.safeParse(json);
        throw error.success
            ? new InvitationError(error.data.code, error.data.message)
            : new InvitationError("unavailable", "Live Room access is unavailable. Try again.");
    }
    const result = schema.safeParse(json);
    if (!result.success)
        throw new InvitationError(
            "unavailable",
            "The Live Room returned an unreadable response. Try again.",
        );
    return result.data;
}

export const invitationRepository = {
    async list(documentId: string): Promise<LiveRoomGrant[]> {
        return (
            await request(
                `/access/documents/${documentId}/grants`,
                z.object({ grants: z.array(GrantSchema) }),
            )
        ).grants;
    },
    create(documentId: string, input: { role: LiveRole; email?: string; expiresAt: string }) {
        return request(`/access/documents/${documentId}/grants`, createdGrant, "POST", input);
    },
    async changeRole(documentId: string, id: string, role: LiveRole): Promise<LiveRoomGrant> {
        return (
            await request(
                `/access/documents/${documentId}/grants/${id}`,
                z.object({ grant: GrantSchema }),
                "PATCH",
                { role },
            )
        ).grant;
    },
    async revoke(documentId: string, id: string): Promise<LiveRoomGrant> {
        return (
            await request(
                `/access/documents/${documentId}/grants/${id}`,
                z.object({ grant: GrantSchema }),
                "DELETE",
            )
        ).grant;
    },
    replace(documentId: string, id: string) {
        return request(
            `/access/documents/${documentId}/grants/${id}/replace`,
            createdGrant,
            "POST",
        );
    },
    resolve(token: string): Promise<ResolvedInvitation> {
        return request("/access/invitations/resolve", resolvedInvitation, "POST", { token });
    },
};

export const roleLabel: Record<LiveRole, string> = {
    viewer: "Can view",
    commenter: "Can comment",
    editor: "Can edit",
};
export const roleHelp: Record<LiveRole, string> = {
    viewer: "Read along, see who's here, and follow a cursor.",
    commenter: "Add comments and replies. The text stays as it is.",
    editor: "Edit text, comments, suggestions, and revisions.",
};
