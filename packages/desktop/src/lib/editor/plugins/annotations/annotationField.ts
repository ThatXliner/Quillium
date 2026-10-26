/**
 * annotationField.ts — Re-export shim for the shared annotation core.
 *
 * The annotationField StateField, its effects/commands, undo inversion, and
 * the version-switch command now live in @quillium/share so the desktop editor
 * and the web share renderer use the SAME StateField instance and logic. This
 * keeps the `./annotationField` import path working across the desktop
 * annotation subsystem.
 *
 * DO NOT add logic here — edit packages/share/src/core/annotationField.ts instead.
 */
export * from "@quillium/share/core/annotationField";
