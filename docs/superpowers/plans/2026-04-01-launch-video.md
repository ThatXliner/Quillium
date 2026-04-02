# Quillium Launch Video Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a cinematic Apple-keynote-style launch video using Remotion + Playwright screenshots, rendering to 1920x1080 MP4 at 30fps.

**Architecture:** Standalone `video/` directory with its own Remotion project. A Playwright capture script reuses the main app's Tauri mock infrastructure to grab 2x screenshots. Remotion compositions sequence 9 scenes (title, philosophy, 6 screenshot reveals, closing) with spring-physics easing and dramatic transitions. Scenes that will eventually use video recordings render branded placeholders for now.

**Tech Stack:** Remotion 4, React 19, Playwright, TypeScript

**Spec:** `docs/superpowers/specs/2026-04-01-launch-video-design.md`

**Branding reference:** `BRANDING.md` — warm, creative, focused. EB Garamond for display, Inter for UI captions. Near-black backgrounds (`#0a0a0a`), warm off-white text (`#f5f5f0`). No neon, no gradients, no generic AI aesthetic.

---

## File Structure

```
video/
  package.json
  tsconfig.json
  src/
    index.ts                              # registerRoot(Root)
    Root.tsx                              # <Composition> registration
    lib/
      easing.ts                           # Spring configs, expo-out interpolation helper
      layout.ts                           # Timing constants, colors, fonts, dimensions
    components/
      TypeReveal.tsx                       # Word-by-word / line-by-line text reveal
      ScreenshotFrame.tsx                  # Screenshot with rounded corners, shadow, border
      VideoPlaceholder.tsx                 # Branded placeholder for future video slots
    scenes/
      TitleCard.tsx                        # Scene 1: "Quillium" + subtitle
      Philosophy.tsx                       # Scene 2: Philosophy text line-by-line
      ScreenshotReveal.tsx                 # Scenes 3-8: Screenshot + caption with entry variant
      Closing.tsx                          # Scene 9: Logo + launch date
    compositions/
      CinematicReveal.tsx                  # Main composition: TransitionSeries of all scenes
  public/
    screenshots/                          # Captured PNGs (gitignored)
    logo.svg                              # Quillium logo (copied from website assets)
  scripts/
    capture.ts                            # Playwright screenshot capture for video
```

---

## Task 1: Scaffold the Remotion project

**Files:**
- Create: `video/package.json`
- Create: `video/tsconfig.json`
- Create: `video/src/index.ts`
- Create: `video/src/Root.tsx`
- Create: `video/public/.gitkeep`

- [ ] **Step 1: Create `video/package.json`**

```json
{
    "name": "quillium-video",
    "private": true,
    "type": "module",
    "scripts": {
        "studio": "remotion studio",
        "render": "remotion render CinematicReveal out/quillium-launch.mp4",
        "render:preview": "remotion render CinematicReveal out/preview.mp4 --scale=0.5",
        "capture": "bun scripts/capture.ts"
    },
    "dependencies": {
        "@remotion/cli": "^4",
        "@remotion/transitions": "^4",
        "react": "^19",
        "react-dom": "^19",
        "remotion": "^4"
    },
    "devDependencies": {
        "@playwright/test": "^1.58",
        "@types/react": "^19",
        "typescript": "~5.6"
    }
}
```

- [ ] **Step 2: Create `video/tsconfig.json`**

```json
{
    "compilerOptions": {
        "target": "ES2022",
        "module": "ESNext",
        "moduleResolution": "bundler",
        "jsx": "react-jsx",
        "strict": true,
        "esModuleInterop": true,
        "skipLibCheck": true,
        "outDir": "dist",
        "rootDir": "src",
        "baseUrl": ".",
        "paths": {
            "@/*": ["src/*"]
        }
    },
    "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create `video/src/index.ts`**

```ts
import { registerRoot } from "remotion";
import { Root } from "./Root";

registerRoot(Root);
```

- [ ] **Step 4: Create a placeholder `video/src/Root.tsx`**

This registers a minimal composition so we can verify the project runs. We'll update it in Task 8.

```tsx
import { Composition } from "remotion";
import { AbsoluteFill } from "remotion";

const Placeholder: React.FC = () => (
    <AbsoluteFill style={{ backgroundColor: "#0a0a0a", justifyContent: "center", alignItems: "center" }}>
        <span style={{ color: "#f5f5f0", fontSize: 48, fontFamily: "EB Garamond, Georgia, serif" }}>
            Quillium
        </span>
    </AbsoluteFill>
);

export const Root: React.FC = () => (
    <Composition
        id="CinematicReveal"
        component={Placeholder}
        durationInFrames={90}
        width={1920}
        height={1080}
        fps={30}
    />
);
```

- [ ] **Step 5: Create `video/public/.gitkeep`**

Empty file so the directory is tracked.

- [ ] **Step 6: Install dependencies and verify**

```bash
cd video && bun install
```

- [ ] **Step 7: Verify Remotion Studio launches**

```bash
cd video && bunx remotion studio
```

Expected: Browser opens with "CinematicReveal" composition showing "Quillium" text on dark background. Close after confirming.

- [ ] **Step 8: Commit**

```bash
git add video/
git commit -m "scaffold Remotion video project with placeholder composition"
```

---

## Task 2: Layout constants and easing utilities

**Files:**
- Create: `video/src/lib/layout.ts`
- Create: `video/src/lib/easing.ts`

- [ ] **Step 1: Create `video/src/lib/layout.ts`**

All timing, color, and dimension constants. Single source of truth so scene durations are trivially tunable.

```ts
// ── Dimensions ──────────────────────────────────────────────────────────────
export const WIDTH = 1920;
export const HEIGHT = 1080;
export const FPS = 30;

// ── Colors (from BRANDING.md — warm, not sterile) ──────────────────────────
export const BG = "#0a0a0a";
export const TEXT = "#f5f5f0";
export const TEXT_DIM = "rgba(245, 245, 240, 0.5)";

// ── Typography ──────────────────────────────────────────────────────────────
export const FONT_DISPLAY = "EB Garamond, Georgia, serif";
export const FONT_CAPTION = "Inter, system-ui, sans-serif";

// ── Screenshot presentation ─────────────────────────────────────────────────
export const SCREENSHOT_BORDER_RADIUS = 12;
export const SCREENSHOT_SHADOW = "0 25px 60px rgba(0,0,0,0.4)";
export const SCREENSHOT_BORDER = "1px solid rgba(255,255,255,0.08)";
export const SCREENSHOT_PERSPECTIVE = 1200;

// ── Scene durations (frames at 30fps) ───────────────────────────────────────
export const SCENES = {
    titleCard: 240, // 8s
    philosophy: 210, // 7s
    editor: 270, // 9s
    annotations: 270,
    revisionModal: 270,
    nestedRevision: 270,
    dictionary: 270,
    library: 270,
    closing: 210, // 7s
} as const;

