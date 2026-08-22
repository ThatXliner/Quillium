# Share editor presentation through app-neutral capabilities

Keep shared annotation models, presentation, and layout in `@quillium/share`,
while Desktop, Web Preview, and Version History inject mutation, navigation, and
platform capabilities. Composition prevents lookalike interfaces from drifting
without importing Supabase, PostHog, Tauri, or application stores into the shared
package. See [PR #320](https://github.com/ThatXliner/Quillium/pull/320).
