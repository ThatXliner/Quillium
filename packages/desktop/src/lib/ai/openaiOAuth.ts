import {
    type OpenAIOAuthSession,
    createOpenAIOAuthRequest,
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

const PROVIDER = "openai-oauth";
export const HAS_OPENAI_OAUTH_KEY = "quillium-has-openai-oauth";
const REDIRECT_URI = "http://localhost:1455/auth/callback";
const EXPIRY_MARGIN_MS = 5 * 60 * 1000;

type Callback = { code: string; state: string };

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
    localStorage.setItem(HAS_OPENAI_OAUTH_KEY, "1");
}

export async function getStoredOpenAISession(): Promise<OpenAIOAuthSession | null> {
    const value = await invoke<string | null>("get_api_key", { provider: PROVIDER });
    if (!value) return null;
    try {
        return JSON.parse(value) as OpenAIOAuthSession;
    } catch {
        await disconnectOpenAI();
        return null;
    }
}

export async function getFreshOpenAISession(): Promise<OpenAIOAuthSession | null> {
    const session = await getStoredOpenAISession();
    if (!session) return null;
    const expiresAt = session.expiresAt ? Date.parse(session.expiresAt) : Number.NaN;
    if (!Number.isFinite(expiresAt) || expiresAt - Date.now() > EXPIRY_MARGIN_MS) return session;
    if (!session.refreshToken) return session;

    const tokens = await refreshOpenAIOAuthTokens({ refreshToken: session.refreshToken });
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
    });
    const session = toSession(tokens);
    if (!session.accountId) throw new Error("OpenAI sign-in did not return an account ID.");
    await saveSession(session);
    return session;
}

export async function disconnectOpenAI(): Promise<void> {
    await invoke("delete_api_key", { provider: PROVIDER });
    localStorage.removeItem(HAS_OPENAI_OAUTH_KEY);
}
