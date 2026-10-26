import { createHash, randomBytes } from "node:crypto";
import { LiveRoleSchema } from "@quillium/share/collab-contract";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { z } from "zod";
import type { InvitationEmailSender } from "./email.js";

export const InviteRoleSchema = LiveRoleSchema;
export type InviteRole = z.infer<typeof InviteRoleSchema>;
const uuid = z.uuid();
const invitationToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const emailAddress = z
    .email()
    .max(254)
    .transform((value) => value.toLowerCase());
export const CreateGrantSchema = z
    .object({
        role: InviteRoleSchema,
        email: emailAddress.optional(),
        expiresAt: z.iso.datetime({ offset: true }).optional(),
    })
    .strict();

const GrantRowSchema = z.object({
    id: uuid,
    document_id: uuid,
    created_by: uuid,
    invited_email: z.string().nullable(),
    role: InviteRoleSchema,
    delivery_status: z.enum(["link", "pending", "sent", "failed"]),
    created_at: z.string(),
    updated_at: z.string(),
    expires_at: z.string(),
    revoked_at: z.string().nullable(),
});
export type LiveRoomGrant = z.infer<typeof GrantRowSchema>;
const grantColumns =
    "id, document_id, created_by, invited_email, role, delivery_status, created_at, updated_at, expires_at, revoked_at";

export type AccessErrorCode =
    | "invalid_invitation"
    | "expired_invitation"
    | "revoked_invitation"
    | "insufficient_permission"
    | "invalid_request"
    | "delivery_failed"
    | "service_unavailable";

const messages: Record<AccessErrorCode, string> = {
    invalid_invitation: "This invitation is invalid. Ask the owner for a new link.",
    expired_invitation: "This invitation has expired. Ask the owner for a new link.",
    revoked_invitation: "The owner revoked this invitation. Ask them for access.",
    insufficient_permission:
        "This invitation requires its invited account. Sign in with the invited email address.",
    invalid_request: "Check the invitation details and try again.",
    delivery_failed: "The invitation email could not be sent. Try again.",
    service_unavailable: "Live Room access is unavailable. Try again.",
};

export class AccessError extends Error {
    constructor(public readonly code: AccessErrorCode) {
        super(messages[code]);
        this.name = "AccessError";
    }
}

export interface ResolvedInvitation {
    documentId: string;
    grantId: string;
    role: InviteRole;
    expiresAt: string;
}

export class LiveRoomAccessService {
    private readonly now: () => number;

    constructor(
        private readonly options: {
            supabase: SupabaseClient;
            onGrantChanged: (documentId: string, grantId: string) => void;
            email?: InvitationEmailSender;
            now?: () => number;
        },
    ) {
        this.now = options.now ?? Date.now;
    }

    async create(
        user: User,
        documentId: string,
        input: z.infer<typeof CreateGrantSchema>,
    ): Promise<{
        grant: LiveRoomGrant;
        token: string;
        joinUrl: string;
    }> {
        const parsed = CreateGrantSchema.safeParse(input);
        if (!parsed.success) throw new AccessError("invalid_request");
        await this.requireOwner(user, documentId);
        const expiresAt =
            parsed.data.expiresAt ?? new Date(this.now() + 7 * 86_400_000).toISOString();
        const expires = Date.parse(expiresAt);
        if (expires <= this.now() || expires > this.now() + 90 * 86_400_000) {
            throw new AccessError("invalid_request");
        }
        if (parsed.data.email && !this.options.email) throw new AccessError("delivery_failed");
        const token = randomBytes(32).toString("base64url");
        const joinUrl = `quillium://join/${token}`;
        const { data, error } = await this.options.supabase
            .from("live_room_grants")
            .insert({
                document_id: documentId,
                created_by: user.id,
                token_hash: hashToken(token),
                invited_email: parsed.data.email ?? null,
                role: parsed.data.role,
                delivery_status: parsed.data.email ? "pending" : "link",
                expires_at: expiresAt,
            })
            .select(grantColumns)
            .single();
        if (error) throw new AccessError("service_unavailable");
        let grant = parseGrant(data);
        if (parsed.data.email && this.options.email) {
            try {
                await this.options.email.send({
                    to: parsed.data.email,
                    joinUrl,
                    role: parsed.data.role,
                    expiresAt,
                });
                grant = await this.update(documentId, grant.id, { delivery_status: "sent" });
            } catch {
                await this.update(documentId, grant.id, {
                    delivery_status: "failed",
                    revoked_at: new Date(this.now()).toISOString(),
                });
                throw new AccessError("delivery_failed");
            }
        }
        return { grant, token, joinUrl };
    }

    async list(user: User, documentId: string): Promise<LiveRoomGrant[]> {
        await this.requireOwner(user, documentId);
        const { data, error } = await this.options.supabase
            .from("live_room_grants")
            .select(grantColumns)
            .eq("document_id", documentId)
            .order("created_at", { ascending: false });
        if (error) throw new AccessError("service_unavailable");
        const parsed = z.array(GrantRowSchema).safeParse(data);
        if (!parsed.success) throw new AccessError("service_unavailable");
        return parsed.data;
    }

