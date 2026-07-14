import {
    type OpenAIOAuthSession,
    createOpenAIOAuthRequest,
    createOpenAIOAuthTransport,
    exchangeOpenAIOAuthCode,
    refreshOpenAIOAuthTokens,
} from "@openai-oauth/core";
/**
 * openaiOAuth.ts — Native Sign in with ChatGPT session lifecycle.
 *
 * Reimplements the framework-neutral behavior behind @openai-oauth/react for
 * Svelte/Tauri: PKCE login, callback validation, refresh, and keychain storage.
 */
import { invoke } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { resetOpenAIOAuthProvider } from "./provider";
import { setOpenAIOAuthConnected } from "./settings.svelte";

const PROVIDER = "openai-oauth";
const REDIRECT_URI = "http://localhost:1455/auth/callback";
const EXPIRY_MARGIN_MS = 5 * 60 * 1000;

type Callback = { code: string; state: string };

// ChatGPT's Codex endpoints do not allow browser/WebView origins. Tauri's HTTP
// plugin performs these requests natively while preserving the Fetch API shape
// expected by openai-oauth (including streamed response bodies).
export const openAIOAuthFetch: typeof fetch = (input, init) => tauriFetch(input, init);

function toSession(
    tokens: Awaited<ReturnType<typeof exchangeOpenAIOAuthCode>>,
    previous?: OpenAIOAuthSession,
): OpenAIOAuthSession {
    const expiresAt = tokens.expiresIn
        ? new Date(Date.now() + tokens.expiresIn * 1000).toISOString()
        : previous?.expiresAt;
    return {
        accessToken: tokens.accessToken,
        accountId: tokens.accountId ?? previous?.accountId ?? "",
        refreshToken: tokens.refreshToken ?? previous?.refreshToken,
        idToken: tokens.idToken ?? previous?.idToken,
        isFedRamp: tokens.isFedRamp ?? previous?.isFedRamp,
        expiresAt,
        lastRefresh: new Date().toISOString(),
    };
}

async function saveSession(session: OpenAIOAuthSession): Promise<void> {
    await invoke("set_api_key", { provider: PROVIDER, key: JSON.stringify(session) });
    setOpenAIOAuthConnected(true);
}

export async function getStoredOpenAISession(): Promise<OpenAIOAuthSession | null> {
    const value = await invoke<string | null>("get_api_key", { provider: PROVIDER });
    if (!value) {
        setOpenAIOAuthConnected(false);
        return null;
    }
    try {
        const session = JSON.parse(value) as OpenAIOAuthSession;
        setOpenAIOAuthConnected(true);
        return session;
    } catch {
        await disconnectOpenAI();
        return null;
    }
}

export async function listOpenAIModels(): Promise<string[]> {
    const transport = createOpenAIOAuthTransport({
        auth: getFreshOpenAISession,
        fetch: openAIOAuthFetch,
    });
    const response = await transport.request("/models");
    const payload = (await response.json()) as {
        data?: Array<{ id?: unknown }>;
        error?: { message?: unknown };
    };
    if (!response.ok) {
        throw new Error(
            typeof payload.error?.message === "string"
                ? payload.error.message
                : "Could not load models for this ChatGPT account.",
        );
    }
    const models = (payload.data ?? [])
        .map((model) => model.id)
        .filter(
            (id): id is string =>
                typeof id === "string" && id.length > 0 && !id.toLowerCase().includes("image"),
        );
    if (models.length === 0) throw new Error("No compatible ChatGPT models were found.");
    return [...new Set(models)];
}

export async function getFreshOpenAISession(): Promise<OpenAIOAuthSession | null> {
    const session = await getStoredOpenAISession();
    if (!session) return null;
    const expiresAt = session.expiresAt ? Date.parse(session.expiresAt) : Number.NaN;
    if (!Number.isFinite(expiresAt) || expiresAt - Date.now() > EXPIRY_MARGIN_MS) return session;
    if (!session.refreshToken) return session;

    const tokens = await refreshOpenAIOAuthTokens({
        refreshToken: session.refreshToken,
        fetch: openAIOAuthFetch,
    });
    const refreshed = toSession(tokens, session);
    await saveSession(refreshed);
    return refreshed;
}

export async function signInWithChatGPT(): Promise<OpenAIOAuthSession> {
    const request = await createOpenAIOAuthRequest({ redirectUri: REDIRECT_URI });
    const callback = await invoke<Callback>("await_openai_oauth_callback", {
        authorizationUrl: request.authorizationUrl,
    });
    if (callback.state !== request.state) {
        throw new Error("OpenAI sign-in returned an invalid state. Please try again.");
    }
    const tokens = await exchangeOpenAIOAuthCode({
        code: callback.code,
        codeVerifier: request.codeVerifier,
        redirectUri: REDIRECT_URI,
        fetch: openAIOAuthFetch,
    });
    const session = toSession(tokens);
    if (!session.accountId) throw new Error("OpenAI sign-in did not return an account ID.");
    await saveSession(session);
    return session;
}

export async function disconnectOpenAI(): Promise<void> {
    await invoke("delete_api_key", { provider: PROVIDER });
    setOpenAIOAuthConnected(false);
    resetOpenAIOAuthProvider();
}
