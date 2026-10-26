/**
 * errorMessage.ts — Convert handled AI failures into safe, actionable UI text.
 *
 * Provider errors can be wrapped several times and may carry sensitive request
 * data. Classification therefore reads only a bounded cause chain and a small
 * set of operational fields; the returned messages never include raw errors.
 */

import type { Provider } from "./provider";

const MAX_ERROR_CHAIN = 6;

const OAUTH_ERROR_MESSAGE =
    "Your ChatGPT connection has expired or is no longer valid. Open AI Settings and sign in to ChatGPT again.";
const API_KEY_ERROR_MESSAGE =
    "Your AI provider rejected the API key. Open AI Settings and check your key.";
const PERMISSION_ERROR_MESSAGE =
    "The AI provider denied this request. Check your account permissions.";
const RATE_LIMIT_ERROR_MESSAGE =
    "The AI provider is rate limiting requests. Wait a moment and try again.";
const SERVICE_ERROR_MESSAGE = "The AI provider is temporarily unavailable. Try again in a moment.";
const NETWORK_ERROR_MESSAGE =
    "Could not connect to the AI provider. Check your connection and try again.";
const UNKNOWN_ERROR_MESSAGE =
    "The AI request failed. Try again. If it keeps failing, open Help → App Logs for details.";

const KNOWN_ERROR_MESSAGES = new Set([
    OAUTH_ERROR_MESSAGE,
    API_KEY_ERROR_MESSAGE,
    PERMISSION_ERROR_MESSAGE,
    RATE_LIMIT_ERROR_MESSAGE,
    SERVICE_ERROR_MESSAGE,
    NETWORK_ERROR_MESSAGE,
    UNKNOWN_ERROR_MESSAGE,
]);

type ErrorRecord = Record<string, unknown>;

function isObjectLike(value: unknown): value is ErrorRecord {
    return (typeof value === "object" && value !== null) || typeof value === "function";
}

function errorChain(error: unknown): unknown[] {
    const chain: unknown[] = [];
    const seen = new Set<object>();
    let current = error;

    for (let depth = 0; depth < MAX_ERROR_CHAIN; depth += 1) {
        if (isObjectLike(current)) {
            if (seen.has(current)) break;
            seen.add(current);
        }
        chain.push(current);
        if (!isObjectLike(current)) break;

        let cause: unknown;
        try {
            cause = current.cause;
        } catch {
            break;
        }
        if (cause === undefined) break;
        current = cause;
    }

    return chain;
}

function messageOf(value: unknown): string {
    if (typeof value === "string") return value;
    if (!isObjectLike(value)) return "";
    try {
        return typeof value.message === "string" ? value.message : "";
    } catch {
        return "";
    }
}

function nameOf(value: unknown): string {
    if (!isObjectLike(value)) return "";
    try {
        return typeof value.name === "string" ? value.name : "";
    } catch {
        return "";
    }
}

function statusCodeOf(value: unknown): number | undefined {
    if (!isObjectLike(value)) return undefined;
    let statusCode: unknown;
    try {
        statusCode = value.statusCode;
    } catch {
        return undefined;
    }
    if (typeof statusCode === "number" && Number.isFinite(statusCode)) return statusCode;
    if (typeof statusCode === "string" && /^\d{3}$/.test(statusCode)) {
        return Number(statusCode);
    }
    return undefined;
}

function isOAuthFailure(chain: unknown[]): boolean {
    return chain.some((value) => {
        const message = messageOf(value);
        if (statusCodeOf(value) === 401) return true;
        return (
            /\b(?:token|session)\b[^\n.]{0,80}\bexpired\b/i.test(message) ||
            /\binvalid[_ -]?grant\b/i.test(message) ||
            /\brefresh[_ -]?token[_ -]?(?:reused|expired)\b/i.test(message) ||
            /openai oauth session not found/i.test(message) ||
            /openai oauth token request failed with http(?: status)?\s*(?:400|401)\b/i.test(message)
        );
    });
}

function hasStatusCode(chain: unknown[], statusCode: number): boolean {
    return chain.some((value) => statusCodeOf(value) === statusCode);
}

function isNetworkFailure(value: unknown): boolean {
    const message = messageOf(value);
    const name = nameOf(value);
    return (
        (name === "TypeError" || value instanceof TypeError) &&
        /load failed|failed to fetch|network/i.test(message)
    );
}

/** Return a safe, actionable message for a handled AI failure. */
export function aiErrorMessage(error: unknown, provider: Provider): string {
    const directMessage = messageOf(error);
    if (KNOWN_ERROR_MESSAGES.has(directMessage)) return directMessage;

    const chain = errorChain(error);
    if (provider === "openai-oauth" && isOAuthFailure(chain)) return OAUTH_ERROR_MESSAGE;
    if (hasStatusCode(chain, 401)) return API_KEY_ERROR_MESSAGE;
    if (hasStatusCode(chain, 403)) return PERMISSION_ERROR_MESSAGE;
    if (hasStatusCode(chain, 429)) return RATE_LIMIT_ERROR_MESSAGE;
    if (
        chain.some((value) => {
            const statusCode = statusCodeOf(value);
            return statusCode !== undefined && statusCode >= 500;
        })
    ) {
        return SERVICE_ERROR_MESSAGE;
    }
    if (chain.some(isNetworkFailure)) return NETWORK_ERROR_MESSAGE;
    return UNKNOWN_ERROR_MESSAGE;
}
