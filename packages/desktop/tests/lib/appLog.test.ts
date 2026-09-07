import { installConsoleForwarder, logAppEvent } from "$lib/appLog";
import { mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it, vi } from "vitest";

async function flushLogging(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
}

let removeForwarder: (() => void) | undefined;
const consoleSpies: Array<ReturnType<typeof vi.spyOn>> = [];

afterEach(() => {
    removeForwarder?.();
    removeForwarder = undefined;
    for (const spy of consoleSpies.splice(0)) spy.mockRestore();
});

describe("app log", () => {
    it("forwards console arguments, errors, and inferred targets to the native log", async () => {
        const calls: Array<{ cmd: string; args: Record<string, unknown> }> = [];
        mockIPC((cmd, args) => {
            calls.push({ cmd, args: args as Record<string, unknown> });
            return null;
        });
        const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        consoleSpies.push(logSpy);
        removeForwarder = installConsoleForwarder();

        const payload: Record<string, unknown> = {
            access_token: "do-not-log-this",
            attempt: 3,
        };
        payload.self = payload;
        console.log("[collab] Connection failed", payload, new Error("relay unavailable"));
        await flushLogging();

        expect(logSpy).toHaveBeenCalledOnce();
        expect(calls).toHaveLength(1);
        expect(calls[0].cmd).toBe("cmd_log_app_event");
        expect(calls[0].args.level).toBe("info");
        expect(calls[0].args.target).toBe("console:collab");
        expect(calls[0].args.message).toContain("Connection failed");
        expect(calls[0].args.message).not.toContain("do-not-log-this");

        const details = JSON.parse(String(calls[0].args.details));
        expect(details.context.frontendSessionId).toBeTypeOf("string");
        expect(details.context.sequence).toBeTypeOf("number");
        expect(details.data.consoleMethod).toBe("log");
        expect(details.data.arguments[1]).toMatchObject({
            access_token: "[REDACTED]",
            attempt: 3,
            self: "[Circular]",
        });
        expect(details.data.arguments[2]).toMatchObject({
            name: "Error",
            message: "relay unavailable",
        });
        expect(details.data.arguments[2].stack).toContain("relay unavailable");
    });

    it("maps the standard console methods to persistent log levels", async () => {
        const calls: Array<{ args: Record<string, unknown> }> = [];
        mockIPC((_cmd, args) => {
            calls.push({ args: args as Record<string, unknown> });
            return null;
        });
        for (const method of ["debug", "error", "info", "log", "warn"] as const) {
            consoleSpies.push(vi.spyOn(console, method).mockImplementation(() => {}));
        }
        removeForwarder = installConsoleForwarder();

        console.debug("debug message");
        console.info("info message");
        console.log("log message");
        console.warn("warn message");
        console.error("error message");
        await flushLogging();

        expect(calls.map((call) => call.args.level)).toEqual([
            "debug",
            "info",
            "info",
            "warn",
            "error",
        ]);
    });

    it("redacts credentials in explicit diagnostic events", async () => {
        const calls: Array<{ args: Record<string, unknown> }> = [];
        mockIPC((_cmd, args) => {
            calls.push({ args: args as Record<string, unknown> });
            return null;
        });

        await logAppEvent("error", "auth", "Bearer very-secret-token", {
            password: "hunter2",
            authorization: "Bearer another-secret-token",
            status: 401,
        });

        expect(calls).toHaveLength(1);
        expect(calls[0].args.message).toBe("Bearer [REDACTED]");
        const details = JSON.parse(String(calls[0].args.details));
        expect(details.data).toEqual({
            password: "[REDACTED]",
            authorization: "[REDACTED]",
            status: 401,
        });
    });

    it("preserves allowlisted provider error metadata without serializing request bodies", async () => {
        const calls: Array<{ args: Record<string, unknown> }> = [];
        mockIPC((_cmd, args) => {
            calls.push({ args: args as Record<string, unknown> });
            return null;
        });

        const cause = new Error("refresh token rejected");
        const error = new Error("OAuth request failed", { cause });
        Object.assign(error, {
            statusCode: 401,
            isRetryable: false,
            requestBodyValues: { prompt: "private draft text" },
            responseBody: "provider response with private details",
        });

        await logAppEvent("error", "ai", "AI stream failed", { error });

        expect(calls).toHaveLength(1);
        const details = JSON.parse(String(calls[0].args.details));
        expect(details.data.error).toMatchObject({
            name: "Error",
            message: "OAuth request failed",
            statusCode: 401,
            isRetryable: false,
            cause: {
                name: "Error",
                message: "refresh token rejected",
            },
        });
        expect(details.data.error.stack).toContain("OAuth request failed");
        expect(details.data.error.cause.stack).toContain("refresh token rejected");
        expect(details.data.error).not.toHaveProperty("requestBodyValues");
        expect(details.data.error).not.toHaveProperty("responseBody");
        expect(String(calls[0].args.details)).not.toContain("private draft text");
        expect(String(calls[0].args.details)).not.toContain(
            "provider response with private details",
        );
    });
});
