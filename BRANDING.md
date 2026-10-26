# Quillium Brand Bible

Use this guide for visual design and product copy. It records design intent;
implementation details live in the linked components. Check current code before
copying dimensions or colors into a new component.

---

## 1. The Product

### What It Is

Quillium is a desktop writing application for long-form creative work. Built
on Tauri with a SvelteKit frontend, it combines a distraction-free editor with
AI-powered writing assistance, a structured annotation system, and non-linear
editing tools.

### Who It's For

Quillium is for sustained writing, including novels, essays, memoirs, and college
applications. Writing stays central. Task management and general note-taking do
not define the interface.

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

Used for interactive elements, primary actions, and the unified Chat panel.
Blue = conversation, connection, action.

| Token | Value | Usage |
|-------|-------|-------|
| `primary` | `blue-500` | Default interactive |
| `primary-hover` | `blue-600` | Hover state |
| `primary-active` | `text-blue-600 bg-white/60` | Active tab in AI panel |
| `primary-hover-text` | `hover:text-blue-600` | Hover on collapsed icons |

#### Feedback / AI Green

Used for feedback actions and suggestion highlights. Green = growth,
validation, constructive input.

| Token | Value | Usage |
|-------|-------|-------|
| `feedback` | `green-500` | Active feedback icon |
| `feedback-bg` | `green-50` | Feedback context backgrounds |
| Suggestion underline | `#22c55e` | Inactive suggestion |
| Suggestion fill | `#dcfce7` | Active suggestion |

#### Revision / AI Purple

Used for revision actions. Purple = transformation, craft, editing intent.

| Token | Value | Usage |
|-------|-------|-------|
| `revise` | `purple-500` | Active revise icon |
| `revise-bg` | `purple-50` | Revision context backgrounds |

#### Comment / Annotation Yellow

Used for comment annotations, whether a writer or an AI request created them.
Color identifies the annotation type, not its author.

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
| Width and spacing | Follow the responsive layout in `Editor.svelte` |
| Text padding and indent | Preserve the CodeMirror content layout |
| Radius | `rounded-lg` |

The document card remains visually distinct from the surrounding controls.
Its responsive dimensions and shadow are defined in
[Editor.svelte](packages/desktop/src/lib/editor/Editor.svelte).

#### Panels & Sidebars

| Property | Value |
|----------|-------|
| Standard panel padding | `p-4` |
| Panel radius (collapsed) | `rounded-[100px]` (pill) |
| Panel radius (expanded) | `rounded-[14px]` |
| Panel shadow | `shadow-lg` |
| Panel background | `bg-gray-300/70 backdrop-blur-md` |

#### Spacing Rules

1. **Breathable layouts.** Panels should never feel cramped. White space is
   intentional — it signals that writing is the priority.
2. **Consistent padding.** `p-4` is the standard panel unit. Deviate only
   when context clearly demands it (e.g., tight icon strips).
3. **Preserve text space.** Keep document padding in the editor layout and check
   narrow viewports before adding surrounding controls.

---

### 3.4 Depth & Elevation

Use depth to distinguish the document, panels, and overlays from the background.

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

The sidebar collapses to a vertical pill of icons and expands when a panel is
selected. Its height follows the visible panels. Use
[Sidebar.svelte](packages/desktop/src/lib/sidebar/Sidebar.svelte) for current
sizing and [builtInPanels.ts](packages/desktop/src/lib/sidebar/builtInPanels.ts)
for panel colors and labels.

#### Expanded Panel

The AI sidebar opens into a rounded panel with an icon strip, a title row, and
a content area. The panel is resizable via drag handles.

Panels can provide their own preferred size. The sidebar clamps resizing to
its limits and the viewport. Reuse
[PanelResizeController](packages/desktop/src/lib/ai/panelResize.svelte.ts)
instead of copying fixed sizes.

#### Resizable Modals

Application modals, including export, confirmation, onboarding, and sprint dialogs,
use the same right-edge, bottom-edge, and corner resize handles as
sidebar panels. They stay centered while resizing, leave at least 16px of space
from the viewport edge, and keep overflowing content scrollable. Arrow keys on a
focused handle resize the modal. After resizing, the same compact restore icon
button used by the sidebar appears in the modal header; Home or a double-click also restores the default size.
Handles appear on hover, keyboard focus, or during a drag.
Custom sizes last until the modal is unmounted. The sidebar and modals share their
handle component and pointer gesture. Contextual popovers and guided-tour callouts
keep their existing anchored layout.

#### Annotation Card

Annotation cards align with their source text. The layout can use both sides
of the document or one column, and the writer can resize the panel. Defaults and
bounds live in [settings.svelte.ts](packages/desktop/src/lib/settings.svelte.ts).
Use the shared [annotation column](packages/share/src/layout/) and
[card components](packages/share/src/cards/) for presentation.

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
Purple = revision/transformation. Yellow = comments. Amber = orientation/
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

## Implementation references

- [Annotation styles](packages/desktop/src/lib/editor/plugins/annotations/default.css)
  define active and inactive text marks.
- [Settings defaults](packages/desktop/src/lib/settings.svelte.ts) and
  [font catalog](packages/desktop/src/lib/settings/fonts.ts) own configurable typography.
- [Sidebar](packages/desktop/src/lib/sidebar/Sidebar.svelte) owns panel dimensions
  and transitions.
- [Shared UI](packages/share/src/) owns reusable cards, modals, and resize controls.
