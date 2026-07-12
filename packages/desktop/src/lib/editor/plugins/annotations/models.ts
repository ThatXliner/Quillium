/**
 * models.ts — Re-export shim for the shared annotation core.
 *
 * The annotation type defs, factory helpers, type guards, version-group
 * helpers, and schemas now live in @quillium/share so the desktop editor and
 * the web share renderer share ONE implementation (no drift). This file keeps
 * the historical `./models` import path working for the rest of the desktop
 * annotation subsystem.
 *
 * DO NOT add logic here — edit packages/share/src/core/models.ts instead.
 */
export * from "@quillium/share/core/models";
