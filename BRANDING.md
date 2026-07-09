# Quillium Brand Bible

> A single reference for what Quillium is, how it looks, how it speaks, and
> why — so every decision made on the product stays true to the vision.

---

## 1. The Product

### What It Is

Quillium is a desktop writing application for long-form creative work. Built
on Tauri with a SvelteKit frontend, it combines a distraction-free editor with
AI-powered writing assistance, a structured annotation system, and non-linear
editing tools.

### Who It's For

Fiction and nonfiction writers doing sustained, serious creative work — novels,
essays, memoirs, personal projects. Not students taking notes. Not teams
managing tasks. Not productivity hackers. The writer who opens Quillium wants
one thing: to get into flow and stay there.

### The Core Promise

**A quiet, trusted companion.** Present when needed, invisible when not.
Quillium earns attention rather than demanding it.

### What Makes It Different

| Dimension | Quillium | Generic Editors |
|-----------|----------|-----------------|
| AI | Contextual writing partner | Feature checkbox |
| Annotations | Inline revision + comment system | Comments only |
| Aesthetic | Warm, tactile, notebook-like | Functional, sterile |
| Focus | Writing as the primary act | Everything equal |
| Feel | Bear, Craft, iA Writer | Notion, Google Docs |

---

## 2. Brand Personality

### The Core Three

**Warm. Creative. Focused.**

These aren't adjectives on a slide — they're constraints. Every design
decision, copy choice, and interaction should be legible through at least one
of these lenses. If something is cold, clinical, scattered, or demanding, it
doesn't belong here.

### Voice Qualities

| Quality | Sounds Like | Never Sounds Like |
|---------|-------------|-------------------|
| Warm | A trusted editor giving honest notes | A chatbot reading from a script |
| Creative | Someone who loves language | Marketing copy |
| Focused | Calm and direct | Jargon-heavy or over-explained |
| Confident | Clear, no hedging | Arrogant or dismissive |
| Understated | Doesn't compete with the writer | Showy or performative |

### Brand Metaphor

**A well-made notebook.** Tactile, personal, durable. It has a satisfying
heft. You trust it with your best ideas. It doesn't interrupt you. It has
personality — but quietly. When you're done writing for the day, you close it
and it waits.

---

## 3. Visual Identity

### 3.1 Color System

#### Background & Surface

The application runs on warm gray, not pure white. Warmth is structural — it
is not an accent, it's the foundation.

| Token | Value | Usage |
|-------|-------|-------|
| App background | `#e5e7eb` (gray-200) | Page canvas behind the editor |
| Document surface | `#ffffff` | The editor document card |
| Panel surface | `bg-gray-300/70` | AI sidebar, status bar (glass) |
| Glass border | `border-white/30` | All glassmorphic panels |

#### Primary — Blue

Used for interactive elements, primary actions, and the Chat AI mode.
Blue = conversation, connection, action.

| Token | Value | Usage |
|-------|-------|-------|
| `primary` | `blue-500` | Default interactive |
| `primary-hover` | `blue-600` | Hover state |
| `primary-active` | `text-blue-600 bg-white/60` | Active tab in AI panel |
| `primary-hover-text` | `hover:text-blue-600` | Hover on collapsed icons |

#### Feedback / AI Green

Used for the Feedback AI mode and suggestion highlights. Green = growth,
validation, constructive input.

| Token | Value | Usage |
|-------|-------|-------|
| `feedback` | `green-500` | Active feedback icon |
| `feedback-bg` | `green-50` | Feedback context backgrounds |
| `suggestion-inactive` | `#f0fdf4` | Suggestion highlight (not selected) |
| `suggestion-active` | `#dbf9e2` | Suggestion highlight (selected) |

#### Revision / AI Purple

Used for the Revise mode. Purple = transformation, craft, editing intent.

| Token | Value | Usage |
|-------|-------|-------|
| `revise` | `purple-500` | Active revise icon |
| `revise-bg` | `purple-50` | Revision context backgrounds |

#### Comment / Annotation Yellow

Used for comment annotations — the one color that maps to a human action
(not an AI mode).

| Token | Value | Usage |
|-------|-------|-------|
| `comment-inactive` | `#fef2cd` | Comment highlight (not selected) |
| `comment-active` | `#fcbc05` | Comment highlight (selected) |

#### Document Context — Amber

