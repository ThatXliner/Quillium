# Run Quillium and make a first change

The full writing app runs in Tauri. Start there to try saving, reopening drafts,
native menus, and keychain-backed credentials. A browser dev server is useful for
UI work, but it does not provide the native backend.

## Prerequisites

Install Git and Bun. Native desktop development also needs Rust/Cargo and your
platform's Tauri system dependencies. The project includes the Tauri JavaScript
CLI as a development dependency, so a separate global CLI is unnecessary.

CI pins its Bun version in [the test workflow](../.github/workflows/test.yml).
The package manifests and lockfiles record dependency versions.

## Install and configure

```bash
git clone https://github.com/ThatXliner/Quillium.git
cd Quillium
bun install
```

Run all commands on this page from the repository root.

The desktop app reads public configuration from `packages/desktop/.env.local`
or `.env`. If you do not already have either file, create `.env.local` with the
following values for local editing without connected services:

```dotenv
PUBLIC_SUPABASE_URL=
PUBLIC_SUPABASE_PUBLISHABLE_KEY=
PUBLIC_RELAY_URL=
PUBLIC_POSTHOG_KEY=
PUBLIC_POSTHOG_HOST=
```

Keep these names defined, even when their values are empty, because the desktop
imports them from SvelteKit's generated `$env/static/public` module. Empty values
disable the corresponding services. Restart the dev server after changing them.

When you need accounts, sharing, or analytics, fill in the relevant values using
[the desktop environment example](../packages/desktop/.env.example). Package-specific
configuration belongs beside its consuming package, as explained in
[the monorepo guide](monorepo.md#environment-files).

Configure AI connections in the app's AI settings. API-key connections use the
OS keychain; adding `OPENAI_API_KEY` to the frontend environment is not the setup
path. AI is optional for editing and annotation work.

To use Quillium from a local MCP client, open AI Settings and choose **Add MCP**.
Follow the Codex or Claude Desktop steps; other clients can use the generic JSON.
The local connection is read-only and can access every non-trashed document.

## Launch the desktop app

```bash
bun run desktop:tauri:dev
```

This starts Vite and builds the native app. The first Rust build can take longer
than subsequent runs. You should see the writing workspace and onboarding UI.

To work on browser UI separately:

```bash
bun run desktop:dev
```

Vite uses port 1420 by default. This launches the frontend only. Database,
keychain, and native menu calls need Tauri or a test harness that mocks them;
a page loading in the browser is not evidence that saving works.

## Try the writing model

Use a disposable document for this exercise:

1. Open the Library, create a document, and type a short paragraph.
2. Select a sentence and create a revision. Add another version with different wording.
3. Switch versions. The active version replaces that sentence in the root editor.
4. Edit the active version in its revision card. Watch the same prose change in
   the root editor, then undo and redo the edit.
5. Return to the Library and reopen the document. Check that its text and
   revision alternatives remain.

A revision holds alternatives for a passage. A draft holds a complete writing
state inside a document tab. [The architecture walkthrough](architecture-overview.md)
uses this distinction to explain the code behind the exercise.

## Make a first change

A label or layout adjustment is a useful first task. Find its component with the
[code map](file-structure.md), read the nearby code and relevant system guide,
then make a small change. Shared annotation cards live in `packages/share`;
desktop adapters supply editing and app-specific behavior.

Run the relevant checks from [CONTRIBUTING.md](../CONTRIBUTING.md#verify-your-change).
For an introduction to the annotation state tests, run:

```bash
bun run --cwd packages/desktop test:run tests/lib/editor/plugins/annotations/annotationField.test.ts
```

Open that test file beside `packages/share/src/core/annotationField.ts` to see
how transactions, version switching, and undo are exercised without starting
an app or calling an AI provider.

## If setup fails

| Symptom | Check |
|---|---|
| Missing `$env/static/public` export | Define all five variables above and restart Vite. |
| Port 1420 is occupied | Stop the existing dev server before starting another; Tauri expects this port. |
| Missing compiler or native library | Check the platform dependencies reported by the Tauri build. |
| Database or keychain call fails in a browser | Reproduce with `desktop:tauri:dev`; browser mode has no native backend. |
| Build rejects missing account configuration | Production builds require the public Supabase values. For an intentionally offline local frontend build, use `QUILLIUM_ALLOW_MISSING_SUPABASE_ENV=1 bun run desktop:build`. |

For relay development, follow [the relay README](../packages/relay/README.md).
For tests that bring up connected services, follow
[the E2E guide](../packages/e2e/README.md).