// ── Transition timing ───────────────────────────────────────────────────────
export const FADE_FRAMES = 20; // frames for fade-in/fade-out between scenes

// TransitionSeries overlaps reduce total duration by FADE_FRAMES per transition.
// There are 8 transitions (between 9 scenes).
export const TOTAL_FRAMES =
    Object.values(SCENES).reduce((a, b) => a + b, 0) - FADE_FRAMES * 8;

// ── Screenshot entry choreography ───────────────────────────────────────────
export const ENTRY_HOLD = 10; // black hold before animation starts
export const ENTRY_DURATION = 30; // frames for the entrance animation
export const CAPTION_START = 40; // frame when caption begins typing
export const CAPTION_STAGGER = 3; // frames between each word
export const FADE_OUT_FRAMES = 20; // tail fade to black
```

- [ ] **Step 2: Create `video/src/lib/easing.ts`**

```ts
import { interpolate, spring } from "remotion";

// ── Spring config — slightly underdamped for subtle overshoot ──────────────
export const SPRING_CONFIG = {
    damping: 12,
    stiffness: 80,
    mass: 1.2,
};

// ── Dramatic spring config — more overshoot for title reveals ──────────────
export const SPRING_DRAMATIC = {
    damping: 10,
    stiffness: 60,
    mass: 1.5,
};

/**
 * Compute a spring value for the current frame, optionally delayed.
 */
export function springValue(
    frame: number,
    fps: number,
    config = SPRING_CONFIG,
    delay = 0,
): number {
    if (frame < delay) return 0;
    return spring({ fps, frame: frame - delay, config });
}

/**
 * Expo-out easing via interpolate: fast start, luxurious deceleration.
 * Maps frame range [startFrame, startFrame+duration] to [from, to].
 */
export function expoOut(
    frame: number,
    startFrame: number,
    duration: number,
    from: number,
    to: number,
): number {
    return interpolate(frame, [startFrame, startFrame + duration], [from, to], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing: (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
    });
}

/**
 * Slow fade-in: nothing pops, everything breathes.
 * Returns opacity 0→1 over [startFrame, startFrame+duration].
 */
export function fadeIn(frame: number, startFrame: number, duration: number): number {
    return interpolate(frame, [startFrame, startFrame + duration], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing: (t) => t * t * (3 - 2 * t), // smoothstep
    });
}

/**
 * Fade-out: returns opacity 1→0 over [startFrame, startFrame+duration].
 */
export function fadeOut(frame: number, startFrame: number, duration: number): number {
    return interpolate(frame, [startFrame, startFrame + duration], [1, 0], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing: (t) => t * t,
    });
}
```

- [ ] **Step 3: Commit**

```bash
git add video/src/lib/
git commit -m "add layout constants and easing utilities for video"
```

---

## Task 3: TypeReveal component

**Files:**
- Create: `video/src/components/TypeReveal.tsx`

- [ ] **Step 1: Create `video/src/components/TypeReveal.tsx`**

Word-by-word or line-by-line text reveal with staggered opacity. Used for captions and philosophy text.

```tsx
import { useCurrentFrame } from "remotion";
import { fadeIn } from "../lib/easing";

type TypeRevealProps = {
    text: string;
    mode: "word" | "line";
    startFrame: number;
    staggerFrames: number;
    style?: React.CSSProperties;
};

export const TypeReveal: React.FC<TypeRevealProps> = ({
    text,
    mode,
    startFrame,
    staggerFrames,
    style,
}) => {
    const frame = useCurrentFrame();
    const units = mode === "word" ? text.split(" ") : text.split("\n");

    return (
        <span style={{ display: mode === "line" ? "block" : "inline", ...style }}>
            {units.map((unit, i) => {
                const unitStart = startFrame + i * staggerFrames;
                const opacity = fadeIn(frame, unitStart, 8);
                const translateY = Math.max(0, 6 - 6 * opacity);
                return (
                    <span
                        key={i}
                        style={{
                            opacity,
                            display: mode === "line" ? "block" : "inline",
                            transform: `translateY(${translateY}px)`,
                            transition: "none",
                            marginBottom: mode === "line" ? 16 : 0,
                        }}
                    >
                        {unit}
                        {mode === "word" && i < units.length - 1 ? " " : ""}
                    </span>
                );
            })}
        </span>
    );
};
```

- [ ] **Step 2: Commit**

```bash
git add video/src/components/TypeReveal.tsx
git commit -m "add TypeReveal component for word/line text animation"
```

---

## Task 4: ScreenshotFrame component

**Files:**
- Create: `video/src/components/ScreenshotFrame.tsx`

- [ ] **Step 1: Create `video/src/components/ScreenshotFrame.tsx`**

Renders a screenshot image with the branded presentation: rounded corners, deep shadow, subtle border.

```tsx
import { Img, staticFile } from "remotion";
import {
    SCREENSHOT_BORDER_RADIUS,
    SCREENSHOT_SHADOW,
    SCREENSHOT_BORDER,
} from "../lib/layout";

type ScreenshotFrameProps = {
    src: string;
    style?: React.CSSProperties;
};

export const ScreenshotFrame: React.FC<ScreenshotFrameProps> = ({ src, style }) => (
    <div
        style={{
            borderRadius: SCREENSHOT_BORDER_RADIUS,
            overflow: "hidden",
            boxShadow: SCREENSHOT_SHADOW,
            border: SCREENSHOT_BORDER,
            lineHeight: 0,
            ...style,
        }}
    >
        <Img
            src={staticFile(`screenshots/${src}`)}
            style={{ width: "100%", height: "100%", objectFit: "contain" }}
        />
    </div>
);
```

- [ ] **Step 2: Commit**

```bash
git add video/src/components/ScreenshotFrame.tsx
git commit -m "add ScreenshotFrame component with branded presentation"
```

---

## Task 5: VideoPlaceholder component

**Files:**
- Create: `video/src/components/VideoPlaceholder.tsx`

- [ ] **Step 1: Create `video/src/components/VideoPlaceholder.tsx`**

Branded placeholder for scenes that will eventually use real video recordings. Shows a label describing what footage is needed, styled consistently with the video's dark aesthetic.

```tsx
import { AbsoluteFill } from "remotion";
import { BG, TEXT_DIM, FONT_CAPTION, SCREENSHOT_BORDER_RADIUS, SCREENSHOT_SHADOW } from "../lib/layout";

type VideoPlaceholderProps = {
    label: string;
    style?: React.CSSProperties;
};