Used for the Document Context AI mode. Amber = orientation, map, reference.

| Token | Value | Usage |
|-------|-------|-------|
| `context-active` | `text-amber-600 bg-white/60` | Active context tab |
| `context-hover` | `hover:text-amber-600` | Hover on collapsed icon |

#### AI Processing State

When the AI is actively generating, the sidebar receives a rainbow glow
animation cycling through indigo → purple → pink → orange. This is the only
place where vibrant color appears in motion. It signals active work without
being alarming.

#### Color Rules

1. **One color per action type.** Blue = chat, green = feedback, purple =
   revise, yellow = comment, amber = context. Never mix these associations.
2. **Accents are desaturated.** No neon. No harsh primary RGB values. All
   accents should feel like they belong in a warm, lit room.
3. **Text on glass uses opacity, not color.** UI labels use `text-black/90`,
   `text-black/50`, `text-black/30` — never hard black or gray values.
4. **Color is not the only signal.** Every state (active, hover, disabled)
   must be perceptible without color alone (WCAG AA minimum).

---

### 3.2 Typography

#### Editor Body Text

The writing surface deserves the best reading experience. Text in the editor
is sized for sustained reading, not scanning.

| Property | Value |
|----------|-------|
| Font stack | `Georgia, serif` (default; user-configurable in settings from a curated list including Inter, Lora, EB Garamond, iA Writer Quattro, Courier Prime, and others) |
| Size | `18px` (default; user-configurable) |
| Text indent | `2em` (paragraph indent, no block margin) |
| Line treatment | CodeMirror default (generous) |

#### UI Chrome Text

Panels, labels, and controls use smaller type — but never at the cost of
legibility.

| Context | Size | Weight | Color |
|---------|------|--------|-------|
| Panel title | `text-xs` | `font-semibold` | `text-black/50` |
| Status bar stats | `text-sm` | regular | `text-black/90` |
| Status bar sub-label | `text-[10px]` | regular | `text-black/50` |
| Icon button labels | `text-xs` | `font-semibold` | contextual |

#### Typography Rules

1. **The editor font is sacred.** Do not resize, restyle, or override editor
   body type except for explicit formatting features (headings, etc.).
2. **UI type stays small.** Chrome should not compete with content. Use
   `text-xs` and `text-sm` for all UI labels.
3. **No decorative fonts in chrome.** UI chrome uses the system font stack.
   The editor body font is user-configurable from a curated list of reading
   fonts (Georgia, Lora, EB Garamond, Inter, iA Writer Quattro, etc.).

---

### 3.3 Spacing & Layout

#### Document

| Property | Value |
|----------|-------|
| Document width | `816px` (fixed, centered) |
| Document padding | `py-3 px-1` |
| Document margin-top | `mt-12` |
| Document shadow | `shadow-xl` |
| Document radius | `rounded-lg` |

The document card is the product. It should have presence — `shadow-xl`
separates it from the background and establishes it as the primary surface.

#### Panels & Sidebars

| Property | Value |
|----------|-------|
| Standard panel padding | `p-4` |
| Panel radius (collapsed) | Half the collapsed dimension (`26px` for `52px`) |
| Panel radius (expanded) | `rounded-[14px]` |
| Panel shadow | `shadow-lg` |
| Panel background | `bg-gray-300/70 backdrop-blur-md` |

#### Spacing Rules

1. **Breathable layouts.** Panels should never feel cramped. White space is
   intentional — it signals that writing is the priority.
2. **Consistent padding.** `p-4` is the standard panel unit. Deviate only
   when context clearly demands it (e.g., tight icon strips).
3. **No gutters on the document.** The 816px document has side padding through
   CodeMirror content padding, not outer margin compression.

---

### 3.4 Depth & Elevation

Quillium uses a three-layer depth model. Nothing lives on the same Z-plane.

| Layer | What Lives Here | Shadow |
|-------|-----------------|--------|
| Background | App canvas (`gray-200`) | — |
| Panels | AI sidebar, status bar, annotation cards | `shadow-lg` |
| Document | Editor document card | `shadow-xl` |
| Modals / Overlays | Tutorial, save menu | `shadow-xl` + `backdrop-blur` |

#### Glassmorphism

Glass is used selectively — status bar and AI sidebar in their standard state.
Not on the editor document. Not on annotation cards. Glass creates lightness
and modernity, but overused it becomes noise.

