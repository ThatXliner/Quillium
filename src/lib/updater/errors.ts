function errorText(error: unknown): string {
    if (typeof error === "string") return error;
    if (error instanceof Error) return `${error.name} ${error.message} ${error.stack ?? ""}`;
    if (typeof error === "object" && error !== null) {
        try {
            return JSON.stringify(error);
        } catch {
            return String(error);
        }
    }
    return String(error);
}

export function isGithubRateLimitUpdateError(error: unknown): boolean {
    const text = errorText(error).toLowerCase();
    const mentionsGithub = text.includes("github.com") || text.includes("githubusercontent.com");
    const mentionsRateLimit = /rate[- ]?limit|ratelimit|api rate limit exceeded/.test(text);
    const mentionsTooManyRequests = text.includes("429") || text.includes("too many requests");
    const mentionsForbidden = text.includes("403") || text.includes("forbidden");

    return mentionsRateLimit || mentionsTooManyRequests || (mentionsGithub && mentionsForbidden);
}
