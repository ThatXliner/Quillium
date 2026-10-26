import "@testing-library/jest-dom/vitest";
import PassageReviewCard from "$lib/ai/PassageReviewCard.svelte";
import { validatePassageReview } from "$lib/ai/passageReview";
import { cleanup, fireEvent, render, within } from "@testing-library/svelte";
import type { ToolUIPart } from "ai";
import { afterEach, describe, expect, it } from "vitest";

const hostile = '<img src=x onerror="window.__reviewXss=1"> The turn lands.';
const input = {
    passages: [
        { passage: "A quiet opening.", category: "keep", reason: hostile },
        { passage: "A repeated point.", category: "cut", reason: "Already established." },
    ],
};
const output = validatePassageReview({
    input,
    sourceText: "A quiet opening. A repeated point.",
    scope: "selection",
});
function part(value: unknown = output): ToolUIPart {
    return {
        type: "tool-reviewPassages",
        toolCallId: "review",
        state: "output-available",
        input,
        output: value,
    };
}
afterEach(cleanup);

describe("PassageReviewCard", () => {
    it("shows category meanings, marks, full quotes, and captured scope", async () => {
        const screen = render(PassageReviewCard, { part: part() });
        const legend = screen.getByRole("list", { name: "Legend" });
        expect(
            within(legend)
                .getAllByRole("listitem")
                .map((item) => item.dataset.legendCategory),
        ).toEqual(["keep", "cut"]);
        expect(within(legend).getByText("Core content")).toBeVisible();
        expect(within(legend).getByText("Redundant or lower-value evidence")).toBeVisible();
        expect(screen.getByText(/Based on the selection when requested/)).toBeVisible();
        expect(screen.container.querySelectorAll("[data-passage-category]")).toHaveLength(2);
        const reason = screen.getByText(hostile);
        expect(reason).not.toBeVisible();
        await fireEvent.click(screen.getByText("Why Keep?"));
        expect(reason).toBeVisible();
        expect(screen.container.querySelector("img")).toBeNull();
        expect(screen.getByText("“A quiet opening.”")).toBeVisible();
        expect(screen.queryByRole("button", { name: "Find in draft" })).toBeNull();
    });

    it("shows a source mismatch status instead of unvalidated marks", () => {
        const screen = render(PassageReviewCard, {
            part: part({ status: "invalid", reason: "source-mismatch" }),
        });
        expect(screen.getByRole("status")).toHaveTextContent("didn't match the captured writing");
        expect(screen.container.querySelector("[data-passage-category]")).toBeNull();
    });

    it.each([true, false])("does not show raw input before output, active=%s", (active) => {
        const pending: ToolUIPart = {
            type: "tool-reviewPassages",
            toolCallId: "review",
            state: "input-available",
            input,
        };
        const screen = render(PassageReviewCard, { part: pending, active });
        expect(screen.getByRole("status")).toHaveTextContent(
            active ? "Reviewing passages" : "interrupted",
        );
        expect(screen.container.querySelector("[data-passage-category]")).toBeNull();
    });

    it("reports malformed saved output", () => {
        const screen = render(PassageReviewCard, { part: part({ shown: true }) });
        expect(screen.getByRole("status")).toHaveTextContent("couldn't read this passage review");
    });
});