export const VideoPlaceholder: React.FC<VideoPlaceholderProps> = ({ label, style }) => (
    <div
        style={{
            borderRadius: SCREENSHOT_BORDER_RADIUS,
            overflow: "hidden",
            boxShadow: SCREENSHOT_SHADOW,
            border: "1px dashed rgba(255,255,255,0.15)",
            width: "100%",
            height: "100%",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            backgroundColor: "#141414",
            ...style,
        }}
    >
        <div style={{ textAlign: "center", padding: 40 }}>
            <div
                style={{
                    color: TEXT_DIM,
                    fontFamily: FONT_CAPTION,
                    fontSize: 20,
                    fontWeight: 300,
                    letterSpacing: 2,
                    textTransform: "uppercase" as const,
                    marginBottom: 12,
                }}
            >
                Video Slot
            </div>
            <div
                style={{
                    color: TEXT_DIM,
                    fontFamily: FONT_CAPTION,
                    fontSize: 16,
                    fontWeight: 300,
                    maxWidth: 400,
                }}
            >
                {label}
            </div>
        </div>
    </div>
);
```

- [ ] **Step 2: Commit**

```bash
git add video/src/components/VideoPlaceholder.tsx
git commit -m "add VideoPlaceholder for future video recording slots"
```

---

## Task 6: TitleCard scene

**Files:**
- Create: `video/src/scenes/TitleCard.tsx`

- [ ] **Step 1: Create `video/src/scenes/TitleCard.tsx`**

Scene 1: Dark background. "Quillium" fades in with spring scale. "The Non-Linear Writing App" types in below.

```tsx
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { BG, TEXT, FONT_DISPLAY, FONT_CAPTION, FADE_OUT_FRAMES } from "../lib/layout";
import { springValue, SPRING_DRAMATIC, fadeOut } from "../lib/easing";
import { TypeReveal } from "../components/TypeReveal";

export const TitleCard: React.FC = () => {
    const frame = useCurrentFrame();
    const { fps, durationInFrames } = useVideoConfig();

    // Title: spring scale from 0.8→1 + opacity 0→1, delayed 15 frames
    const titleSpring = springValue(frame, fps, SPRING_DRAMATIC, 15);
    const titleScale = 0.8 + 0.2 * titleSpring;
    const titleOpacity = titleSpring;

    // Fade out at the end
    const outStart = durationInFrames - FADE_OUT_FRAMES;
    const globalOpacity = frame >= outStart ? fadeOut(frame, outStart, FADE_OUT_FRAMES) : 1;

    return (
        <AbsoluteFill
            style={{
                backgroundColor: BG,
                justifyContent: "center",
                alignItems: "center",
                opacity: globalOpacity,
            }}
        >
            <div style={{ textAlign: "center" }}>
                <div
                    style={{
                        fontFamily: FONT_DISPLAY,
                        fontSize: 96,
                        color: TEXT,
                        opacity: titleOpacity,
                        transform: `scale(${titleScale})`,
                        letterSpacing: 2,
                        marginBottom: 32,
                    }}
                >
                    Quillium
                </div>
                <TypeReveal
                    text="The Non-Linear Writing App"
                    mode="word"
                    startFrame={60}
                    staggerFrames={4}
                    style={{
                        fontFamily: FONT_CAPTION,
                        fontSize: 28,
                        color: TEXT,
                        fontWeight: 300,
                        letterSpacing: 4,
                    }}
                />
            </div>
        </AbsoluteFill>
    );
};
```

- [ ] **Step 2: Verify in Remotion Studio**

Temporarily update `Root.tsx` to use `TitleCard`:

```tsx
import { Composition } from "remotion";
import { TitleCard } from "./scenes/TitleCard";
import { WIDTH, HEIGHT, FPS, SCENES } from "./lib/layout";

export const Root: React.FC = () => (
    <Composition
        id="CinematicReveal"
        component={TitleCard}
        durationInFrames={SCENES.titleCard}
        width={WIDTH}
        height={HEIGHT}
        fps={FPS}
    />
);
```

```bash
cd video && bunx remotion studio
```

Expected: "Quillium" springs in with overshoot, then subtitle words appear one by one. Fades to black at end.

- [ ] **Step 3: Commit**

```bash
git add video/src/scenes/TitleCard.tsx
git commit -m "add TitleCard scene with spring title and word-by-word subtitle"
```

---

## Task 7: Philosophy scene

**Files:**
- Create: `video/src/scenes/Philosophy.tsx`

- [ ] **Step 1: Create `video/src/scenes/Philosophy.tsx`**

Scene 2: Dark bg. Three lines fade in one by one: "No AI ghostwriting. / No autocomplete. / Just a better place to write."

```tsx
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { BG, TEXT, FONT_DISPLAY, FADE_OUT_FRAMES } from "../lib/layout";
import { TypeReveal } from "../components/TypeReveal";
import { fadeOut } from "../lib/easing";

const LINES = "No AI ghostwriting.\nNo autocomplete.\nJust a better place to write.";

export const Philosophy: React.FC = () => {
    const frame = useCurrentFrame();
    const { durationInFrames } = useVideoConfig();

    const outStart = durationInFrames - FADE_OUT_FRAMES;
    const globalOpacity = frame >= outStart ? fadeOut(frame, outStart, FADE_OUT_FRAMES) : 1;

    return (
        <AbsoluteFill
            style={{
                backgroundColor: BG,
                justifyContent: "center",
                alignItems: "center",
                opacity: globalOpacity,
            }}
        >
            <TypeReveal
                text={LINES}
                mode="line"
                startFrame={20}
                staggerFrames={30}
                style={{
                    fontFamily: FONT_DISPLAY,
                    fontSize: 36,
                    color: TEXT,
                    fontWeight: 400,
                    textAlign: "center",
                    lineHeight: "1.8",
                }}
            />
        </AbsoluteFill>
    );
};
```

- [ ] **Step 2: Commit**

```bash
git add video/src/scenes/Philosophy.tsx
git commit -m "add Philosophy scene with line-by-line reveal"
```

---

## Task 8: ScreenshotReveal scene with all 6 entry variants

**Files:**
- Create: `video/src/scenes/ScreenshotReveal.tsx`

This is the workhorse scene. It handles all 6 screenshot scenes (editor, annotations, revision modal, nested revision, dictionary, library) via a `variant` prop that controls the entry animation.

- [ ] **Step 1: Create `video/src/scenes/ScreenshotReveal.tsx`**

```tsx
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import {
    BG,
    TEXT,
    FONT_CAPTION,
    SCREENSHOT_PERSPECTIVE,
    ENTRY_HOLD,
    ENTRY_DURATION,
    CAPTION_START,
    CAPTION_STAGGER,
    FADE_OUT_FRAMES,
} from "../lib/layout";
import { springValue, SPRING_CONFIG, fadeOut, expoOut } from "../lib/easing";
import { ScreenshotFrame } from "../components/ScreenshotFrame";
import { TypeReveal } from "../components/TypeReveal";

