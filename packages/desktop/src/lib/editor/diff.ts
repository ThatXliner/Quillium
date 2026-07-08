/**
 * diff.ts — Re-export shim for the shared word-level diff.
 *
 * The pure diff implementation now lives in @quillium/share so the editor's
 * suggestion previews / track-changes and the web preview's suggestion cards
 * share ONE algorithm. This keeps the `$lib/editor/diff` import path working.
 *
 * DO NOT add logic here — edit packages/share/src/annotations/diff.ts instead.
 */
export * from "@quillium/share/annotations/diff";
