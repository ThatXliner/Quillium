// feedbackActions.ts — Bundled additions to the ordinary Feedback actions.
import { collegeOverlapAction } from "$lib/college/feedbackAction";
import type { SidebarPanelSession } from "$lib/sidebar/panels";
import type { Component } from "svelte";

export type FeedbackActionProps = {
    session: SidebarPanelSession;
    disabled: boolean;
    onBusyChange: (busy: boolean) => void;
};

export type FeedbackActionContribution = {
    id: string;
    component: Component<FeedbackActionProps>;
    applies: (session: SidebarPanelSession) => boolean;
};

export const feedbackActions: readonly FeedbackActionContribution[] = [collegeOverlapAction];
