// feedbackAction.ts — College owns the applicability and UI of its Feedback action.
import type { FeedbackActionContribution } from "$lib/ai/feedbackActions";
import { appSettings } from "$lib/settings.svelte";
import CollegeOverlap from "./CollegeOverlap.svelte";
import { collegeState } from "./state.svelte";

export const collegeOverlapAction: FeedbackActionContribution = {
    id: "college-overlap",
    component: CollegeOverlap,
    applies: (session) =>
        session.isCurrent() &&
        appSettings.aiEnabled &&
        collegeState.hostEnabled &&
        collegeState.status === "ready" &&
        !!collegeState.setup?.active &&
        collegeState.documentId === session.target.documentId &&
        collegeState.tabId === session.target.tabId,
};
