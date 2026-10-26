---
name: integration-sveltekit
description: PostHog integration for SvelteKit applications
metadata:
  author: PostHog
  version: 1.8.1
---

# PostHog in Quillium

Quillium already has PostHog integrations. Use this workflow when adding or
changing analytics. The metadata above records the original imported skill;
these instructions replace its initial setup wizard.

1. Read the [event catalog](../../../docs/posthog-events.md) for event names,
   properties, privacy rules, and source locations. Search existing captures
   before adding an event.
2. Read the affected initializer. Desktop uses
   [`src/lib/posthog.ts`](../../../packages/desktop/src/lib/posthog.ts).
   Landing uses [`src/hooks.client.ts`](../../../packages/landing/src/hooks.client.ts).
   Keep initialization in those modules and use their existing public environment
   variables. Do not hardcode keys or add a second client.
3. Add only events needed for the requested change. In desktop code, use the
   `capture` and `captureException` helpers from `$lib/posthog`. Keep document text,
   prompts, credentials, and personal form fields out of event properties and
   exception messages. The capture helper removes only specific property names;
   it does not sanitize arbitrary content.
4. Preserve analytics opt-out and session replay masking. Account identification
   belongs in [`auth.svelte.ts`](../../../packages/desktop/src/lib/auth/auth.svelte.ts).
   It identifies non-anonymous account IDs and resets on sign-out. Do not add
   identification on form submission or identify anonymous sessions.
5. Update the event catalog in the same change. Run the affected package checks
   from [CONTRIBUTING.md](../../../CONTRIBUTING.md#verify-your-change) and inspect
   the emitted properties and opt-out behavior. Development analytics are
   normally disabled, so a quiet network alone does not verify opt-out.

For a new SDK capability, consult current official PostHog documentation and the
installed dependency. The old copied example app and SDK reference snapshots
are no longer maintained here. Dashboard creation and broad instrumentation
sweeps are separate tasks, not part of every analytics change.
