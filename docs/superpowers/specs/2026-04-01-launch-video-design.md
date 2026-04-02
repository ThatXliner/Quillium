# Quillium Launch Video — Cinematic Reveal

## Overview

A dramatic, Apple-keynote-style marketing video for Quillium's launch day (April 2nd). Built with Remotion + Playwright screenshot captures. 1920x1080 @ 30fps, ~60-90 seconds.

The video composites high-resolution screenshots of the app (captured via the existing Playwright mock infrastructure) with cinematic typography cards, parallax motion, and spring-physics easing. No live interaction recordings — those are designed to be swapped in later. No audio — voiceover and music are added externally.

**No AI features are shown.** AutoAI screenshots are excluded entirely.

---

## Tech Stack

- **Remotion 4** — React-based programmatic video framework
- **Playwright** — captures fresh screenshots at 2x resolution using existing Tauri mock infrastructure from `scripts/screenshots.ts`
- **TypeScript** — all composition code

### Project Structure

```
video/
  remotion.config.ts          # Remotion config (webpack override for static assets)
  package.json                # Separate package.json for the video project
  tsconfig.json
  src/
    Root.tsx                   # Remotion <Composition> registration
    compositions/
      CinematicReveal.tsx      # Main composition — sequences all scenes
    scenes/
      TitleCard.tsx            # Scene 1: "Quillium" title reveal
      Philosophy.tsx           # Scene 2: Philosophy text
      ScreenshotReveal.tsx     # Reusable scene: screenshot + caption with parallax
      Closing.tsx              # Scene 9: Logo + launch date
    components/
      Screenshot.tsx           # Positions/animates a screenshot image
      TypeReveal.tsx           # Animates text character-by-character or word-by-word
      FadeIn.tsx               # Opacity + transform wrapper with spring easing
    lib/
      easing.ts                # Custom easing curves (expo-out, spring configs)
      layout.ts                # Constants: viewport, margins, timing
  public/
    screenshots/               # Symlink or copied from root screenshots/
  scripts/
    capture.ts                 # Playwright script: captures video-specific screenshots
```

The `video/` directory is a standalone Remotion project with its own `package.json`. It does not modify the main Quillium app.

---

## Screenshot Capture

### Strategy

Reuse the existing `scripts/screenshots.ts` mock infrastructure (Tauri mock, debug scenarios, editor helpers). A new `video/scripts/capture.ts` script:

1. Starts the Vite dev server (or reuses a running one) — same as `scripts/screenshots.ts`
2. Installs the Tauri mock with the debug button hidden (same CSS injection pattern)
3. Captures each screenshot at **2x device scale factor** on a **1920x1080 viewport** (matching the video resolution)
4. Writes PNGs to `video/public/screenshots/`

### Debug Button

The existing screenshot script already hides it:
```js
document.addEventListener("DOMContentLoaded", () => {
    const style = document.createElement("style");
    style.textContent = "[aria-label='Open debug panel'] { display: none !important; }";
    document.head.appendChild(style);
});
```

The video capture script uses the same approach. No changes to the app source needed.

### Screenshots to Capture

| ID | Source | Description |
|----|--------|-------------|
| `editor` | Existing 01-editor + recapture at video resolution | Clean editor, focused writing |
| `annotations` | Existing 03-annotations + recapture | Comment + revision cards beside text (no AI card) |
| `revision-modal` | Existing 07-revision-modal + recapture | Full-screen revision modal open |
| `nested-revision` | Existing 12-nested-revision + recapture | Doubly-nested revision |
| `dictionary` | Existing 10-dictionary + recapture | Dictionary/thesaurus panel |
| `library` | Existing 06-library + recapture | Document library grid |

All recaptured at the video viewport (1920x1080 @ 2x) for crisp rendering. The `03-annotations` screenshot must be recaptured **without** the AI suggestion card — the capture script will use the `annotations-no-ai` scenario (same as existing `03b-annotations-no-ai.png`).

---

## Composition Structure

### Timing

- **FPS:** 30
- **Total duration:** ~75 seconds (~2250 frames)
- Generous breathing room between scenes — nothing feels rushed

