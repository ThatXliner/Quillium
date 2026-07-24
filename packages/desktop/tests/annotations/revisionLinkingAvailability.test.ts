import { cleanup, fireEvent, render } from "@testing-library/svelte";
import "@testing-library/jest-dom/vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";

import { annotations as annotationExtensions } from "$lib/editor/plugins/annotations";
import Revision from "$lib/editor/plugins/annotations/Revision.svelte";
import { annotationField } from "$lib/editor/plugins/annotations/annotationField";
import { createNewAnnotation, makeVersion } from "$lib/editor/plugins/annotations/models";

const mocks = vi.hoisted(() => ({
    openUrl: vi.fn(),
    showFeedbackSurvey: vi.fn(),
    capture: vi.fn(),
    toastInfo: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: mocks.openUrl }));
vi.mock("svelte-sonner", () => ({ toast: { info: mocks.toastInfo } }));
vi.mock("$lib/posthog", () => ({
    capture: mocks.capture,
    showFeedbackSurvey: mocks.showFeedbackSurvey,
}));

const views: EditorView[] = [];

afterEach(() => {
    cleanup();
    for (const view of views) view.destroy();
    views.length = 0;
    mocks.openUrl.mockReset();
    mocks.showFeedbackSurvey.mockReset();
    mocks.capture.mockReset();
    mocks.toastInfo.mockReset();
});

function makeRevisionView() {
    const state = EditorState.create({
        doc: "hello",
        extensions: [annotationExtensions()],
    });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const view = new EditorView({ state, parent: host });
    views.push(view);

    const version = makeVersion({ doc: "hello" });
    const revision = {
        ...createNewAnnotation(
            view.state.field(annotationField),
            EditorSelection.single(0, 5),
            "revision",
        ),
        activeVersionId: version.id,
        versions: [version],
    };
    return { revision, view };
}

describe("revision linking availability", () => {
    it("replaces nested version-link management with a feedback toast", async () => {
        const { revision, view } = makeRevisionView();
        const rendered = render(Revision, {
            props: {
                revision,
                isActive: false,
                view,
                nested: true,
                updateThread: vi.fn(),
            },
        });

        await fireEvent.click(rendered.getByRole("button", { name: "Link version" }));

        expect(mocks.toastInfo).toHaveBeenCalledWith(
            "Nested linked revisions are currently not supported.",
            expect.objectContaining({
                description: "Want us to prioritize this?",
                action: expect.objectContaining({ label: "Share feedback" }),
            }),
        );
        expect(rendered.queryByRole("button", { name: "Link to another revision…" })).toBeNull();

        const options = mocks.toastInfo.mock.calls[0][1];
        mocks.showFeedbackSurvey.mockReturnValue(true);
        options.action.onClick();
        expect(mocks.showFeedbackSurvey).toHaveBeenCalledWith("nested_revision_link");
        expect(mocks.capture).toHaveBeenCalledWith("nested_version_link_feedback_opened", {
            destination: "posthog_survey",
        });
        expect(mocks.openUrl).not.toHaveBeenCalled();
    });

    it("falls back to the public feedback form when the PostHog survey is unavailable", async () => {
        mocks.showFeedbackSurvey.mockReturnValue(false);
        const { revision, view } = makeRevisionView();
        const rendered = render(Revision, {
            props: {
                revision,
                isActive: false,
                view,
                nested: true,
                updateThread: vi.fn(),
            },
        });

        await fireEvent.click(rendered.getByRole("button", { name: "Link version" }));
        const options = mocks.toastInfo.mock.calls[0][1];
        options.action.onClick();

        expect(mocks.capture).toHaveBeenCalledWith("nested_version_link_feedback_opened", {
            destination: "fallback_form",
        });
        expect(mocks.openUrl).toHaveBeenCalledWith("https://forms.gle/1BEa4XwXXtuEuTqo7");
    });
});
