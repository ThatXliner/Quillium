# PostHog post-wizard report

The wizard has completed a deep integration of PostHog analytics into Quillium. The following changes were made:

- **`posthog-js` installed** as a new dependency
- **`.env`** created with `PUBLIC_POSTHOG_KEY` and `PUBLIC_POSTHOG_HOST` (covered by `.gitignore`)
- **`src/hooks.client.ts`** created — initializes PostHog on app start with exception capture enabled
- **`svelte.config.js`** updated — added `paths.relative: false` required for session replay
- **15 events** instrumented across 10 files covering AI features, annotations, onboarding, and settings

| Event | Description | File |
|---|---|---|
| `ai_sidebar_opened` | User opens the AI sidebar to a specific mode | `src/lib/ai/AISidebar.svelte` |
| `ai_chat_message_sent` | User sends a message in the AI chat panel | `src/lib/ai/Chat.svelte` |
| `ai_feedback_requested` | User requests AI feedback on document or selection | `src/lib/ai/Feedback.svelte` |
| `ai_revise_requested` | User triggers AI revision via the Revise button | `src/lib/ai/Revise.svelte` |
| `ai_revise_quick_prompt_used` | User uses a quick prompt shortcut in the Revise panel | `src/lib/ai/Revise.svelte` |
| `comment_created` | User submits a new comment annotation | `src/lib/editor/plugins/annotations/PreComment.svelte` |
| `comment_ai_suggestion_requested` | User requests an AI suggestion within a comment thread | `src/lib/editor/plugins/annotations/Comment.svelte` |
| `suggestion_applied` | User applies an AI suggestion to the document | `src/lib/editor/plugins/annotations/Suggestion.svelte` |
| `suggestion_branched` | User converts an AI suggestion into a revision branch | `src/lib/editor/plugins/annotations/Suggestion.svelte` |
| `revision_version_created` | User creates a new version within a revision annotation | `src/lib/editor/plugins/annotations/Revision.svelte` |
| `tutorial_completed` | User completes the onboarding tutorial | `src/lib/tutorial/Tutorial.svelte` |
| `tutorial_skipped` | User skips the onboarding tutorial | `src/lib/tutorial/Tutorial.svelte` |
| `ai_settings_provider_changed` | User changes the AI provider in settings | `src/lib/ai/AISettings.svelte` |
| `ai_settings_model_changed` | User changes the AI model in settings | `src/lib/ai/AISettings.svelte` |
| `draft_scrapped` | User scraps their current draft | `src/lib/save/Save.svelte` |

## Next steps

We've built some insights and a dashboard for you to keep an eye on user behavior, based on the events we just instrumented:

- **Dashboard** — [Analytics basics](https://us.posthog.com/project/331767/dashboard/1331728)
- **Insight** — [AI Feature Engagement](https://us.posthog.com/project/331767/insights/bviLRx7V) — Daily trend of AI sidebar opens, chat messages, feedback and revise requests
- **Insight** — [Onboarding Tutorial Funnel](https://us.posthog.com/project/331767/insights/WxR2BS9M) — Conversion rate from app open to tutorial completion
- **Insight** — [Annotation Activity](https://us.posthog.com/project/331767/insights/OC6GVNnd) — Comments created, AI suggestions requested, and suggestions applied/branched
- **Insight** — [AI Settings Adoption](https://us.posthog.com/project/331767/insights/lXO3Wyxq) — Which AI providers and models writers choose
- **Insight** — [AI Revise Quick Prompt Popularity](https://us.posthog.com/project/331767/insights/NN3z2nGf) — Which quick revision prompts are used most

### Agent skill

We've left an agent skill folder in your project at `.claude/skills/posthog-integration-sveltekit/`. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.
