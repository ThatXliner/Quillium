/**
 * fontOptions.ts — Font picker option lists for the settings modal.
 *
 * Maps the static FONTS data into picker options and injects the two
 * runtime-resolved system entries (system sans + system mono), which depend
 * on which fonts are installed on this machine (document.fonts.check).
 */
import { FONTS } from "./fonts";

export type FontOption = {
    label: string;
    value: string;
    sample?: string;
    group?: string;
    featured?: boolean;
};

function firstInstalled(...names: string[]): { label: string; cssName: string } {
    // document.fonts is missing in jsdom (tests); fall through to the fallback.
    const fonts = typeof document !== "undefined" ? document.fonts : undefined;
    if (fonts) {
        for (const name of names) {
            if (fonts.check(`12px "${name}"`)) return { label: name, cssName: `"${name}"` };
        }
    }
    // None found — use the last as the labeled fallback
    const last = names[names.length - 1];
    return { label: last, cssName: `"${last}"` };
}

export const FONT_SAMPLE_PLACEHOLDER =
    Math.random() < 0.2
        ? "Sphinx of black quartz, judge my vow"
        : "The quick brown fox jumps over the lazy dog";

const mono = firstInstalled(
    "SF Mono",
    "JetBrains Mono",
    "Cascadia Code",
    "Fira Code",
    "Consolas",
    "Menlo",
);
const sans = firstInstalled("SF Pro Text", "Inter", "Segoe UI", "Helvetica Neue");

const monoStack = `${mono.cssName}, ui-monospace, monospace`;
export const sansStack = `${sans.cssName}, system-ui, sans-serif`;

export const DOC_FONTS: FontOption[] = [
    ...FONTS.filter((f) => f.docFont).map((f) => ({
        label: f.name,
        value: f.cssFamily,
        sample: f.sample,
        group: f.group,
        featured: f.docFeatured,
    })),
    ...(sans.label === "Inter" ? [] : [{ group: "Sans", label: sans.label, value: sansStack }]),
    { group: "Typewriter", label: mono.label, value: monoStack },
];

export const UI_FONTS: FontOption[] = [
    // System fonts come first as featured picks
    {
        featured: true,
        group: "Sans",
        label: sans.label,
        value: sansStack,
        sample: "Crisp system default",
    },
    {
        featured: true,
        group: "Mono",
        label: mono.label,
        value: monoStack,
        sample: "Crisp monospace precision",
    },
    ...FONTS.filter((f) => f.uiFont || f.uiFeatured).map((f) => ({
        label: f.name,
        value: f.cssFamily,
        sample: f.sample,
        group: f.group,
        featured: f.uiFeatured,
    })),
];