export type RevealVariant =
    | "float-up"
    | "slide-right"
    | "scale-center"
    | "parallax-layers"
    | "slide-left"
    | "pull-back";

type ScreenshotRevealProps = {
    screenshotSrc: string;
    caption: string;
    variant: RevealVariant;
};

/**
 * Compute the CSS transform for the screenshot based on variant and progress.
 * `progress` goes from 0 (start of entrance) to 1 (settled).
 */
function variantTransform(variant: RevealVariant, progress: number): React.CSSProperties {
    const p = progress;
    switch (variant) {
        case "float-up":
            return {
                transform: `perspective(${SCREENSHOT_PERSPECTIVE}px) translateY(${120 * (1 - p)}px) scale(${0.95 + 0.05 * p}) rotateX(${4 * (1 - p)}deg)`,
            };
        case "slide-right":
            return {
                transform: `translateX(${400 * (1 - p)}px)`,
                filter: `blur(${2 * (1 - p)}px)`,
            };
        case "scale-center":
            return {
                transform: `scale(${0.6 + 0.4 * p})`,
            };
        case "parallax-layers":
            return {
                transform: `translateX(${-60 * (1 - p)}px) scale(${0.95 + 0.05 * p})`,
            };
        case "slide-left":
            return {
                transform: `translateX(${-400 * (1 - p)}px)`,
                filter: `blur(${2 * (1 - p)}px)`,
            };
        case "pull-back":
            return {
                transform: `scale(${1.1 - 0.1 * p}) translateY(${-20 * (1 - p)}px)`,
            };
    }
}

export const ScreenshotReveal: React.FC<ScreenshotRevealProps> = ({
    screenshotSrc,
    caption,
    variant,
}) => {
    const frame = useCurrentFrame();
    const { fps, durationInFrames } = useVideoConfig();

    // Entrance: spring-driven progress from 0→1 starting after ENTRY_HOLD
    const progress = springValue(frame, fps, SPRING_CONFIG, ENTRY_HOLD);

    // Screenshot opacity: fade in during entry
    const screenshotOpacity = expoOut(frame, ENTRY_HOLD, ENTRY_DURATION, 0, 1);

    // Shadow intensifies as screenshot arrives
    const shadowOpacity = 0.4 * progress;
    const dynamicShadow = `0 25px 60px rgba(0,0,0,${shadowOpacity})`;

    // Fade out at the end
    const outStart = durationInFrames - FADE_OUT_FRAMES;
    const globalOpacity = frame >= outStart ? fadeOut(frame, outStart, FADE_OUT_FRAMES) : 1;

    const variantStyles = variantTransform(variant, progress);

    return (
        <AbsoluteFill
            style={{
                backgroundColor: BG,
                justifyContent: "center",
                alignItems: "center",
                flexDirection: "column",
                opacity: globalOpacity,
            }}
        >
            {/* Screenshot container — 75% of viewport width */}
            <div
                style={{
                    width: "75%",
                    maxWidth: 1440,
                    opacity: screenshotOpacity,
                    ...variantStyles,
                }}
            >
                <ScreenshotFrame
                    src={screenshotSrc}
                    style={{ boxShadow: dynamicShadow }}
                />
            </div>

            {/* Caption below screenshot */}
            <div style={{ marginTop: 48, textAlign: "center" }}>
                <TypeReveal
                    text={caption}
                    mode="word"
                    startFrame={CAPTION_START}
                    staggerFrames={CAPTION_STAGGER}
                    style={{
                        fontFamily: FONT_CAPTION,
                        fontSize: 30,
                        color: TEXT,
                        fontWeight: 300,
                        letterSpacing: 1,
                    }}
                />
            </div>
        </AbsoluteFill>
    );
};
```

- [ ] **Step 2: Commit**

```bash
git add video/src/scenes/ScreenshotReveal.tsx
git commit -m "add ScreenshotReveal scene with 6 entry variants"
```

---

## Task 9: Closing scene

**Files:**
- Create: `video/src/scenes/Closing.tsx`

- [ ] **Step 1: Create `video/src/scenes/Closing.tsx`**

Scene 9: Dark background. Logo/wordmark springs in. "Coming April 2nd" fades in below. The website URL fades in last.

```tsx
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { BG, TEXT, TEXT_DIM, FONT_DISPLAY, FONT_CAPTION, FADE_OUT_FRAMES } from "../lib/layout";
import { springValue, SPRING_DRAMATIC, fadeIn, fadeOut } from "../lib/easing";

export const Closing: React.FC = () => {
    const frame = useCurrentFrame();
    const { fps, durationInFrames } = useVideoConfig();

    // Logo: dramatic spring scale
    const logoSpring = springValue(frame, fps, SPRING_DRAMATIC, 15);
    const logoScale = 0.8 + 0.2 * logoSpring;

    // "Coming April 2nd" fades in after logo settles
    const dateOpacity = fadeIn(frame, 60, 20);
    const dateTranslateY = Math.max(0, 10 - 10 * dateOpacity);

    // Website URL fades in last
    const urlOpacity = fadeIn(frame, 90, 20);

    // Fade out at the end
    const outStart = durationInFrames - FADE_OUT_FRAMES;
    const globalOpacity = frame >= outStart ? fadeOut(frame, outStart, FADE_OUT_FRAMES) : 1;

    return (
        <AbsoluteFill
            style={{
                backgroundColor: BG,
                justifyContent: "center",
                alignItems: "center",
                opacity: globalOpacity,
            }}
        >
            <div style={{ textAlign: "center" }}>
                <div
                    style={{
                        fontFamily: FONT_DISPLAY,
                        fontSize: 84,
                        color: TEXT,
                        opacity: logoSpring,
                        transform: `scale(${logoScale})`,
                        letterSpacing: 2,
                        marginBottom: 32,
                    }}
                >
                    Quillium
                </div>
                <div
                    style={{
                        fontFamily: FONT_CAPTION,
                        fontSize: 28,
                        color: TEXT,
                        fontWeight: 300,
                        letterSpacing: 3,
                        opacity: dateOpacity,
                        transform: `translateY(${dateTranslateY}px)`,
                        marginBottom: 24,
                    }}
                >
                    Coming April 2nd
                </div>
                <div
                    style={{
                        fontFamily: FONT_CAPTION,
                        fontSize: 18,
                        color: TEXT_DIM,
                        fontWeight: 300,
                        letterSpacing: 2,
                        opacity: urlOpacity,
                    }}
                >
                    quillium.bryanhu.com
                </div>
            </div>
        </AbsoluteFill>
    );
};
```

- [ ] **Step 2: Commit**

```bash
git add video/src/scenes/Closing.tsx
git commit -m "add Closing scene with logo spring and launch date"
```

---

## Task 10: CinematicReveal composition — wire everything together

**Files:**
- Create: `video/src/compositions/CinematicReveal.tsx`
- Modify: `video/src/Root.tsx`

- [ ] **Step 1: Create `video/src/compositions/CinematicReveal.tsx`**

Uses `TransitionSeries` with fade transitions between all 9 scenes. Each scene gets its duration from the layout constants.

```tsx
import { AbsoluteFill } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { SCENES, FADE_FRAMES, BG } from "../lib/layout";
import { TitleCard } from "../scenes/TitleCard";
import { Philosophy } from "../scenes/Philosophy";
import { ScreenshotReveal } from "../scenes/ScreenshotReveal";
import { Closing } from "../scenes/Closing";

