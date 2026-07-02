declare const __APP_VERSION__: string;

declare module "$env/static/public" {
    export const PUBLIC_POSTHOG_KEY: string;
    export const PUBLIC_POSTHOG_HOST: string;
    export const PUBLIC_SUPABASE_URL: string;
    export const PUBLIC_SUPABASE_PUBLISHABLE_KEY: string;
    export const PUBLIC_RELAY_URL: string;
}

declare module "/src/lib/stores.ts" {
    export * from "$lib/stores";
}
