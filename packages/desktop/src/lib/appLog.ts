/**
 * appLog.ts — Frontend bridge to the persistent native diagnostic log.
 *
 * The Rust side writes bounded JSONL under the app data directory. This module
 * also mirrors browser console output into that file so diagnostics visible in
 * Web Inspector are available through Help → App Logs. Logging remains strictly
 * best-effort: a broken logger must never break editing or crash recovery.
 */

import { invoke, isTauri } from "@tauri-apps/api/core";

export type AppLogLevel = "debug" | "info" | "warn" | "error";

type ForwardedConsoleMethod = "debug" | "error" | "info" | "log" | "warn";

const CONSOLE_LEVELS: Record<ForwardedConsoleMethod, AppLogLevel> = {
    debug: "debug",
    error: "error",
    info: "info",
    log: "info",
    warn: "warn",
};

const MAX_DEPTH = 6;
const MAX_ARRAY_ITEMS = 100;
const MAX_OBJECT_KEYS = 100;
const MAX_STRING_LENGTH = 16_000;
const MAX_MESSAGE_LENGTH = 64_000;
const REDACTED = "[REDACTED]";
const TRUNCATED = "[TRUNCATED]";
const SENSITIVE_KEY =
    /^(?:access_?token|refresh_?token|id_?token|api_?key|authorization|password|passwd|secret|cookie|credential)$/i;

const frontendSessionId = createSessionId();
let frontendSequence = 0;
let removeConsoleForwarder: (() => void) | undefined;

function createSessionId(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function truncate(value: string, maxLength: number): string {
    if (value.length <= maxLength) return value;
    return `${value.slice(0, maxLength)}…${TRUNCATED}`;
}

/** Remove common credential shapes while leaving operational context intact. */
function redactString(value: string): string {
    return truncate(value, MAX_STRING_LENGTH)
        .replace(/\bBearer\s+[^\s,;]+/gi, `Bearer ${REDACTED}`)
        .replace(/\b(?:sk|sk-ant)-[A-Za-z0-9_-]{16,}\b/g, REDACTED)
        .replace(/\bAIza[A-Za-z0-9_-]{20,}\b/g, REDACTED)
        .replace(
            /\b(?:access_?token|refresh_?token|id_?token|api_?key|authorization|password|passwd|secret|cookie|credential)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;&]+)/gi,
            (match) =>
                `${match.slice(0, Math.max(match.indexOf(":"), match.indexOf("=")) + 1)}${REDACTED}`,
        )
        .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, REDACTED);
}

function sanitizeLogValue(
    value: unknown,
    seen: WeakSet<object> = new WeakSet(),
    depth = 0,
): unknown {
    if (value === null || typeof value === "boolean" || typeof value === "number") return value;
    if (typeof value === "string") return redactString(value);
    if (typeof value === "undefined") return "[undefined]";
    if (typeof value === "bigint") return `${value}n`;
    if (typeof value === "symbol") return value.toString();
    if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`;
    if (typeof value !== "object") return String(value);
    if (seen.has(value)) return "[Circular]";
    if (depth >= MAX_DEPTH) return `[${value.constructor?.name || "Object"} at max depth]`;
    seen.add(value);

    if (value instanceof Error) {
        const result: Record<string, unknown> = {
            name: redactString(value.name),
            message: redactString(value.message),
            stack: value.stack ? redactString(value.stack) : undefined,
            cause:
                value.cause === undefined
                    ? undefined
                    : sanitizeLogValue(value.cause, seen, depth + 1),
        };
        const errorWithMetadata = value as Error & {
            statusCode?: unknown;
            isRetryable?: unknown;
        };
        if (errorWithMetadata.statusCode !== undefined) {
            result.statusCode = sanitizeLogValue(errorWithMetadata.statusCode, seen, depth + 1);
        }
        if (errorWithMetadata.isRetryable !== undefined) {
            result.isRetryable = sanitizeLogValue(errorWithMetadata.isRetryable, seen, depth + 1);
        }
        return result;
    }
    if (value instanceof Date) return value.toISOString();
    if (value instanceof URL) return redactString(value.toString());
    if (typeof Element !== "undefined" && value instanceof Element) {
        const id = value.id ? `#${value.id}` : "";
        const classes = [...value.classList]
            .slice(0, 6)
            .map((name) => `.${name}`)
            .join("");
        return `<${value.tagName.toLowerCase()}${id}${classes}>`;
    }
    if (Array.isArray(value)) {
        const items = value
            .slice(0, MAX_ARRAY_ITEMS)
            .map((item) => sanitizeLogValue(item, seen, depth + 1));
        if (value.length > MAX_ARRAY_ITEMS) {
            items.push(`[${value.length - MAX_ARRAY_ITEMS} more items]`);
        }
        return items;
    }
    if (value instanceof Map) {
        return {
            type: "Map",
            entries: [...value.entries()]
                .slice(0, MAX_ARRAY_ITEMS)
                .map(([key, item]) => [
                    sanitizeLogValue(key, seen, depth + 1),
                    sanitizeLogValue(item, seen, depth + 1),
                ]),
            size: value.size,
        };
    }
    if (value instanceof Set) {
        return {
            type: "Set",
            values: [...value.values()]
                .slice(0, MAX_ARRAY_ITEMS)
                .map((item) => sanitizeLogValue(item, seen, depth + 1)),
            size: value.size,
        };
    }

    try {
        const result: Record<string, unknown> = {};
        const keys = Object.keys(value).slice(0, MAX_OBJECT_KEYS);
        for (const key of keys) {
            if (SENSITIVE_KEY.test(key)) {
                result[key] = REDACTED;
                continue;
            }
            try {
                result[key] = sanitizeLogValue(
                    (value as Record<string, unknown>)[key],
                    seen,
                    depth + 1,
                );
            } catch (error) {
                result[key] =
                    `[Unreadable: ${error instanceof Error ? error.message : String(error)}]`;
            }
        }
        const keyCount = Object.keys(value).length;
        if (keyCount > MAX_OBJECT_KEYS) result.__truncatedKeys = keyCount - MAX_OBJECT_KEYS;
        const constructorName = value.constructor?.name;
        if (constructorName && constructorName !== "Object") result.__type = constructorName;
        return result;
    } catch (error) {
        return `[Unserializable: ${error instanceof Error ? error.message : String(error)}]`;
    }
}