const FADE_TRANSITION = (
    <TransitionSeries.Transition
        timing={linearTiming({ durationInFrames: FADE_FRAMES })}
        presentation={fade()}
    />
);

export const CinematicReveal: React.FC = () => (
    <AbsoluteFill style={{ backgroundColor: BG }}>
        <TransitionSeries>
            {/* Scene 1: Title Card */}
            <TransitionSeries.Sequence durationInFrames={SCENES.titleCard}>
                <TitleCard />
            </TransitionSeries.Sequence>
            {FADE_TRANSITION}

            {/* Scene 2: Philosophy */}
            <TransitionSeries.Sequence durationInFrames={SCENES.philosophy}>
                <Philosophy />
            </TransitionSeries.Sequence>
            {FADE_TRANSITION}

            {/* Scene 3: Editor */}
            <TransitionSeries.Sequence durationInFrames={SCENES.editor}>
                <ScreenshotReveal
                    screenshotSrc="editor.png"
                    caption="A quiet place to think."
                    variant="float-up"
                />
            </TransitionSeries.Sequence>
            {FADE_TRANSITION}

            {/* Scene 4: Annotations */}
            <TransitionSeries.Sequence durationInFrames={SCENES.annotations}>
                <ScreenshotReveal
                    screenshotSrc="annotations.png"
                    caption="Comments and revisions live beside the text they're about."
                    variant="slide-right"
                />
            </TransitionSeries.Sequence>
            {FADE_TRANSITION}

            {/* Scene 5: Revision Modal */}
            <TransitionSeries.Sequence durationInFrames={SCENES.revisionModal}>
                <ScreenshotReveal
                    screenshotSrc="revision-modal.png"
                    caption="Fork any sentence. Keep every version."
                    variant="scale-center"
                />
            </TransitionSeries.Sequence>
            {FADE_TRANSITION}

            {/* Scene 6: Nested Revision */}
            <TransitionSeries.Sequence durationInFrames={SCENES.nestedRevision}>
                <ScreenshotReveal
                    screenshotSrc="nested-revision.png"
                    caption="Go deeper. Revise the revision."
                    variant="parallax-layers"
                />
            </TransitionSeries.Sequence>
            {FADE_TRANSITION}

            {/* Scene 7: Dictionary */}
            <TransitionSeries.Sequence durationInFrames={SCENES.dictionary}>
                <ScreenshotReveal
                    screenshotSrc="dictionary.png"
                    caption="Every word, considered."
                    variant="slide-left"
                />
            </TransitionSeries.Sequence>
            {FADE_TRANSITION}

            {/* Scene 8: Library */}
            <TransitionSeries.Sequence durationInFrames={SCENES.library}>
                <ScreenshotReveal
                    screenshotSrc="library.png"
                    caption="All your work. Always here."
                    variant="pull-back"
                />
            </TransitionSeries.Sequence>
            {FADE_TRANSITION}

            {/* Scene 9: Closing */}
            <TransitionSeries.Sequence durationInFrames={SCENES.closing}>
                <Closing />
            </TransitionSeries.Sequence>
        </TransitionSeries>
    </AbsoluteFill>
);
```

- [ ] **Step 2: Update `video/src/Root.tsx` to use the real composition**

Replace the entire file:

```tsx
import { Composition } from "remotion";
import { CinematicReveal } from "./compositions/CinematicReveal";
import { WIDTH, HEIGHT, FPS, TOTAL_FRAMES } from "./lib/layout";

export const Root: React.FC = () => (
    <Composition
        id="CinematicReveal"
        component={CinematicReveal}
        durationInFrames={TOTAL_FRAMES}
        width={WIDTH}
        height={HEIGHT}
        fps={FPS}
    />
);
```

- [ ] **Step 3: Verify the full composition in Remotion Studio**

```bash
cd video && bunx remotion studio
```

Expected: All 9 scenes play in sequence with fade transitions. Screenshot scenes will show broken images (no PNGs yet) — that's expected. Title, philosophy, and closing text scenes should render correctly.

- [ ] **Step 4: Commit**

```bash
git add video/src/compositions/CinematicReveal.tsx video/src/Root.tsx
git commit -m "wire CinematicReveal composition with all 9 scenes and fade transitions"
```

---

## Task 11: Playwright screenshot capture script

**Files:**
- Create: `video/scripts/capture.ts`

This script reuses the patterns from the existing `scripts/screenshots.ts` — same Tauri mock approach, same debug scenarios — but captures at the video viewport (1920x1080 @ 2x) and writes to `video/public/screenshots/`.

- [ ] **Step 1: Create `video/scripts/capture.ts`**

```ts
/**
 * video/scripts/capture.ts — Capture screenshots for the launch video.
 *
 * Reuses the Tauri mock and debug scenario patterns from scripts/screenshots.ts.
 * Captures at 1920x1080 @2x and writes PNGs to video/public/screenshots/.
 *
 * Usage:
 *   cd video && bun run capture              # auto-start dev server
 *   cd video && bun run capture --no-server  # use existing server
 */

