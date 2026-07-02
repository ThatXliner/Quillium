import { env } from "$env/dynamic/public";
import { createBrowserClient } from "@supabase/ssr";

export function createSupabaseBrowserClient() {
    if (!env.PUBLIC_SUPABASE_URL || !env.PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
        throw new Error("Missing PUBLIC_SUPABASE_URL or PUBLIC_SUPABASE_PUBLISHABLE_KEY");
    }

    return createBrowserClient(env.PUBLIC_SUPABASE_URL, env.PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
        auth: {
            detectSessionInUrl: false,
        },
        isSingleton: false,
    });
}
