/**
 * constants.ts — App-wide constants shared across components.
 */

// Bug reports: free-form Google Form. Reached from the ErrorBanner ("Report this
// issue") and the Settings footer "Report a bug" button.
export const FEEDBACK_FORM_URL = "https://forms.gle/1BEa4XwXXtuEuTqo7";

// General app feedback: structured PostHog-hosted survey. Reached from the native
// Help → "Send Feedback…" menu item and the Settings footer "Send Feedback" button.
// The ID is the survey's stable identifier from the PostHog dashboard (Surveys →
// the survey → copy ID). It is not a secret, so it lives alongside the form URL.
// Empty string disables the survey (helper no-ops) until a survey is created.
export const FEEDBACK_SURVEY_ID = "019e955b-2c1a-0000-4793-edcac62b8133";

export const OMNI_WAITLIST_URL = "https://quillium.bryanhu.com/omni";

// Filled in once the app is live on the App Store.
// Format: https://apps.apple.com/app/id<APP_ID>
export const APP_STORE_URL = "";
