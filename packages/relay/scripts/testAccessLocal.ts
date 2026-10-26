import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const status = spawnSync(
    "supabase",
    ["status", "--workdir", process.env.QUILLIUM_TEST_SUPABASE_WORKDIR ?? root, "-o", "json"],
    { cwd: root, encoding: "utf8" },
);
if (status.status !== 0)
    throw new Error("Start the disposable local Supabase stack before running access tests");
const runtime = z
    .object({
        API_URL: z.url(),
        SERVICE_ROLE_KEY: z.string().min(1),
        PUBLISHABLE_KEY: z.string().optional(),
        ANON_KEY: z.string().optional(),
    })
    .parse(JSON.parse(status.stdout));
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(runtime.API_URL).hostname))
    throw new Error("Access tests require a local Supabase stack");
const publicKey = runtime.PUBLISHABLE_KEY ?? runtime.ANON_KEY;
if (!publicKey) throw new Error("Local Supabase publishable key is missing");
const env = {
    ...process.env,
    E2E_ACCESS_REQUIRED: "1",
    E2E_WEB_PREVIEW_REQUIRED: "1",
    E2E_SUPABASE_URL: runtime.API_URL,
    E2E_SUPABASE_SERVICE_ROLE_KEY: runtime.SERVICE_ROLE_KEY,
    E2E_SUPABASE_PUBLISHABLE_KEY: publicKey,
};
for (const args of [
    ["run", "relay:test:run"],
    ["run", "--cwd", "packages/e2e", "test:run", "tests/relayConvergence.test.ts"],
]) {
    const result = spawnSync("bun", args, { cwd: root, env, stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
}
