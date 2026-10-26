/**
 * versionGroupField.ts — Re-export shim for the shared annotation core.
 *
 * The versionGroupField StateField (linked revisions, #268) and its effects
 * now live in @quillium/share. This keeps the `./versionGroupField` import path
 * working.
 *
 * DO NOT add logic here — edit packages/share/src/core/versionGroupField.ts instead.
 */
export * from "@quillium/share/core/versionGroupField";