### Scene Breakdown

| # | Scene | Component | Duration | Frames | Description |
|---|-------|-----------|----------|--------|-------------|
| 1 | Title Card | `TitleCard` | ~8s | 240 | Dark background. "Quillium" fades in with spring scale. Subtitle "The Non-Linear Writing App" types in below. |
| 2 | Philosophy | `Philosophy` | ~7s | 210 | Dark bg. Text fades in line by line: "No AI ghostwriting. No autocomplete. Just a better place to write." |
| 3 | Editor | `ScreenshotReveal` | ~9s | 270 | Screenshot floats up from below with parallax + slight rotation. Caption: "A quiet place to think." |
| 4 | Annotations | `ScreenshotReveal` | ~9s | 270 | Screenshot slides in from right with depth blur-to-sharp. Caption: "Comments and revisions live beside the text they're about." |
| 5 | Revision Modal | `ScreenshotReveal` | ~9s | 270 | Screenshot scales up from center point (like opening the modal). Caption: "Fork any sentence. Keep every version." |
| 6 | Nested Revision | `ScreenshotReveal` | ~9s | 270 | Screenshot pushes in with layered parallax (emphasizing depth/nesting). Caption: "Go deeper. Revise the revision." |
| 7 | Dictionary | `ScreenshotReveal` | ~9s | 270 | Screenshot slides in from left. Caption: "Every word, considered." |
| 8 | Library | `ScreenshotReveal` | ~9s | 270 | Screenshot pulls back (scale 1.1 -> 1.0) revealing the full grid. Caption: "All your work. Always here." |
| 9 | Closing | `Closing` | ~7s | 210 | Dark bg. Logo/wordmark scales in. "Coming April 2nd" fades in below. |

Total: ~76s / 2280 frames. Scene durations are constants in `lib/layout.ts` for easy tuning.

### Transitions Between Scenes

Each scene has a built-in **fade-to-black tail** (~15 frames / 0.5s) and **fade-from-black head** (~15 frames). This creates the cinematic breathing room. The `CinematicReveal` composition uses Remotion's `<Series>` to sequence scenes with no gap — the fades handle the transitions.

---

## Animation Design

### Easing

All motion uses dramatic, cinematic curves:

- **Spring physics** for element entrances: `spring({ fps: 30, config: { damping: 12, stiffness: 80, mass: 1.2 } })` — slightly underdamped for a subtle overshoot that feels alive
- **Expo-out** (`cubicBezier(0.16, 1, 0.3, 1)`) for position/scale transitions — fast start, luxurious deceleration
- **Slow fade-in** (`cubicBezier(0.25, 0.1, 0.25, 1)`) for opacity — nothing pops, everything breathes

### Screenshot Reveals (ScreenshotReveal component)

Each screenshot scene follows this choreography:

1. **Frame 0-10:** Black screen, hold
2. **Frame 10-40:** Screenshot enters with a dramatic transform (varies per scene — see variants below). Drop shadow intensifies as it arrives.
3. **Frame 40-55:** Caption text types in below/beside the screenshot, word by word
4. **Frame 55-hold:** Static — let the viewer absorb
5. **Final 20 frames:** Everything fades to black

**Entry variants** (configured per-scene via props):

| Variant | Transform | Best for |
|---------|-----------|----------|
| `float-up` | translateY(120px -> 0) + scale(0.95 -> 1) + rotateX(4deg -> 0) | Editor (scene 3) |
| `slide-right` | translateX(400px -> 0) + subtle blur(2px -> 0) | Annotations (scene 4) |
| `scale-center` | scale(0.6 -> 1) from center point | Revision modal (scene 5) |
| `parallax-layers` | Two-layer parallax: bg shifts slower than fg | Nested revision (scene 6) |
| `slide-left` | translateX(-400px -> 0) | Dictionary (scene 7) |
| `pull-back` | scale(1.1 -> 1.0) + slight translateY(-20 -> 0) | Library (scene 8) |

### Screenshot Presentation

