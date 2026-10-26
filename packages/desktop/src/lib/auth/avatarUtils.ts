/**
 * avatarUtils.ts — Compatibility re-export for shared avatar helpers.
 *
 * Keep desktop imports stable while @quillium/share remains the only source of
 * initials and deterministic avatar-color behavior.
 */
export { avatarColor, initials } from "@quillium/share";
