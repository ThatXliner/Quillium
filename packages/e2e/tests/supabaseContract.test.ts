/**
 * supabaseContract.test.ts — The Supabase seam of Track B: publish a wire
 * payload into `published_state` and read it back through the
 * `get_public_share_by_token` RPC the landing site uses, asserting the column +
 * RPC contract round-trips the payload unchanged.
 *
 * This needs a running local Supabase stack (`supabase start`) with the
 * `20260708000003_share_published_state.sql` migration applied, so it is GATED
 * behind env vars and skipped by default — the pure round-trip tests cover
 * fidelity without infra. Set these to run it:
 *   E2E_SUPABASE_URL, E2E_SUPABASE_SERVICE_ROLE_KEY
 */
import { describe, expect, it } from "vitest";
import { buildFixtureState, serializeFixtureWire } from "./fixtures";

const SUPABASE_URL = process.env.E2E_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY;
const enabled = Boolean(SUPABASE_URL && SERVICE_ROLE_KEY);

describe.skipIf(!enabled)("Supabase published_state contract", () => {
    it("round-trips the wire payload through the public-share RPC", async () => {
        // Indirect specifier + @vite-ignore so the bundler doesn't try to
        // resolve @supabase/supabase-js when this suite is skipped (it's an
        // optional dep, added only when the Supabase seam is wired up).
        const supabaseModule = "@supabase/supabase-js";
        const { createClient } = await import(/* @vite-ignore */ supabaseModule);
        const admin = createClient(SUPABASE_URL as string, SERVICE_ROLE_KEY as string);

        const { state } = buildFixtureState();
        const wire = serializeFixtureWire(state);
        const token = `e2e-${crypto.randomUUID()}`;

        // NOTE: table/column names track the migration under supabase/migrations.
        // Adjust the insert to match the shares schema when wiring this up.
        const { error: insertError } = await admin.from("shares").insert({
            share_token: token,
            published_title: "E2E fixture",
            published_content: state.doc.toString(),
            published_state: wire,
            is_public: true,
        });
        expect(insertError).toBeNull();

        const { data, error } = await admin
            .rpc("get_public_share_by_token", { p_share_token: token })
            .maybeSingle<{ published_state: Record<string, unknown> | null }>();

        expect(error).toBeNull();
        expect(data?.published_state).toEqual(wire);

        await admin.from("shares").delete().eq("share_token", token);
    });
});
