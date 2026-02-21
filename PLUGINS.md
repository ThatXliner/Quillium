# Plugin System (Future)

This document captures the intent and planned architecture for Quillium's plugin system. Nothing here is implemented yet — it's a north star to keep in mind when making architectural decisions.

## Vision

The AI sidebar is designed to be infinitely extensible. Today it has four built-in panels (Chat, Feedback, Revise, Document Context). In the future, users (and third-party developers) should be able to install plugins that appear as additional icons in the sidebar wheel and open as new panels.

A plugin might be:
- A custom AI assistant tuned for a specific genre (e.g. screenwriting, legal writing)
- A reference tool (dictionary, thesaurus, fact-checker)
- An export/publishing integration
- A writing game or prompt generator
- Anything a writer might want alongside their document

## Intended Architecture

### Plugin Definition

A plugin would be a self-contained unit declaring:
- `id`: unique string identifier
- `icon`: a Lucide icon or custom SVG
- `label`: display name shown in the sidebar
- `color`: accent color for the active state (following the existing blue/green/purple/amber pattern)
- `panel`: a Svelte component rendered in the sidebar content area

```ts
type QuilliumPlugin = {
    id: string;
    icon: Component;
    label: string;
    color: string; // tailwind color token, e.g. "rose"
    panel: Component;
};
```

### Registration

Plugins would be registered at startup, either from:
- A built-in registry (for core panels)
- User-installed plugins (stored in app data, loaded dynamically)
- A future plugin marketplace

The `actions` array in `AISidebar.svelte` would be derived from the registered plugin list rather than hardcoded.

### "Clear Chat" → "Reload Plugin"

The `clearChat()` function in `src/lib/ai/chat.svelte.ts` is the precursor to a "reload plugin" action — reinitialising a panel's state as if it were freshly opened. When plugins land, this becomes destroying and recreating the panel component instance. The UI affordance (the "Clear" button) stays the same; only the implementation changes.

### AI Plugins

Panels that use AI should use `createAiChat()` from `src/lib/ai/chat.svelte.ts` rather than instantiating `Chat` directly. This ensures:
- The sidebar processing indicator (rainbow glow) works automatically
- `clearChat()` / future "reload" works correctly
- Any future cross-cutting AI concerns are handled in one place

## Current Relevant Files

| File | Role |
|------|------|
| `src/lib/ai/AISidebar.svelte` | Sidebar shell, icon wheel, panel mounting — will become plugin host |
| `src/lib/ai/chat.svelte.ts` | AI chat factory — centralises chat lifecycle concerns |
| `src/lib/ai/settings.svelte.ts` | Shared AI state (provider, model, API key, document context, processing indicator) |