import { chromium, type BrowserContext, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";

// ── Config ──────────────────────────────────────────────────────────────────

const noServer = process.argv.includes("--no-server");
const BASE_URL = noServer ? "http://localhost:1420" : "http://localhost:4173";
const OUT_DIR = "public/screenshots";
const VIEWPORT = { width: 1920, height: 1080 };
const DEVICE_SCALE_FACTOR = 2;

// ── Content ─────────────────────────────────────────────────────────────────

const PROSE_SHORT =
    "It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness, it was the epoch of belief, it was the epoch of incredulity.";

// ── Library mock data ───────────────────────────────────────────────────────

const LIBRARY_DOCUMENTS = [
    {
        id: "doc-1",
        title: "The Lighthouse Keeper",
        createdAt: Date.now() - 1000 * 60 * 60 * 24 * 5,
        updatedAt: Date.now() - 1000 * 60 * 30,
        wordCount: 312,
        previewText:
            "The old lighthouse keeper had watched storms roll in from the sea for forty years. Each one was different — some crept in slowly, giving him hours to prepare...",
        tags: '["fiction","short story"]',
        deletedAt: null,
    },
    {
        id: "doc-2",
        title: "On the Question of Forgetting",
        createdAt: Date.now() - 1000 * 60 * 60 * 24 * 12,
        updatedAt: Date.now() - 1000 * 60 * 60 * 2,
        wordCount: 580,
        previewText:
            "There is a particular cruelty in the way memory works: it keeps what we would most like to lose and loses what we most want to keep...",
        tags: '["essay","nonfiction"]',
        deletedAt: null,
    },
    {
        id: "doc-3",
        title: "Inventory",
        createdAt: Date.now() - 1000 * 60 * 60 * 24 * 20,
        updatedAt: Date.now() - 1000 * 60 * 60 * 24 * 1,
        wordCount: 204,
        previewText:
            "Marcus kept a list of everything he had ever lost. It began, as these things often do, as a joke...",
        tags: '["fiction"]',
        deletedAt: null,
    },
    {
        id: "doc-4",
        title: "Elena in Krakow",
        createdAt: Date.now() - 1000 * 60 * 60 * 24 * 30,
        updatedAt: Date.now() - 1000 * 60 * 60 * 24 * 3,
        wordCount: 421,
        previewText:
            "The morning Elena arrived in Krakow, the city was doing what it did best: pretending nothing had changed...",
        tags: '["fiction","novel"]',
        deletedAt: null,
    },
];

// ── Tauri mock ──────────────────────────────────────────────────────────────

type TauriMockOptions = {
    loadResponse: string | null;
    fakeApiKey: boolean;
    libraryMode: boolean;
};

async function installTauriMock(
    page: Page,
    options: Partial<TauriMockOptions> = {},
): Promise<void> {
    const loadResponse = options.loadResponse ?? null;
    const fakeApiKey = options.fakeApiKey ?? false;
    const libraryMode = options.libraryMode ?? false;

    await page.addInitScript(
        (payload: {
            loadResponse: string | null;
            fakeApiKey: boolean;
            libraryMode: boolean;
            libraryDocs: typeof LIBRARY_DOCUMENTS;
        }) => {
            localStorage.setItem("quillium_tutorial_seen", "1");
            if (payload.fakeApiKey) {
                localStorage.setItem("quillium-has-api-key", "1");
            }
            // Hide debug button
            document.addEventListener("DOMContentLoaded", () => {
                const style = document.createElement("style");
                style.textContent =
                    "[aria-label='Open debug panel'] { display: none !important; }";
                document.head.appendChild(style);
            });
            // Consistent font
            localStorage.setItem(
                "quillium-app-settings",
                JSON.stringify({ docFontFamily: "Georgia, serif", docFontSize: 18 }),
            );

            let nextCallbackId = 1;
            const callbacks = new Map<number, (...args: unknown[]) => unknown>();
            let savedState: string | null = payload.loadResponse;

            (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
                invoke: async (cmd: string, args: unknown) => {
                    if (cmd === "load") return savedState;
                    if (cmd === "save") {
                        savedState = (args as { state: string }).state;
                        return true;
                    }
                    if (cmd === "get_api_key") return payload.fakeApiKey ? "sk-demo-key" : null;
                    if (cmd === "set_api_key") return null;
                    if (cmd === "plugin:event|listen") return 1;
                    if (cmd === "plugin:event|unlisten") return null;
                    if (cmd === "cmd_migrate_from_state_json")
                        return { migrated: false, documentId: null };
                    if (cmd === "cmd_list_documents")
                        return payload.libraryMode ? payload.libraryDocs : [];
                    if (cmd === "cmd_list_trashed_documents") return [];
                    if (cmd === "cmd_get_trash_retention") return 30;
                    if (cmd === "cmd_set_trash_retention") return null;
                    if (cmd === "cmd_purge_expired_trash") return 0;
                    if (cmd === "cmd_get_document") {
                        const id = (args as { id: string }).id;
                        return payload.libraryDocs.find((d) => d.id === id) ?? null;
                    }
                    if (cmd === "cmd_create_document") return "doc-new";
                    if (cmd === "cmd_update_document_meta") return null;
                    if (cmd === "cmd_trash_document") return null;
                    if (cmd === "cmd_restore_document") return null;
                    if (cmd === "cmd_delete_document") return null;
                    if (cmd === "cmd_reset_db") {
                        savedState = null;
                        return null;
                    }
                    if (cmd === "cmd_list_drafts") return [];
                    if (cmd === "cmd_create_draft") return "draft-1";
                    if (cmd === "cmd_append_event")
                        return { eventId: Math.floor(Math.random() * 100000) };
                    if (cmd === "cmd_create_snapshot") {
                        savedState = (args as { stateJson: string }).stateJson;
                        return null;
                    }
                    if (cmd === "cmd_load_document_state")
                        return { snapshotStateJson: savedState, eventsSince: [] };
                    return null;
                },
                transformCallback: (callback: (...args: unknown[]) => unknown) => {
                    const id = nextCallbackId;
                    nextCallbackId += 1;
                    callbacks.set(id, callback);
                    return id;
                },
                unregisterCallback: (id: number) => {
                    callbacks.delete(id);
                },
                convertFileSrc: (filePath: string) => filePath,
            };

            (window as unknown as Record<string, unknown>).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
                unregisterListener: () => {},
            };
        },
        { loadResponse, fakeApiKey, libraryMode, libraryDocs: LIBRARY_DOCUMENTS },
    );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function waitForEditor(page: Page): Promise<void> {
    await page.locator("#editor-document").waitFor({ state: "attached", timeout: 15_000 });
    await page
        .locator("#editor-document .cm-editor")
        .waitFor({ state: "visible", timeout: 15_000 });
    await page.waitForTimeout(200);
}

async function setEditorText(page: Page, text: string): Promise<void> {
    const editor = page.locator("#editor-document .cm-content");
    await editor.click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.evaluate((t: string) => {
        const dt = new DataTransfer();
        dt.setData("text/plain", t);
        document.activeElement?.dispatchEvent(
            new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }),
        );
    }, text);
    await page.waitForTimeout(300);
}

async function applyDebugScenario(page: Page, scenarioId: string): Promise<boolean> {
    const ok = await page.evaluate(async (id: string) => {
        const fn = (window as unknown as Record<string, unknown>).__runScenario__;
        if (typeof fn !== "function") return false;
        return (fn as (id: string) => Promise<boolean>)(id);
    }, scenarioId);
    if (ok) await page.waitForTimeout(1200);
    return ok;
}

