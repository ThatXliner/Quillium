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
        uiFont: true,
        sample: "Warm, readable default",
        desc: "Matthew Carter designed this specifically for screens in 1993, back when most fonts just got blurry at small sizes. The wider proportions and generous x-height were intentional: it was built to be read, not just displayed. Our default for a reason.",
    },
    {
        name: "Courier Prime",
        cssFamily: '"Courier Prime", "Courier New", Courier, monospace',
        category: "Typewriter",
        group: "Typewriter",
        docFeatured: true,
        uiFeatured: false,
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
        uiFont: false,
        sample: "Switch fonts to catch mistakes",
        desc: "Yes, on purpose. Vincent Connare designed it in 1994 to feel like comic book lettering—informal, asymmetric, impossible to take too seriously. Reading your draft in a font you'd never publish in is like reading it aloud: it breaks the spell and you hear what's actually there. We include it for the same reason.",
    },
    // ── Serif ─────────────────────────────────────────────────────────────────
    {
        name: "EB Garamond",
        cssFamily: '"EB Garamond", Garamond, Georgia, serif',
        category: "Serif",
        group: "Serif",
        docFeatured: true,
        uiFeatured: false,
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
        uiFont: true,
        sample: "Warm, literary serif",
        desc: "A contemporary serif with calligraphic roots, designed to feel handmade without sacrificing legibility. The contrast between strokes is moderate, which keeps it comfortable at body size without looking flat. Memoir, personal essays, anything that needs a human touch.",
    },
    {
        name: "Merriweather",
        cssFamily: '"Merriweather", Georgia, serif',
        category: "Serif",
        group: "Serif",
        docFeatured: false,
        uiFeatured: false,
        uiFont: false,
        desc: "Designed by Eben Sorkin with one explicit goal: comfortable long-form reading on screens. Slightly condensed proportions, generous x-height, and strong serifs that hold up at small sizes. One of the most widely used web serifs precisely because it doesn't get in the way. Good for anything you'd want someone to actually finish reading.",
    },
    {
        name: "Libre Baskerville",
        cssFamily: '"Libre Baskerville", Georgia, serif',
        category: "Serif",
        group: "Serif",
        docFeatured: false,
        uiFeatured: false,
        uiFont: false,
        desc: "A web-optimized revival of John Baskerville's 18th-century transitional serif. High stroke contrast, sharp serifs, serious presence — it sits between the warmth of old-style faces and the precision of modern ones. Good for writing that means business.",
    },
    {
        name: "Baskerville",
        cssFamily: '"Baskerville", "Baskerville Old Face", serif',
        category: "Serif",
        group: "Serif",
        docFeatured: false,
        uiFeatured: false,
        uiFont: true,
        desc: "The native system version of Baskerville — same DNA as Libre Baskerville, but rendered by your OS using its own hinting. On macOS it looks particularly crisp. Slightly different from platform to platform, which is worth knowing before you commit.",
    },
    {
        name: "Palatino",
        cssFamily: '"Palatino Linotype", Palatino, "Book Antiqua", serif',
        category: "Serif",
        group: "Serif",
        docFeatured: false,
        uiFeatured: false,
        uiFont: false,
        desc: "Hermann Zapf designed Palatino in 1949 with calligraphy as the explicit reference point. Wide, open letterforms with a handmade quality that still reads as refined. One of the few fonts that feels equally at home in a novel and a philosophy text. Handles long stretches without wearing you out.",
    },
    {
        name: "Charter",
        cssFamily: '"Charter", "Bitstream Charter", "Sitka Text", serif',
        category: "Serif",
        group: "Serif",
        docFeatured: false,
        uiFeatured: false,
        uiFont: false,
        desc: "Matthew Carter designed Charter in 1987 with a specific constraint: it had to look good even after being faxed or photocopied at low resolution. That robustness translates beautifully to screens. Sturdy, geometric, impossible to misread. iA Writer defaults to this — not a coincidence.",
    },
    {
        name: "New York",
        cssFamily: '"New York", ui-serif, Georgia, serif',
        category: "Serif",
        group: "Serif",
        docFeatured: false,
        uiFeatured: false,
        uiFont: true,
        desc: "Apple's in-house serif, introduced in 2019 as part of the San Francisco family. Uses optical sizing — the letterforms actually change shape depending on the display size, not just scale. Looks exceptional on Retina displays. Falls back to Georgia on non-Apple platforms.",
    },
    {
        name: "IM Fell English",
        cssFamily: '"IM Fell English", Georgia, serif',
        category: "Serif",
        group: "Serif",
        docFeatured: false,
        uiFeatured: false,
        uiFont: false,
        desc: "Digitized from type donated to Oxford University in the 1600s by Dr. John Fell. The original metal type was worn and imperfect; the digital version preserves those irregularities deliberately. Makes the page feel like it was set by hand. Historical fiction, gothic atmosphere, anything where you want the writing to feel old.",
    },
    {
        name: "Times New Roman",
        cssFamily: '"Times New Roman", Times, serif',
        category: "Serif",
        group: "Serif",
        docFeatured: false,
        uiFeatured: false,
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
        uiFont: false,
        sample: "Built for writing apps",
        desc: "Information Architects' custom font, designed from the ground up for their writing app. A proportional serif that prioritizes comfort over long writing sessions. The letterforms are carefully spaced to reduce eye fatigue and keep you in the text. If you've used iA Writer and loved how it felt to type in it, this is why.",
    },
    {
        name: "Arial",
        cssFamily: "Arial, Helvetica, sans-serif",
        category: "Sans-Serif",
        group: "Sans",
        docFeatured: false,
        uiFeatured: false,
        uiFont: false,
        desc: "Designed in 1982 as a metrically compatible alternative to Helvetica for IBM printers. Not beautiful (it lacks Helvetica's precision and personality) but it's genuinely readable at any size and installed on virtually every computer ever made. The draft-in-a-pinch font.",
    },
    {
        name: "Calibri",
        cssFamily: '"Calibri", "Gill Sans", sans-serif',
        category: "Sans-Serif",
        group: "Sans",
        docFeatured: false,
        uiFeatured: false,
        uiFont: false,
        desc: "Luc(as) de Groot designed Calibri for Microsoft in 2004, and it became the Office default in 2007. Slightly warmer than Arial, with softer rounded terminals that make it less cold on screen. If you wrote a lot in Word, your eye is already calibrated to this: that muscle memory is real. NSDA debate font, anyone?",
    },
    {
        name: "Verdana",
        cssFamily: "Verdana, Geneva, sans-serif",
        category: "Sans-Serif",
        group: "Sans",
        docFeatured: false,
        uiFeatured: false,
        uiFont: false,
        desc: "Another Matthew Carter commission, this time for Microsoft in 1996. Designed specifically for low-resolution CRT screens: wide proportions, generous spacing, distinct letterforms to prevent confusion at small sizes. Predates proper web typography by years. Still one of the most legible sans-serifs at small sizes.",
    },
    // ── Typewriter ────────────────────────────────────────────────────────────
    {
        name: "Special Elite",
        cssFamily: '"Special Elite", "Courier New", monospace',
        category: "Typewriter",
        group: "Typewriter",
        docFeatured: false,
        uiFeatured: false,
        uiFont: false,
        desc: "Based on the type produced by Royal Safari and Olympia SM typewriters—machines known for slightly uneven, characterful output. More distinctive than Courier, with more visible ink variation and irregularity. Reach for this when Courier Prime feels too polished and you want something with more grit.",
    },
    // ── Handwriting ───────────────────────────────────────────────────────────
    {
        name: "Caveat",
        cssFamily: '"Caveat", cursive',
        category: "Handwriting",
        group: "Handwriting",
        docFeatured: false,
        uiFeatured: false,
        uiFont: false,
        desc: "A casual handwriting font with deliberate variation between letterforms—no two characters are identical, which gives it a natural, uneven feel. Legible without being neat. Works well for journaling or when you want the page to feel like a real first draft: unguarded, in-progress, yours.",
    },
    {
        name: "Kalam",
        cssFamily: '"Kalam", cursive',
        category: "Handwriting",
        group: "Handwriting",
        docFeatured: false,
        uiFeatured: false,
        uiFont: false,
        desc: "Designed to look like careful hand printing rather than cursive—the kind of handwriting someone uses when they want to be read. More structured and legible than Caveat, less formal than a proper serif. Feels personal without feeling messy.",
    },
    // ── Accessibility ─────────────────────────────────────────────────────────
    {
        name: "OpenDyslexic",
        cssFamily: '"OpenDyslexic", sans-serif',
        category: "Accessibility",
        group: "Accessibility",
        docFeatured: false,
        uiFeatured: false,
        uiFont: false,
        sample: "Designed for dyslexic readers",
        desc: "Created by Abelardo Gonzalez to address some of the visual challenges associated with dyslexia. Each letterform has a weighted bottom that anchors it and makes flipping or mirroring less likely. The research on its effectiveness is mixed, but some readers find it significantly easier. Worth trying if standard fonts feel slippery or exhausting.",
    },
];

/** Fonts marked as Our Pick for the document font picker */
export const DOC_PICK_FONTS = FONTS.filter((f) => f.docFeatured);

/** All fonts eligible for the document font picker */
export const DOC_ALL_FONTS = FONTS;

/** Fonts marked as Our Pick for the UI font picker */
export const UI_PICK_FONTS = FONTS.filter((f) => f.uiFeatured);

/** All fonts eligible for the UI font picker */
export const UI_ALL_FONTS = FONTS.filter((f) => f.uiFont);
