function required(name: string): string {
    const value = process.env[name];
    if (!value) throw new Error(`Missing required env var: ${name}`);
    return value;
}

export const PORT = parseInt(process.env.PORT ?? "8080", 10);
export const SUPABASE_URL = required("SUPABASE_URL");
export const SUPABASE_SERVICE_ROLE_KEY = required("SUPABASE_SERVICE_ROLE_KEY");
