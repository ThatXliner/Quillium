import type { IncomingMessage, ServerResponse } from "node:http";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createLogger } from "../logger.js";
import { isOriginAllowed } from "../origins.js";
import {
    AccessError,
    CreateGrantSchema,
    InviteRoleSchema,
    type LiveRoomAccessService,
} from "./grants.js";

const logger = createLogger("access");
const rolePatch = z.object({ role: InviteRoleSchema }).strict();
const resolveInput = z.object({ token: z.string().max(128) }).strict();

export function createAccessHttpHandler(options: {
    supabase: SupabaseClient;
    service: LiveRoomAccessService;
    isRoomOpen?: (documentId: string) => boolean;
}): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
    return async (req, res): Promise<boolean> => {
        const pathname = new URL(req.url ?? "/", "http://relay.local").pathname;
        if (!pathname.startsWith("/access/")) return false;
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Vary", "Origin");
        if (!isOriginAllowed(req.headers.origin)) {
            respond(res, 403, { code: "insufficient_permission", message: "Origin not allowed" });
            return true;
        }
        if (req.headers.origin) res.setHeader("Access-Control-Allow-Origin", req.headers.origin);
        res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
        if (req.method === "OPTIONS") {
            res.writeHead(204);
            res.end();
            return true;
        }
        const auth = req.headers.authorization?.match(/^Bearer ([^\s]+)$/)?.[1];
        if (!auth || auth.length > 16_384) {
            respond(res, 401, { code: "authentication_required", message: "Sign in to continue." });
            return true;
        }
        try {
            const {
                data: { user },
                error,
            } = await options.supabase.auth.getUser(auth);
            if (error || !user) {
                respond(res, 401, {
                    code: "authentication_required",
                    message: "Sign in to continue.",
                });
                return true;
            }
            if (pathname === "/access/invitations/resolve" && req.method === "POST") {
                const input = resolveInput.safeParse(await readBody(req));
                if (!input.success) throw new AccessError("invalid_request");
                const invitation = await options.service.resolve(input.data.token, user);
                if (options.isRoomOpen && !options.isRoomOpen(invitation.documentId)) {
                    respond(res, 409, {
                        code: "owner_offline",
                        message:
                            "The owner has not opened this Live Room. Try again when they are ready.",
                    });
                    return true;
                }
                respond(res, 200, invitation);
                return true;
            }
            const route = pathname.match(
                /^\/access\/documents\/([^/]+)\/grants(?:\/([^/]+)(\/replace)?)?$/,
            );
            if (!route) {
                respond(res, 404, { code: "not_found", message: "Not found" });
                return true;
            }
            const [, documentId, grantId, replace] = route;
            if (replace) {
                if (req.method === "POST") {
                    respond(res, 200, await options.service.replaceLink(user, documentId, grantId));
                } else {
                    respond(res, 405, {
                        code: "method_not_allowed",
                        message: "Method not allowed",
                    });
                }
                return true;
            }
            if (!grantId && req.method === "GET") {
                respond(res, 200, { grants: await options.service.list(user, documentId) });
            } else if (!grantId && req.method === "POST") {
                const input = CreateGrantSchema.safeParse(await readBody(req));
                if (!input.success) throw new AccessError("invalid_request");
                respond(res, 201, await options.service.create(user, documentId, input.data));
            } else if (grantId && req.method === "PATCH") {
                const input = rolePatch.safeParse(await readBody(req));
                if (!input.success) throw new AccessError("invalid_request");
                respond(res, 200, {
                    grant: await options.service.changeRole(
                        user,
                        documentId,
                        grantId,
                        input.data.role,
                    ),
                });
            } else if (grantId && req.method === "DELETE") {
                respond(res, 200, {
                    grant: await options.service.revoke(user, documentId, grantId),
                });
            } else {
                respond(res, 405, { code: "method_not_allowed", message: "Method not allowed" });
            }
        } catch (error) {
            if (error instanceof AccessError) {
                const status =
                    error.code === "service_unavailable" || error.code === "delivery_failed"
                        ? 503
                        : error.code === "insufficient_permission"
                          ? 403
                          : 400;
                respond(res, status, { code: error.code, message: error.message });
            } else {
                logger.error("Request failed", error);
                respond(res, 503, {
                    code: "service_unavailable",
                    message: "Live Room access is unavailable. Try again.",
                });
            }
        }
        return true;
    };
}

async function readBody(req: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > 8_192) throw new AccessError("invalid_request");
        chunks.push(buffer);
    }
    try {
        return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
        throw new AccessError("invalid_request");
    }
}

function respond(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status);
    res.end(JSON.stringify(body));
}