Glass recipe: `backdrop-blur-md bg-gray-300/70 border border-white/30`

---

### 3.5 Motion & Interaction

#### Transition Defaults

| Property | Value |
|----------|-------|
| Standard duration | `300ms` |
| Easing | `transition-colors` (Tailwind default) |
| Panel expand/collapse | `340ms cubic-bezier(0.33, 0, 0.2, 1)` |
| Annotation position | `300ms cubic-bezier(0.25, 0.46, 0.45, 0.94)` |
| Icon opacity/scale | `200ms` |

#### Motion Rules

1. **Calm and unhurried.** No snap transitions. No instant state swaps.
   Most change should have a moment of movement, but only if the state change is big (e.g. expanding menus). Otherwise, motion distracts.
2. **No gratuitous animation.** Motion exists to orient the user — not to
   entertain them.
3. **Respect `prefers-reduced-motion`.** All transitions and the AI processing
   animation must be suppressed when the OS preference is set.
4. **Disable during drag.** When the user is actively resizing a panel,
   remove transition classes to prevent lag.

---

### 3.6 Component Patterns

#### Glassmorphic Pill (AI Sidebar — Collapsed)

The resting state of the AI sidebar. A vertical pill floating on the left edge
of the screen. Icons only, no labels. Expands on click.

```
Pill:
  width: 52px
  height: 240px
  radius: 100px
  bg: gray-300/70, backdrop-blur-md
  border: white/30
  shadow: lg
```

#### Expanded Panel

The AI sidebar opens into a rounded panel with an icon strip, a title row, and
a content area. The panel is resizable via drag handles.

```
Panel:
  default: 320 × 520px
  min: 240 × 400px
  max: 600 × 800px
  radius: 14px
```

#### Annotation Card

Floating cards pinned to the right of the document, aligned to their source
text. They stack vertically with minimum 8px spacing. Active card elevates
to z-index 100.

```
Card:
  width: 240px
  position: absolute, computed from text coords
  transition: top 300ms cubic-bezier(...)
```

#### Glassmorphic Status Bar

Centered, floating at the top of the scroll container. Shows word count,
character count, save state, and secondary controls.

```
Status bar:
  width: fit-content
  height: auto
  radius: full (pill)
  bg: gray-300/70, backdrop-blur-md
  border: white/30
  padding: py-4 px-8
```

#### Icon Buttons

| State | Treatment |
|-------|-----------|
| Default | `text-black/50`, no background |
| Hover | Color accent (`hover:text-blue-600` etc.) |
| Active | Color accent + `bg-white/60` |
| Disabled | `text-black/30`, no interaction |

Radius is always `rounded-full`. Size is `p-2` standard, `p-1.5` for tight
control rows.

---

## 4. UX Principles

### 1. The Writing Comes First

The editor is the product. The AI sidebar, annotation panel, and status bar
are scaffolding — supporting roles. UI chrome should retreat to the periphery.
When in doubt, make it smaller, quieter, or less prominent.

### 2. Warmth Over Sterility

Prefer soft backgrounds, gentle shadows, and slightly warm tones. Avoid
clinical grays and pure-white flatness. The goal is a workspace a writer would
be proud to spend hours in — not an interface that feels like a hospital form.

### 3. Calm Interactions

Nothing should be jarring. State changes have motion. Panels expand smoothly.
Annotations glide into position. The AI sidebar pulses gently when processing.
The writer should never feel startled by the interface.

### 4. Color With Intention

Each feature type owns a hue. Blue = chat/conversation. Green = feedback/growth.
Purple = revision/transformation. Yellow = human comments. Amber = orientation/
context. These are not arbitrary — they build intuition over time. Never
reassign a color to a different context.

### 5. WCAG AA as a Floor

Contrast must be sufficient on all text and interactive elements. Focus states
must be visible. The glass and opacity-based color system can erode contrast —
check it. Color alone must never be the only differentiator between states.

---

## 5. Voice & Copy

### Guiding Principle

Write like a thoughtful editor, not a product manager. Clear, warm, specific.
Never corporate, never breathless.

### Do

- Use plain language. "Save" not "Persist your work."
- Acknowledge the writer's work with respect. "Your document" not "the file."
- Be direct about what AI is doing. "Generating feedback..." not "Magic
  happening..."
