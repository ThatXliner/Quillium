# Changelog and feature captures

Quillium shows a "What's New" modal after minor version bumps. Entries live in
[changelog.json](../packages/desktop/src/lib/changelog.json), keyed by
`major.minor`. Patch releases do not get entries.

## Write the entry

Use two to five short paragraphs, one per notable change. Explain what a writer
can do now and why it helps. Use bold sparingly for words that help scanning.
The content is Markdown inside a JSON string:

```json
{
  "0.12": {
    "date": "April 2026",
    "content": "You can now keep **alternate openings** beside your draft. Switch between them without losing your earlier wording."
  }
}
```

The existing editorial policy omits AI-related changes from the in-app changelog,
including models, personas, sidebar improvements, and prompts. Privacy and legal
changes get their own paragraph, noting when there is no functional change.

## Capture a feature

Use [changelog-shot.ts](../packages/desktop/scripts/changelog-shot.ts) for
reproducible images. It boots the app with mocked Tauri calls, seeds a scene,
and saves a cropped PNG in `packages/desktop/static/changelog/<version>.png`.

Run from the repository root:

```bash
# List available scenes.
bun run desktop:changelog:shot

# Capture a built-in scene.
bun run desktop:changelog:shot --version 0.20 --scene authorship-playback

# Capture a specific element with padding.
bun run desktop:changelog:shot --version 0.21 --scene editor --crop "#editor-document" --pad 24
```

Embed the result with Markdown inside the entry's `content` string, using
`![Feature description](/changelog/0.21.png)`. Keep the crop focused on the
feature. For a full-page feature, use a compact viewport so text remains legible
in the modal. `--width` and `--height` control the capture dimensions.

## Add a scene when needed

For a scene that will recur, add it to the script's `SCENES` map. Each entry has
`needs` for boot options and `run` to bring the app to the desired state. Reuse
`applyDebugScenario(page, id)` with a scenario from
[debug/scenarios.ts](../packages/desktop/src/lib/debug/scenarios.ts).
A scene can set `needs.viewport` for a compact full-page capture.

For a one-time capture, put a temporary driver beside `changelog-shot.ts` and
import its `boot`, `applyDebugScenario`, `cropShot`, and `shutdown` helpers:

```typescript
import { boot, applyDebugScenario, cropShot, shutdown } from "./changelog-shot";

const capture = await boot({ fakeApiKey: true });
try {
    await applyDebugScenario(capture.page, "screenshot-full-ui");
    await cropShot(capture.page, {
        version: "0.21",
        crop: "#ai-sidebar",
        pad: 20,
    });
} finally {
    await shutdown(capture);
}
```

Run it from the root with `bun packages/desktop/scripts/<driver>.ts`, inspect the
PNG and its appearance in the modal, then remove the temporary driver. A feature
capture illustrates release notes; regression baselines follow the separate
[visual regression policy](visual-regression.md).
