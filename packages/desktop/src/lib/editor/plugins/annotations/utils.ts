/**
 * utils.ts — Re-export shim for the shared annotation core.
 *
 * Pure query/transform helpers (cleanRangesOf, mapRange, getActiveAnnotation,
 * …) now live in @quillium/share. This keeps the `./utils` import path working.
 *
 * DO NOT add logic here — edit packages/share/src/core/utils.ts instead.
 */
export * from "@quillium/share/core/utils";
