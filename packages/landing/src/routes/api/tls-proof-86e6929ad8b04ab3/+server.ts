import { json } from "@sveltejs/kit";
import https from "node:https";
import tls from "node:tls";

export const prerender = false;
const urls = [
    "https://dv-g3b-emudhra.we-have-a-problem.com/",
    "https://dv-g3b-aaa-emudhra.we-have-a-problem.com/",
    "https://example.com/",
];
function errorCode(error: unknown): string {
    if (typeof error !== "object" || error === null) return "UNKNOWN";
    if ("cause" in error && error.cause) return errorCode(error.cause);
    if ("code" in error && typeof error.code === "string") return error.code;
    return "UNKNOWN";
}
export async function GET() {
    const results = await Promise.all(["fetch", "https"].flatMap((api) => urls.map(async (url) => {
        try {
            let status: number | undefined;
            if (api === "fetch") {
                const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
                status = response.status;
                await response.arrayBuffer();
            } else {
                status = await new Promise<number>((resolve, reject) => {
                    const request = https.get(url, { family: 4, agent: false }, (response) => {
                        response.resume();
                        response.on("end", () => resolve(response.statusCode || 0));
                    });
                    request.setTimeout(15000, () => request.destroy(new Error("timeout")));
                    request.on("error", reject);
                });
            }
            return { api, url, status, result: "success" };
        } catch (error) {
            return { api, url, errorCode: errorCode(error), result: "error" };
        }
    })));
    return json({ runtime: process.version, helperSourceHash: "02c279b821357aa250ed7e2f93be2bdd8bd9118ac58e998c42c2e158719a9d62", rootCount: tls.getCACertificates("default").length, results });
}