    async changeRole(
        user: User,
        documentId: string,
        grantId: string,
        role: InviteRole,
    ): Promise<LiveRoomGrant> {
        await this.requireOwner(user, documentId);
        if (!uuid.safeParse(grantId).success || !InviteRoleSchema.safeParse(role).success) {
            throw new AccessError("invalid_request");
        }
        const grant = await this.update(documentId, grantId, { role });
        this.options.onGrantChanged(documentId, grantId);
        return grant;
    }

    async revoke(user: User, documentId: string, grantId: string): Promise<LiveRoomGrant> {
        await this.requireOwner(user, documentId);
        if (!uuid.safeParse(grantId).success) throw new AccessError("invalid_request");
        const grant = await this.update(documentId, grantId, {
            revoked_at: new Date(this.now()).toISOString(),
        });
        this.options.onGrantChanged(documentId, grantId);
        return grant;
    }

    async replaceLink(
        user: User,
        documentId: string,
        grantId: string,
    ): Promise<{
        grant: LiveRoomGrant;
        token: string;
        joinUrl: string;
    }> {
        await this.requireOwner(user, documentId);
        if (!uuid.safeParse(grantId).success) throw new AccessError("invalid_request");
        const { data, error } = await this.options.supabase
            .from("live_room_grants")
            .select(grantColumns)
            .eq("document_id", documentId)
            .eq("id", grantId)
            .maybeSingle();
        if (error) throw new AccessError("service_unavailable");
        if (!data) throw new AccessError("invalid_invitation");
        const existing = parseGrant(data);
        if (existing.invited_email) throw new AccessError("invalid_request");
        if (existing.revoked_at) throw new AccessError("revoked_invitation");
        if (Date.parse(existing.expires_at) <= this.now())
            throw new AccessError("expired_invitation");
        const token = randomBytes(32).toString("base64url");
        const grant = await this.update(documentId, grantId, { token_hash: hashToken(token) });
        this.options.onGrantChanged(documentId, grantId);
        return { grant, token, joinUrl: `quillium://join/${token}` };
    }

    async resolve(token: string, user: User, documentId?: string): Promise<ResolvedInvitation> {
        if (!invitationToken.safeParse(token).success) throw new AccessError("invalid_invitation");
        const { data, error } = await this.options.supabase
            .from("live_room_grants")
            .select(grantColumns)
            .eq("token_hash", hashToken(token))
            .maybeSingle();
        if (error) throw new AccessError("service_unavailable");
        if (!data) throw new AccessError("invalid_invitation");
        const grant = parseGrant(data);
        if (documentId !== undefined && grant.document_id !== documentId) {
            throw new AccessError("invalid_invitation");
        }
        if (grant.revoked_at) throw new AccessError("revoked_invitation");
        if (Date.parse(grant.expires_at) <= this.now()) throw new AccessError("expired_invitation");
        if (grant.delivery_status === "pending" || grant.delivery_status === "failed") {
            throw new AccessError("invalid_invitation");
        }
        if (
            grant.invited_email &&
            (user.is_anonymous ||
                !user.email_confirmed_at ||
                user.email?.toLowerCase() !== grant.invited_email)
        ) {
            throw new AccessError("insufficient_permission");
        }
        return {
            documentId: grant.document_id,
            grantId: grant.id,
            role: grant.role,
            expiresAt: grant.expires_at,
        };
    }

    private async requireOwner(user: User, documentId: string): Promise<void> {
        if (!uuid.safeParse(documentId).success) throw new AccessError("invalid_request");
        if (user.is_anonymous) throw new AccessError("insufficient_permission");
        const { data, error } = await this.options.supabase
            .from("sync_documents")
            .select("owner_id")
            .eq("id", documentId)
            .maybeSingle();
        if (error) throw new AccessError("service_unavailable");
        const owner = z.object({ owner_id: uuid }).safeParse(data);
        if (!owner.success || owner.data.owner_id !== user.id)
            throw new AccessError("insufficient_permission");
    }

    private async update(
        documentId: string,
        grantId: string,
        patch: {
            role?: InviteRole;
            token_hash?: string;
            delivery_status?: LiveRoomGrant["delivery_status"];
            revoked_at?: string;
        },
    ): Promise<LiveRoomGrant> {
        const { data, error } = await this.options.supabase
            .from("live_room_grants")
            .update({ ...patch, updated_at: new Date(this.now()).toISOString() })
            .eq("document_id", documentId)
            .eq("id", grantId)
            .select(grantColumns)
            .maybeSingle();
        if (error) throw new AccessError("service_unavailable");
        if (!data) throw new AccessError("invalid_invitation");
        return parseGrant(data);
    }
}

function hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
}

function parseGrant(data: unknown): LiveRoomGrant {
    const parsed = GrantRowSchema.safeParse(data);
    if (!parsed.success) throw new AccessError("service_unavailable");
    return parsed.data;
}