function diagnosticContext(): Record<string, unknown> {
    return {
        frontendSessionId,
        sequence: ++frontendSequence,
        page: typeof location === "undefined" ? undefined : location.pathname,
    };
}

function stringifyDetails(details: unknown): string {
    const payload: Record<string, unknown> = { context: diagnosticContext() };
    if (details !== undefined) payload.data = sanitizeLogValue(details);
    try {
        return JSON.stringify(payload);
    } catch {
        return JSON.stringify({ context: payload.context, data: "[Unserializable details]" });
    }
}

function renderConsoleArgument(value: unknown): string {
    const sanitized = sanitizeLogValue(value);
    if (typeof sanitized === "string") return sanitized;
    try {
        return JSON.stringify(sanitized);
    } catch {
        return String(sanitized);
    }
}

function consoleTarget(args: unknown[]): string {
    const first = args[0];
    if (typeof first !== "string") return "console";
    const match = first.match(/^\[([^\]\n]{1,60})\]/);
    return match ? `console:${match[1].trim()}` : "console";
}

export async function logAppEvent(
    level: AppLogLevel,
    target: string,
    message: string,
    details?: unknown,
): Promise<void> {
    try {
        await invoke("cmd_log_app_event", {
            level,
            target: truncate(redactString(target), 120),
            message: truncate(redactString(message), MAX_MESSAGE_LENGTH),
            details: stringifyDetails(details),
        });
    } catch {
        // Best-effort diagnostics only. In particular, never call console here:
        // console is forwarded to this function and that would recurse forever.
    }
}

/**
 * Mirror all normal browser console levels into the persistent app log while
 * preserving the original Web Inspector behavior. Installation is idempotent.
 */
export function installConsoleForwarder(): () => void {
    if (removeConsoleForwarder) return removeConsoleForwarder;

    const methods = Object.keys(CONSOLE_LEVELS) as ForwardedConsoleMethod[];
    const originals = new Map<ForwardedConsoleMethod, Console[ForwardedConsoleMethod]>();
    const replacements = new Map<ForwardedConsoleMethod, (...args: unknown[]) => void>();

    for (const method of methods) {
        const original = console[method].bind(console) as (...args: unknown[]) => void;
        originals.set(method, console[method]);
        const replacement = (...args: unknown[]) => {
            original(...args);
            const message = truncate(
                args.map((argument) => renderConsoleArgument(argument)).join(" "),
                MAX_MESSAGE_LENGTH,
            );
            void logAppEvent(
                CONSOLE_LEVELS[method],
                consoleTarget(args),
                message || "(no arguments)",
                {
                    consoleMethod: method,
                    arguments: args,
                },
            );
        };
        replacements.set(method, replacement);
        console[method] = replacement as Console[typeof method];
    }

    removeConsoleForwarder = () => {
        for (const method of methods) {
            if (console[method] === replacements.get(method)) {
                console[method] = originals.get(method) as Console[typeof method];
            }
        }
        removeConsoleForwarder = undefined;
    };
    return removeConsoleForwarder;
}

export async function readAppLog(): Promise<string> {
    return invoke<string>("cmd_read_app_log");
}

export async function clearAppLog(): Promise<void> {
    await invoke("cmd_clear_app_log");
}

export async function appLogPath(): Promise<string> {
    return invoke<string>("cmd_app_log_path");
}

// Install during dependency evaluation so console output from other startup
// modules is captured too. Browser previews and unit tests are left untouched.
if (typeof window !== "undefined" && isTauri()) installConsoleForwarder();
