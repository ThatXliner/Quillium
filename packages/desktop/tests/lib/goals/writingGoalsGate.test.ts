import StatsModal from "$lib/stats/StatsModal.svelte";
import { render } from "@testing-library/svelte";
import { beforeAll, describe, expect, it, vi } from "vitest";

beforeAll(() => {
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
        this.setAttribute("open", "");
    });
});

describe("writing goals feature gate", () => {
    it("hides goal controls when novel-november is disabled", () => {
        const { queryByRole } = render(StatsModal, {
            props: { onclose: vi.fn(), writingGoalsEnabled: false },
        });

        expect(queryByRole("heading", { name: "Writing goals" })).toBeNull();
    });

    it("shows goal controls when novel-november is enabled", () => {
        const { getByRole } = render(StatsModal, {
            props: { onclose: vi.fn(), writingGoalsEnabled: true },
        });

        expect(getByRole("heading", { name: "Writing goals" })).toBeTruthy();
    });
});