async function activateAnnotation(page: Page, targetText: string): Promise<void> {
    await page.evaluate((target: string) => {
        const editorViewStore = (window as unknown as Record<string, unknown>).__editorView__ as
            | { subscribe(fn: (v: unknown) => void): () => void }
            | undefined;
        if (!editorViewStore) return;
        let view: unknown;
        const unsub = editorViewStore.subscribe((v) => {
            view = v;
        });
        unsub();
        if (!view) return;
        const v = view as {
            state: { doc: { toString(): string } };
            dispatch(tr: object): void;
            focus(): void;
        };
        const pos = v.state.doc.toString().indexOf(target);
        if (pos === -1) return;
        v.focus();
        v.dispatch({ selection: { anchor: pos + Math.floor(target.length / 2) } });
    }, targetText);
    await page.waitForTimeout(400);
}

async function shot(page: Page, name: string): Promise<void> {
    const filePath = `${OUT_DIR}/${name}.png`;
    const bytes = await page.screenshot({ fullPage: false });
    await writeFile(filePath, bytes);
    console.log(`  >> ${filePath}`);
}

// ── Server lifecycle ────────────────────────────────────────────────────────

async function startServer(): Promise<ChildProcess> {
    console.log("Starting dev server...");
    const server = spawn(
        "bun",
        ["run", "dev", "--", "--host", "localhost", "--port", "4173", "--strictPort"],
        { stdio: ["ignore", "pipe", "pipe"], cwd: ".." },
    );
    server.stdout?.on("data", (chunk: Buffer) => process.stdout.write(`[server] ${chunk}`));
    server.stderr?.on("data", (chunk: Buffer) => process.stderr.write(`[server] ${chunk}`));
    await pollUntilReady(BASE_URL);
    console.log("Server ready.");
    return server;
}

async function pollUntilReady(url: string, timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const res = await fetch(url);
            if (res.ok || res.status === 304) return;
        } catch {
            /* not ready yet */
        }
        await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error(`Server at ${url} did not become ready within ${timeoutMs}ms`);
}

// ── Scenarios ───────────────────────────────────────────────────────────────

async function captureEditor(ctx: BrowserContext): Promise<void> {
    const page = await ctx.newPage();
    await page.setViewportSize(VIEWPORT);
    await installTauriMock(page);
    await page.goto(BASE_URL);
    await waitForEditor(page);
    await setEditorText(page, PROSE_SHORT);
    await page.mouse.click(960, 800);
    await page.waitForTimeout(200);
    await shot(page, "editor");
    await page.close();
}

async function captureAnnotations(ctx: BrowserContext): Promise<void> {
    const page = await ctx.newPage();
    await page.setViewportSize(VIEWPORT);
    await installTauriMock(page);
    await page.goto(BASE_URL);
    await waitForEditor(page);
    // Use the no-ai scenario to exclude AI suggestion card
    const applied = await applyDebugScenario(page, "screenshot-annotations-no-ai");
    if (!applied) await setEditorText(page, PROSE_SHORT);
    await page.mouse.click(960, 800);
    await page.waitForTimeout(400);
    await shot(page, "annotations");
    await page.close();
}

async function captureRevisionModal(ctx: BrowserContext): Promise<void> {
    const page = await ctx.newPage();
    await page.setViewportSize(VIEWPORT);
    await installTauriMock(page);
    await page.goto(BASE_URL);
    await waitForEditor(page);
    const applied = await applyDebugScenario(page, "screenshot-revision-active");
    if (!applied) {
        await setEditorText(page, PROSE_SHORT);
        await shot(page, "revision-modal");
        await page.close();
        return;
    }
    await activateAnnotation(page, "Spiritual revelations were conceded");
    await page.waitForTimeout(400);
    // Push revision to modal via DEV bridge
    await page.evaluate(() => {
        const w = window as unknown as Record<string, unknown>;
        const stack = w.__modalStack__ as { push(entry: object): void } | undefined;
        const editorViewStore = w.__editorView__ as
            | { subscribe(fn: (v: unknown) => void): () => void }
            | undefined;
        if (!stack || !editorViewStore) return;
        let view: unknown;
        const unsub = editorViewStore.subscribe((v) => {
            view = v;
        });
        unsub();
        if (!view) return;
        const revCard = document.querySelector("[data-tutorial-role='revision-card']");
        const revisionIdStr = revCard?.getAttribute("data-revision-id");
        if (!revisionIdStr) return;
        const revisionId = Number.parseInt(revisionIdStr, 10);
        if (Number.isNaN(revisionId)) return;
        stack.push({ type: "revision", revisionId, parentView: view, label: "Revision" });
    });
    await page.waitForTimeout(600);
    await shot(page, "revision-modal");
    await page.close();
}

async function captureNestedRevision(ctx: BrowserContext): Promise<void> {
    const page = await ctx.newPage();
    await page.setViewportSize(VIEWPORT);
    await installTauriMock(page);
    await page.goto(BASE_URL);
    await waitForEditor(page);
    const applied = await applyDebugScenario(page, "screenshot-nested-revision");
    if (!applied) {
        await page.close();
        return;
    }
    await activateAnnotation(page, "running his fingers along the brass gears");
    await page.waitForTimeout(400);
    // Push outer revision modal with pending nested revision
    await page.evaluate(() => {
        const w = window as unknown as Record<string, unknown>;
        const stack = w.__modalStack__ as { push(entry: object): void } | undefined;
        const editorViewStore = w.__editorView__ as
            | { subscribe(fn: (v: unknown) => void): () => void }
            | undefined;
        if (!stack || !editorViewStore) return;
        let view: unknown;
        const unsub = editorViewStore.subscribe((v) => {
            view = v;
        });
        unsub();
        if (!view) return;
        const revCard = document.querySelector("[data-tutorial-role='revision-card']");
        const revisionIdStr = revCard?.getAttribute("data-revision-id");
        if (!revisionIdStr) return;
        const revisionId = Number.parseInt(revisionIdStr, 10);
        if (Number.isNaN(revisionId)) return;
        const versionText =
            "running his fingers along the brass gears, feeling each tooth engage with the precision of something built to outlast its maker — the way a pianist runs scales before the hall fills";
        const innerTarget = "the way a pianist runs scales before the hall fills";
        const from = versionText.indexOf(innerTarget);
        const to = from + innerTarget.length;
        stack.push({
            type: "revision",
            revisionId,
            parentView: view,
            label: "Extended",
            pendingNestedCommand: { type: "revision", selectionFrom: from, selectionTo: to },
        });
    });
    await page.waitForTimeout(800);
    // Push inner nested revision modal
    await page.evaluate(() => {
        const w = window as unknown as Record<string, unknown>;
        const stack = w.__modalStack__ as { push(entry: object): void } | undefined;
        const modalEditors = w.__modalEditors__ as Record<number, unknown> | undefined;
        if (!stack || !modalEditors) return;
        const nestedView = modalEditors[0];
        if (!nestedView) return;
        const revCards = document.querySelectorAll("[data-tutorial-role='revision-card']");
        const innerCard = revCards[revCards.length - 1];
        if (!innerCard) return;
        const revisionIdStr = innerCard.getAttribute("data-revision-id");
        if (!revisionIdStr) return;
        const revisionId = Number.parseInt(revisionIdStr, 10);
        if (Number.isNaN(revisionId)) return;
        stack.push({
            type: "revision",
            revisionId,
            parentView: nestedView,
            label: "Pianist image",
        });
    });
    await page.waitForTimeout(600);
    await shot(page, "nested-revision");
    await page.close();
}

