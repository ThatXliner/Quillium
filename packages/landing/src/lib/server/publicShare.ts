import { env } from "$env/dynamic/public";
import type { ReadonlyShareDocument } from "@quillium/share";
import { createClient } from "@supabase/supabase-js";
import { parsePublicShare } from "./publicSharePayload";

export type PublicShare = ReadonlyShareDocument;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getSupabaseEnv() {
    const supabaseUrl = env.PUBLIC_SUPABASE_URL;
    const publishableKey = env.PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    if (!supabaseUrl || !publishableKey) {
        throw new Error("Missing PUBLIC_SUPABASE_URL or PUBLIC_SUPABASE_PUBLISHABLE_KEY");
    }

    return { supabaseUrl, publishableKey };
}

type PublicShareDatabase = {
    public: {
        Tables: Record<string, never>;
        Views: Record<string, never>;
        Functions: {
            get_public_share_by_token: {
                Args: { p_share_token: string };
                Returns: unknown[];
            };
        };
    };
};

let supabaseAdmin: ReturnType<typeof createClient<PublicShareDatabase>> | undefined;

function getSupabaseAdmin() {
    if (supabaseAdmin) return supabaseAdmin;
    const { supabaseUrl, publishableKey } = getSupabaseEnv();
    supabaseAdmin = createClient<PublicShareDatabase>(supabaseUrl, publishableKey, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
        },
    });
    return supabaseAdmin;
}

export function isShareToken(token: string): boolean {
    return UUID_RE.test(token);
}

export async function loadPublicShare(
    _fetchFn: typeof fetch,
    token: string,
): Promise<PublicShare | null> {
    if (!isShareToken(token)) return null;

    const client = getSupabaseAdmin();
    const { data, error } = await client
        .rpc("get_public_share_by_token", { p_share_token: token })
        .maybeSingle<unknown>();

    if (error) {
        throw new Error(`Failed to load public share (${error.message})`);
    }

    return parsePublicShare(data, token);
}
