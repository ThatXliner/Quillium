/**
 * fonts.ts — Canonical font list for Quillium.
 *
 * Single source of truth for all font metadata: CSS families, categories,
 * picker groups, "Our Pick" status, short samples, and guide descriptions.
 *
 * SettingsModal and FontGuideModal both derive their data from here.
 */

export type FontEntry = {
    /** Display name */
    name: string;
    /** CSS font-family stack */
    cssFamily: string;
    /** Category shown in the font guide */
    category: string;
    /** Group label used in the picker dropdown */
    group: string;
    /** Highlighted in the "Our Picks" section of the doc font picker */
    docFeatured: boolean;
    /** Highlighted in the "Our Picks" section of the UI font picker */
    uiFeatured: boolean;
    /** Short sample shown in the picker dropdown (falls back to PLACEHOLDER if absent) */
    sample?: string;
    /** Whether to show in the doc font picker at all */
    docFont: boolean;
    /** Whether to show in the UI font picker at all */
    uiFont: boolean;
    /** Long-form description shown in the font guide */
    desc: string;
};

/**
 * All fonts, in display order.
 *
 * Two runtime-resolved entries (System sans-serif, System monospace) are
 * intentionally absent — SettingsModal injects them after calling
 * firstInstalled() at mount time.
 */
