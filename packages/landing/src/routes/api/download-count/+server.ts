import { json } from "@sveltejs/kit";
import { env as privateEnv } from "$env/dynamic/private";
import { env as publicEnv } from "$env/dynamic/public";
import type { RequestHandler } from "./$types";

const PROJECT_ID = "334824";
const CACHE_TTL = 30 * 24 * 60 * 60 * 1000; // 1 month

let cache: { count: number; fetchedAt: number } | null = null;

function roundTo1SigFig(n: number): number {
    if (n === 0) return 0;
    const d = Math.ceil(Math.log10(Math.abs(n)));
    const power = Math.pow(10, d - 1);
    return Math.round(n / power) * power;
}

export const GET: RequestHandler = async ({ fetch }) => {
    if (cache && Date.now() - cache.fetchedAt < CACHE_TTL) {
        return json({ count: cache.count });
    }

    if (!privateEnv.POSTHOG_PERSONAL_API_KEY) {
        return json({ count: 0 });
    }

    const posthogHost = publicEnv.PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";

    try {
        const res = await fetch(`${posthogHost}/api/projects/${PROJECT_ID}/query`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${privateEnv.POSTHOG_PERSONAL_API_KEY}`,
            },
            body: JSON.stringify({
                query: {
                    kind: "TrendsQuery",
                    series: [{ kind: "EventsNode", event: "download_clicked", math: "total" }],
                    dateRange: { date_from: "all" },
                    trendsFilter: { display: "BoldNumber" },
                },
            }),
        });

        if (!res.ok) {
            console.error("[download-count] PostHog query failed:", res.status);
            return json({ count: 0 });
        }

        const data = await res.json();
        const total = data.results?.[0]?.aggregated_value ?? 0;
        const rounded = roundTo1SigFig(total);

        cache = { count: rounded, fetchedAt: Date.now() };
        return json({ count: rounded });
    } catch (e) {
        console.error("[download-count] PostHog query error:", e);
        return json({ count: 0 });
    }
};
