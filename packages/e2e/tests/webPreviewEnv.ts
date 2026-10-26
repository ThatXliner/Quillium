/**
 * webPreviewEnv.ts — Resolves the opt-in Supabase contract for the real Web Preview suite.
 * The required mode is intentionally strict so CI cannot turn missing secrets into skipped tests.
 */

export type WebPreviewEnvironment = {
    enabled: boolean;
    required: boolean;
    url: string;
    serviceRoleKey: string;
    publishableKey: string;
};

type Environment = Record<string, string | undefined>;

const REQUIRED_ENV = ["E2E_SUPABASE_URL", "E2E_SUPABASE_SERVICE_ROLE_KEY"] as const;
const PUBLIC_KEY_ENV = "E2E_SUPABASE_PUBLISHABLE_KEY (or E2E_SUPABASE_ANON_KEY)";

export function resolveWebPreviewEnvironment(env: Environment): WebPreviewEnvironment {
    const required = env.E2E_WEB_PREVIEW_REQUIRED === "1";
    const url = env.E2E_SUPABASE_URL?.replace(/\/+$/, "") ?? "";
    const serviceRoleKey = env.E2E_SUPABASE_SERVICE_ROLE_KEY ?? "";
    const publishableKey = env.E2E_SUPABASE_PUBLISHABLE_KEY ?? env.E2E_SUPABASE_ANON_KEY ?? "";
    const missing: string[] = REQUIRED_ENV.filter((name) => !env[name]);
    if (!publishableKey) missing.push(PUBLIC_KEY_ENV);

    if (required && missing.length > 0) {
        throw new Error(
            `E2E_WEB_PREVIEW_REQUIRED=1 but required Web Preview environment is missing: ${missing.join(
                ", ",
            )}`,
        );
    }

    return {
        enabled: missing.length === 0,
        required,
        url,
        serviceRoleKey,
        publishableKey,
    };
}
