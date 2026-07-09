/**
 * runLocal.ts — Run the complete Omni Web Preview E2E stack against the
 * repository's local Supabase instance.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

type SupabaseStatus = {
    API_URL: string;
    ANON_KEY?: string;
    PUBLISHABLE_KEY?: string;
    SERVICE_ROLE_KEY: string;
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function run(command: string, args: string[], env = process.env): void {
    const result = spawnSync(command, args, {
        cwd: repoRoot,
        env,
        stdio: "inherit",
    });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
}

function readStatus(): SupabaseStatus | null {
    const result = spawnSync("supabase", ["status", "-o", "json"], {
        cwd: repoRoot,
        encoding: "utf8",
    });
    if (result.status !== 0) return null;
    return JSON.parse(result.stdout) as SupabaseStatus;
}

let status = readStatus();
if (!status) {
    run("supabase", ["start"]);
    status = readStatus();
}
if (!status) throw new Error("Could not read local Supabase credentials after startup");

run("supabase", ["migration", "up", "--local"]);

const publicKey = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
if (!publicKey) throw new Error("Local Supabase did not report a publishable or anon key");

const env = {
    ...process.env,
    E2E_SUPABASE_URL: status.API_URL,
    E2E_SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
    E2E_SUPABASE_PUBLISHABLE_KEY: publicKey,
};

run("bun", ["run", "--cwd", "packages/e2e", "test:run"], env);
run("bun", ["run", "--cwd", "packages/e2e", "test:web"], env);