export const FONTS: FontEntry[] = [
    // ── Our Picks ────────────────────────────────────────────────────────────
    {
        name: "Georgia",
        cssFamily: "Georgia, serif",
        category: "Serif",
        group: "Serif",
        docFeatured: true,
        uiFeatured: false,
        docFont: true,
        uiFont: true,
        sample: "Warm, readable (default)",
        desc: "Matthew Carter designed this specifically for screens in 1993, back when most fonts just got blurry at small sizes. The wider proportions and generous x-height were intentional: it was built to be read, not just displayed. Our default for a reason.",
    },
    {
        name: "Courier Prime",
        cssFamily: '"Courier Prime", "Courier New", Courier, monospace',
        category: "Typewriter",
        group: "Typewriter",
        docFeatured: true,
        uiFeatured: false,
        docFont: true,
        uiFont: false,
        sample: "Classic typewriter feel",
        desc: "Courier, but fixed. The original IBM Courier was designed for typewriters in 1955; this is a modern revival with better hinting and screen rendering. It's also the industry standard for screenplays: 12pt Courier at standard margins equals roughly one minute of screen time per page, which is why the whole industry locked onto it.",
    },
    {
        name: "Raleway",
        cssFamily: '"Raleway", system-ui, sans-serif',
        category: "Sans-Serif",
        group: "Sans",
        docFeatured: true,
        uiFeatured: false,
        docFont: true,
        uiFont: true,
        sample: "Elegant geometric sans",
        desc: "A geometric sans with unusually thin default weight and clean, open structure. Originally designed as a single-weight display font, it was expanded into a full family. It makes the page feel airy and modern without the coldness of a system UI font. Good for essays and anything contemporary.",
    },
    {
        name: "Comic Sans MS",
        cssFamily: '"Comic Sans MS", "Comic Sans", cursive',
        category: "Misc",
        group: "Misc",
        docFeatured: true,
        uiFeatured: false,
        docFont: true,
        uiFont: false,
        sample: "heheheha",
        desc: "Yes, on purpose. Vincent Connare designed it in 1994 to feel like comic book lettering—informal, asymmetric, impossible to take too seriously. Reading your draft in a font you'd never publish in is like reading it aloud: it breaks the spell and you hear what's actually there. We include it for the same reason.",
    },
    // ── Serif ─────────────────────────────────────────────────────────────────
    {
        name: "EB Garamond",
        cssFamily: '"EB Garamond", Garamond, Georgia, serif',
        category: "Serif",
        group: "Serif",
        docFeatured: false,
        uiFeatured: false,
        docFont: true,
        uiFont: false,
        desc: "A faithful open-source revival of Claude Garamond's 16th-century typefaces, based on a 1592 specimen. The fine detail in the serifs and the contrast between thick and thin strokes reads beautifully at large sizes. Makes long-form fiction feel like a proper printed book.",
    },
    {
        name: "Lora",
        cssFamily: '"Lora", Georgia, serif',
        category: "Serif",
        group: "Serif",
        docFeatured: false,
        uiFeatured: true,
        docFont: true,
        uiFont: true,
        sample: "Warm, literary serif",
        desc: "A contemporary serif with calligraphic roots, designed to feel handmade without sacrificing legibility. The contrast between strokes is moderate, which keeps it comfortable at body size without looking flat. Memoir, personal essays, anything that needs a human touch.",
    },
    {
        name: "Times New Roman",
        cssFamily: '"Times New Roman", Times, serif',
        category: "Serif",
        group: "Serif",
        docFeatured: false,
        uiFeatured: false,
        docFont: true,
        uiFont: false,
        desc: "Commissioned by The Times of London in 1931 and optimized for newspaper column widths. It's here because decades of school essays and word processor defaults have made it the invisible furniture of writing. Not interesting, but it works, and sometimes that's enough.",
    },
    // ── Sans-Serif ────────────────────────────────────────────────────────────
    {
        name: "Inter",
        cssFamily: '"Inter", system-ui, sans-serif',
        category: "Sans-Serif",
        group: "Sans",
        docFeatured: false,
        uiFeatured: true,
        docFont: false,
        uiFont: true,
        sample: "The modern UI standard",
        desc: "Rasmus Andersson designed Inter specifically for user interfaces—the letterforms are optimized for small sizes on screens, with features like disambiguated characters (l, 1, I) and open apertures that make it highly legible in UI contexts. It became the de facto standard for product interfaces in the early 2020s for good reason.",
    },
    {
        name: "Nunito",
        cssFamily: '"Nunito", system-ui, sans-serif',
        category: "Sans-Serif",
        group: "Sans",
        docFeatured: false,
        uiFeatured: false,
        docFont: false,
        uiFont: true,
        sample: "Soft, rounded, friendly",
        desc: "A well-balanced rounded sans-serif. The rounded terminals soften what would otherwise be a fairly geometric typeface, giving it warmth without sacrificing legibility. Not cold or corporate, but not informal either, very fitting for Quillium.",
    },
    {
        name: "iA Writer Quattro",
        cssFamily: '"iA Writer Quattro", Georgia, serif',
        category: "Serif",
        group: "Serif",
        docFeatured: false,
        uiFeatured: false,
        docFont: true,
        uiFont: false,
        sample: "Built for writing apps",
        desc: "Information Architects' custom font, designed from the ground up for their writing app. A proportional serif that prioritizes comfort over long writing sessions. The letterforms are carefully spaced to reduce eye fatigue and keep you in the text. If you've used iA Writer and loved how it felt to type in it, this is why.",
    },
    {
        name: "Calibri",
        cssFamily: '"Calibri", "Gill Sans", sans-serif',
        category: "Sans-Serif",
        group: "Sans",
        docFeatured: false,
        uiFeatured: false,
        docFont: true,
        uiFont: true,
        desc: "Luc(as) de Groot designed Calibri for Microsoft in 2004, and it became the Office default in 2007. Slightly warmer than Arial, with softer rounded terminals that make it less cold on screen. If you wrote a lot in Word, your eye is already calibrated to this: that muscle memory is real. NSDA debate font, anyone?",
    },
    // ── Typewriter ────────────────────────────────────────────────────────────
    // ── Handwriting ───────────────────────────────────────────────────────────
    {
        name: "Caveat",
        cssFamily: '"Caveat", cursive',
        category: "Handwriting",
        group: "Handwriting",
        docFeatured: false,
        uiFeatured: false,
        docFont: true,
        uiFont: false,
        desc: "A casual handwriting font with deliberate variation between letterforms—no two characters are identical, which gives it a natural, uneven feel. Legible without being neat. Works well for journaling or when you want the page to feel like a real first draft: unguarded, in-progress, yours.",
    },
    // ── Accessibility ─────────────────────────────────────────────────────────
    {
        name: "OpenDyslexic",
        cssFamily: '"OpenDyslexic", sans-serif',
        category: "Accessibility",
        group: "Accessibility",
        docFeatured: false,
        uiFeatured: false,
        docFont: true,
        uiFont: true,
        sample: "Designed for dyslexic readers",
        desc: "Created by Abelardo Gonzalez to address some of the visual challenges associated with dyslexia. Each letterform has a weighted bottom that anchors it and makes flipping or mirroring less likely. The research on its effectiveness is mixed, but some readers find it significantly easier. Worth trying if standard fonts feel slippery or exhausting.",
    },
];

/** Fonts marked as Our Pick for the document font picker */
export const DOC_PICK_FONTS = FONTS.filter((f) => f.docFeatured);

/** All fonts eligible for the document font picker */
export const DOC_ALL_FONTS = FONTS.filter((f) => f.docFont);

/** Fonts marked as Our Pick for the UI font picker */
export const UI_PICK_FONTS = FONTS.filter((f) => f.uiFeatured);

/** All fonts eligible for the UI font picker */
export const UI_ALL_FONTS = FONTS.filter((f) => f.uiFont);
