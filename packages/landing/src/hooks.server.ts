import { env } from "$env/dynamic/public";
import { createServerClient } from "@supabase/ssr";
import type { Handle } from "@sveltejs/kit";

let warnedMissingSupabase = false;

export const handle: Handle = async ({ event, resolve }) => {
    const supabaseUrl = env.PUBLIC_SUPABASE_URL;
    const publishableKey = env.PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    if (supabaseUrl && publishableKey) {
        event.locals.supabase = createServerClient(supabaseUrl, publishableKey, {
            global: {
                fetch: event.fetch,
            },
            cookies: {
                getAll: () => event.cookies.getAll(),
                setAll: (cookiesToSet) => {
                    for (const { name, value, options } of cookiesToSet) {
                        event.cookies.set(name, value, { ...options, path: "/" });
                    }
                },
            },
        });
    } else if (!warnedMissingSupabase) {
        warnedMissingSupabase = true;
        console.warn("[landing] Supabase env vars missing; auth and share routes are disabled.");
    }

    return resolve(event, {
        filterSerializedResponseHeaders(name) {
            return name === "content-range" || name === "x-supabase-api-version";
        },
    });
};