async function captureDictionary(ctx: BrowserContext): Promise<void> {
    const page = await ctx.newPage();
    await page.setViewportSize(VIEWPORT);
    await installTauriMock(page);
    await page.goto(BASE_URL);
    await waitForEditor(page);
    await setEditorText(page, PROSE_SHORT);
    // Select "wisdom"
    await page.evaluate(() => {
        const w = window as unknown as Record<string, unknown>;
        const editorViewStore = w.__editorView__ as
            | { subscribe(fn: (v: unknown) => void): () => void }
            | undefined;
        if (!editorViewStore) return;
        let view: unknown;
        const unsub = editorViewStore.subscribe((v) => {
            view = v;
        });
        unsub();
        if (!view) return;
        const v = view as {
            state: { doc: { toString(): string } };
            dispatch(tr: object): void;
            focus(): void;
        };
        const doc = v.state.doc.toString();
        const target = "wisdom";
        const from = doc.indexOf(target);
        if (from === -1) return;
        v.focus();
        v.dispatch({ selection: { anchor: from, head: from + target.length } });
    });
    await page.waitForTimeout(300);
    const shortcut = process.platform === "darwin" ? "Meta+B" : "Control+B";
    await page.keyboard.press(shortcut);
    await page.waitForTimeout(500);
    await shot(page, "dictionary");
    await page.close();
}

async function captureLibrary(ctx: BrowserContext): Promise<void> {
    const page = await ctx.newPage();
    await page.setViewportSize(VIEWPORT);
    await installTauriMock(page, { libraryMode: true });
    await page.goto(`${BASE_URL}/library`);
    await page.locator("h1").filter({ hasText: "Your Library" }).waitFor({ timeout: 10_000 });
    await page.waitForTimeout(800);
    const cards = page.locator('[role="button"]').filter({ hasText: /words/ });
    const count = await cards.count();
    if (count > 1) {
        await cards.nth(1).click();
        await page.waitForTimeout(300);
    }
    await shot(page, "library");
    await page.close();
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    await mkdir(OUT_DIR, { recursive: true });

    let server: ChildProcess | null = null;

    if (!noServer) {
        let serverAlreadyRunning = false;
        try {
            const res = await fetch(BASE_URL);
            if (res.ok || res.status === 304) {
                const devCheck = await fetch(`${BASE_URL}/@vite/client`).catch(() => null);
                if (!devCheck || !devCheck.ok) {
                    throw new Error(
                        `Server at ${BASE_URL} is not a Vite dev server. Stop it and re-run.`,
                    );
                }
                serverAlreadyRunning = true;
                console.log(`Using existing dev server at ${BASE_URL}`);
            }
        } catch (e) {
            if (e instanceof Error && e.message.includes("not a Vite dev server")) throw e;
        }
        if (!serverAlreadyRunning) server = await startServer();
    } else {
        const res = await fetch(BASE_URL).catch(() => null);
        if (!res || !res.ok) {
            throw new Error(`--no-server set but no server reachable at ${BASE_URL}`);
        }
        console.log(`Using existing server at ${BASE_URL}`);
    }

    const browser = await chromium.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    const context = await browser.newContext({ deviceScaleFactor: DEVICE_SCALE_FACTOR });

    try {
        console.log("\nCapturing video screenshots...\n");
        await captureEditor(context);
        await captureAnnotations(context);
        await captureRevisionModal(context);
        await captureNestedRevision(context);
        await captureDictionary(context);
        await captureLibrary(context);
        console.log("\nDone. Screenshots saved to ./" + OUT_DIR + "/");
    } finally {
        await context.close();
        await browser.close();
        if (server) server.kill();
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
```

- [ ] **Step 2: Add `video/public/screenshots/` to `.gitignore`**

Append to the root `.gitignore`:

```
video/public/screenshots/*.png
video/out/
video/node_modules/
```

- [ ] **Step 3: Run the capture script**

```bash
cd video && bun run capture
```

Expected: 6 PNGs written to `video/public/screenshots/`: `editor.png`, `annotations.png`, `revision-modal.png`, `nested-revision.png`, `dictionary.png`, `library.png`.

- [ ] **Step 4: Commit**

```bash
git add video/scripts/capture.ts .gitignore
git commit -m "add Playwright capture script for video screenshots"
```

---

## Task 12: Preview full video and render

- [ ] **Step 1: Open Remotion Studio and preview the full composition**

```bash
cd video && bunx remotion studio
```

Expected: All 9 scenes play in sequence. Screenshots are crisp. Transitions fade smoothly. Text animations feel dramatic and cinematic.

- [ ] **Step 2: Render the video**

```bash
cd video && bunx remotion render CinematicReveal out/quillium-launch.mp4
```

Expected: MP4 file at `video/out/quillium-launch.mp4`, 1920x1080, 30fps.

- [ ] **Step 3: Render a half-resolution preview for quick sharing**

```bash
cd video && bunx remotion render CinematicReveal out/preview.mp4 --scale=0.5
```

- [ ] **Step 4: Commit**

```bash
git add video/
git commit -m "complete cinematic launch video pipeline"
```

---

## Video Footage Needed (Placeholder Slots)

The current implementation uses static screenshots for all 6 feature scenes. Here is the footage you'll want to record and swap in later:

| Scene | What to Record | Why |
|-------|---------------|-----|
| Editor (3) | Screen recording of someone typing prose in Quillium — a few sentences flowing onto the page | Shows the writing experience is responsive and tactile |
| Annotations (4) | Recording of creating a comment: select text, click comment, type a note, see the card appear | Shows the annotation workflow in action |
| Revision Modal (5) | Recording of creating a revision: select text, create revision, see the modal open with version pills | Shows the core non-linear editing feature |
| Nested Revision (6) | Recording inside a revision modal, creating a sub-revision — the "inception" moment | Shows the unique depth of the editing system |
| Dictionary (7) | Recording of selecting a word, pressing Cmd+B, seeing the dictionary popover appear | Shows the built-in reference tool |
| Library (8) | Recording of navigating between documents in the library grid, opening one | Shows multi-document management |

To swap in a video recording, replace `ScreenshotFrame` with Remotion's `<Video>` component in the relevant `ScreenshotReveal` scene. The `VideoPlaceholder` component is available if you want to mark slots as "needs footage" in the rendered output.