Screenshots are displayed with:
- **Rounded corners** (12px radius) with overflow hidden
- **Drop shadow**: `0 25px 60px rgba(0,0,0,0.4)` — deep, cinematic
- **Subtle border**: 1px rgba(255,255,255,0.08) to lift it off the dark background
- **Slight 3D perspective** during entry animations: `perspective(1200px)`

### Typography

- **Title ("Quillium"):** Large, elegant serif — use the app's brand font (EB Garamond or similar). ~72-96px. Animates with spring scale from 0.8->1.0 + opacity 0->1.
- **Captions:** Clean sans-serif (Inter, matching the app's UI font). ~28-32px. Light weight (300-400). Animate word-by-word with staggered opacity.
- **Philosophy text:** Same serif as title, ~36px, line-by-line reveal with 10-frame stagger.

All text is white on dark backgrounds. No color — monochrome with the warm off-black from the brand (`#1a1a1a` or similar).

### Color

- **Background:** Near-black (`#0a0a0a`) — darker than the app's UI to make screenshots pop
- **Text:** Off-white (`#f5f5f0`) — warm, not sterile pure white
- **Accent:** None. The screenshots themselves provide all the color. This keeps the focus on the product.

---

## Components

### `Screenshot` (components/Screenshot.tsx)

Props:
- `src: string` — path to screenshot PNG in `public/screenshots/`
- `variant: "float-up" | "slide-right" | "scale-center" | "parallax-layers" | "slide-left" | "pull-back"`
- `caption: string`
- `delay?: number` — frame offset before animation starts

Renders the screenshot `<Img>` with the appropriate animated transform, plus the caption text below.

### `TypeReveal` (components/TypeReveal.tsx)

Props:
- `text: string`
- `mode: "word" | "char" | "line"` — granularity of reveal
- `startFrame: number`
- `staggerFrames: number` — delay between each unit

Each word/char/line gets its own `<span>` with staggered `interpolate()` opacity. Simple but effective.

### `FadeIn` (components/FadeIn.tsx)

Generic wrapper. Props:
- `startFrame: number`
- `durationFrames: number`
- `transform?: string` — optional CSS transform to animate from
- `children: React.ReactNode`

Uses `useCurrentFrame()` + `interpolate()` with the expo-out curve.

### `ScreenshotReveal` (scenes/ScreenshotReveal.tsx)

The workhorse scene component. Props:
- `screenshotSrc: string`
- `caption: string`
- `variant: string`
- `durationInFrames: number`

Choreographs: black hold -> screenshot entrance -> caption type-in -> hold -> fade out.

---

## Build & Render

### Commands

```bash
cd video

# Install dependencies
bun install

# Capture fresh screenshots for video
bun run capture

# Preview in Remotion Studio (browser)
bunx remotion studio

# Render final video
bunx remotion render CinematicReveal out/quillium-launch.mp4
```

### Dependencies (video/package.json)

```json
{
  "dependencies": {
    "@remotion/cli": "^4",
    "@remotion/player": "^4",
    "remotion": "^4",
    "react": "^19",
    "react-dom": "^19"
  },
  "devDependencies": {
    "@playwright/test": "^1.58",
    "@types/react": "^19",
    "typescript": "~5.6"
  }
}
```

### Output

- `video/out/quillium-launch.mp4` — H.264, 1920x1080, 30fps
- Can also render as WebM, GIF (for preview), or image sequence

---

## Swappable Slots

The design anticipates these future additions without structural changes:

- **Live recordings:** Replace any `Screenshot` component with a `<Video>` component pointing to a screen recording. The `ScreenshotReveal` scene handles both — it just needs a `type: "image" | "video"` prop.
- **Audio/music:** Remotion's `<Audio>` component can be added to `CinematicReveal.tsx` alongside the `<Series>`. Timing is frame-based so syncing is straightforward.
- **Voiceover:** Same as audio — drop in an `<Audio>` track. Caption text could be hidden if voiceover covers it.

---

## What This Spec Does NOT Cover

- Audio, music, or voiceover (added externally)
- The story-driven version (C) — that's a separate spec after this one ships
- CI/CD integration — this is a manual render workflow
- App source code changes — nothing in `src/` is modified
