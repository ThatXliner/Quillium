export const MAS_BUILD = import.meta.env.VITE_MAS === "true";

export const MAS_ANALYTICS_CONSENT_KEY = "quillium_mas_analytics_consent";

export type MasAnalyticsConsent = "granted" | "declined";

export function readMasAnalyticsConsent(): MasAnalyticsConsent | null {
    if (typeof localStorage === "undefined") return null;
    try {
        const raw = localStorage.getItem(MAS_ANALYTICS_CONSENT_KEY);
        return raw === "granted" || raw === "declined" ? raw : null;
    } catch {
        return null;
    }
}

export function hasMasAnalyticsConsentChoice(): boolean {
    return readMasAnalyticsConsent() !== null;
}

export function persistMasAnalyticsConsent(enabled: boolean) {
    if (typeof localStorage === "undefined") return;
    try {
        localStorage.setItem(MAS_ANALYTICS_CONSENT_KEY, enabled ? "granted" : "declined");
    } catch {}
}
