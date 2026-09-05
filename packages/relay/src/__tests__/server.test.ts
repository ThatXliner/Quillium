// Exercise handshake validation through the actual HTTP upgrade handler.
import { get } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../auth/supabase.js", () => ({
    supabaseConfigured: true,
    supabase: { auth: { getUser: vi.fn() }, from: vi.fn() },
}));

import { supabase } from "../auth/supabase.js";
import { createRelayServer } from "../server.js";

describe("relay handshake boundary", () => {
    const servers: ReturnType<typeof createRelayServer>[] = [];
    afterEach(async () => {
        for (const { httpServer, wss } of servers.splice(0)) {
            wss.close();
            await new Promise<void>((resolve) => httpServer.close(() => resolve()));
        }
        vi.clearAllMocks();
    });

    it.each([
        ["/invalid-document?auth=token", "Invalid handshake"],
        ["/123e4567-e89b-12d3-a456-426614174000", "Missing auth token"],
        ["/123e4567-e89b-12d3-a456-426614174000?auth=%20", "Invalid handshake"],
    ])("rejects %s before JWT verification", async (path, expectedBody) => {
        const server = createRelayServer();
        servers.push(server);
        await new Promise<void>((resolve) => server.httpServer.listen(0, "127.0.0.1", resolve));
        const { port } = server.httpServer.address() as AddressInfo;
        const response = await new Promise<{ status: number | undefined; body: string }>(
            (resolve, reject) => {
                get(
                    {
                        hostname: "127.0.0.1",
                        port,
                        path,
                        headers: { Connection: "Upgrade", Upgrade: "websocket" },
                    },
                    (res) => {
                        let body = "";
                        res.on("data", (chunk) => {
                            body += chunk;
                        });
                        res.on("end", () => resolve({ status: res.statusCode, body }));
                    },
                ).on("error", reject);
            },
        );
        expect(response).toEqual({ status: 401, body: expectedBody });
        expect(supabase?.auth.getUser).not.toHaveBeenCalled();
        expect(supabase?.from).not.toHaveBeenCalled();
    });
});
