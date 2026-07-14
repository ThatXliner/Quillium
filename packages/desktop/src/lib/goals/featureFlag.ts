/** featureFlag.ts — Shared Novel November feature-flag contract. */

export const NOVEL_NOVEMBER_FEATURE_FLAG = "novel-november";

/** PostHog can return booleans or variant strings. This feature is boolean-only and fail-closed. */
export function isNovelNovemberFlagEnabled(value: boolean | string | undefined): boolean {
    return value === true;
}
