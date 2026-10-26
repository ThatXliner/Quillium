import type { LiveRole } from "@quillium/share/collab-contract";

export interface InvitationEmail {
    to: string;
    joinUrl: string;
    role: LiveRole;
    expiresAt: string;
    inviter: string;
    documentTitle: string;
}

export interface InvitationEmailSender {
    send(invitation: InvitationEmail): Promise<void>;
}

export function createResendInvitationSender(options: {
    apiKey: string;
    from: string;
    fetch?: typeof fetch;
}): InvitationEmailSender {
    const request = options.fetch ?? fetch;
    return {
        async send(invitation): Promise<void> {
            const token = new URL(invitation.joinUrl).pathname.slice(1);
            const browserLink = `https://quillium.bryanhu.com/join#${encodeURIComponent(token)}`;
            const access = { viewer: "view", commenter: "comment on", editor: "edit" }[
                invitation.role
            ];
            const expiry = new Intl.DateTimeFormat("en-US", {
                dateStyle: "long",
                timeStyle: "short",
                timeZone: "UTC",
            }).format(new Date(invitation.expiresAt));
            const response = await request("https://api.resend.com/emails", {
                method: "POST",
                signal: AbortSignal.timeout(15_000),
                headers: {
                    Authorization: `Bearer ${options.apiKey}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    from: options.from,
                    to: [invitation.to],
                    subject: "You're invited to a Quillium Live Room",
                    text: `${invitation.inviter} invited you to the Live Room for “${invitation.documentTitle}” in Quillium. You can ${access} this document.\n\nOpen this link on a computer with Quillium installed:\n${browserLink}\n\nSign in with ${invitation.to}. This invitation expires on ${expiry} UTC. The owner must keep the Live Room open.`,
                }),
            });
            if (!response.ok)
                throw new Error(`Invitation email delivery failed (${response.status})`);
        },
    };
}

export function createTestInvitationSink(): InvitationEmailSender & {
    invitations: InvitationEmail[];
} {
    const invitations: InvitationEmail[] = [];
    return {
        invitations,
        async send(invitation): Promise<void> {
            invitations.push({ ...invitation });
        },
    };
}