- Use active voice. "Quillium saved your work" not "Work has been saved."

### Don't

- Use exclamation points in product UI. (Save them for onboarding moments, and
  even then, sparingly.)
- Use passive voice to describe system actions.
- Use jargon ("leverage", "utilize", "surface", "synergy").
- Write placeholder text that adds no meaning. ("Enter your text here" is
  noise. Empty is often better.)

### Microcopy Examples

| Context | Do | Don't |
|---------|-----|-------|
| Save indicator | "Saved" / "Saving..." | "Auto-save enabled" |
| AI processing | "Working on it..." | "Processing your request..." |
| Empty annotation panel | (nothing — let the editor breathe) | "No annotations yet! Add one." |
| Error state | "Something went wrong. Try again." | "Error 500: Request failed" |
| Settings label | "AI Settings" | "Configure AI Parameters" |

---

## 6. Anti-Patterns

These are the failure modes. If a design decision leads here, reconsider.

| Anti-Pattern | Why It's Wrong |
|--------------|---------------|
| Pure white backgrounds | Clinical, cold — breaks the warmth principle |
| Harsh primary colors (red, bright green, navy) | Aggressive — competes with writing |
| Aggressive gradients | Visual noise — distracts from content |
| Dense UI chrome | Suffocates the writing surface |
| Instant state transitions | Jarring — violates calm interactions |
| Emoji in UI labels | Immature — undermines the trusted-companion tone |
| "Dashboard" patterns | Wrong genre — this is a writing tool, not a control room |
| Over-animated onboarding | Demands attention during a focus-sensitive moment |
| Color-only state signals | Inaccessible — violates WCAG AA |
| Generic AI aesthetic (gradients, sparkle icons, purple branding) | Undermines Quillium's quiet confidence |

---

## 7. Reference Points

### Inspirations (Study These)

- **Bear** — warmth, native feel, typography-first, simple sidebar
- **Craft** — document-as-canvas, clean chrome, depth without heaviness
- **iA Writer** — radical focus on writing, typography confidence, calm
- **Notion** (structure only, not aesthetic) — block-based flexibility

### Anti-Inspirations (Avoid These)

- **Figma** — design tool aesthetic, dense chrome, dashboard feel
- **Jira** — productivity-first, sterile, everything is equally urgent
- **Generic AI writing tools** — neon, sparkles, gradients, aggressive CTAs
- **Google Docs** — functional but characterless, no warmth

---

## 8. Quick-Reference Tokens

```
Colors
------
App background:         #e5e7eb  (gray-200)
Document surface:       #ffffff
Panel glass:            bg-gray-300/70 + border-white/30
Text primary:           text-black/90
Text secondary:         text-black/50
Text tertiary:          text-black/30

Primary (Blue):         blue-500 / blue-600
Feedback (Green):       green-500 / green-50
Revise (Purple):        purple-500 / purple-50
Comment yellow (off):   #fef2cd
Comment yellow (on):    #fcbc05
Suggestion green (off): #f0fdf4
Suggestion green (on):  #dbf9e2

Typography
----------
Editor body:            Georgia, serif (default; user-configurable), 18px
UI labels:              text-xs / text-sm
UI label weight:        font-semibold (titles), regular (stats)

Spacing
-------
Panel padding:          p-4
Document width:         816px
Document margin-top:    mt-12

Depth
-----
Panel shadow:           shadow-lg
Document shadow:        shadow-xl
Glass blur:             backdrop-blur-md

Radius
------
Default:                rounded-lg
Pills / icon buttons:   rounded-full
Panels (collapsed):     finite half-size radius (for example, rounded-[26px])
Panels (expanded):      rounded-[14px]

Motion
------
Standard:               transition-colors duration-300
Panel expand:           340ms cubic-bezier(0.33, 0, 0.2, 1)
Annotation position:    300ms cubic-bezier(0.25, 0.46, 0.45, 0.94)
```

When a container transitions width, height, and border radius together, the collapsed
radius must be finite and equal to half its collapsed dimension. Do not use `rounded-full`,
`9999px`, or another effectively infinite radius on the morphing container: WebKit may
interpolate toward that huge value and snap at the end of the animation. A `67px` AutoAI
bubble therefore uses `33.5px`; the `52px` sidebar uses `26px`. Child icon buttons may still
use `rounded-full` because their radius is not part of the panel morph.
