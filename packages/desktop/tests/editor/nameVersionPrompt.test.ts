import NameVersionPrompt from "$lib/editor/NameVersionPrompt.svelte";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("svelte-sonner", () => ({ toast: { success: vi.fn() } }));
beforeEach(() => {
    HTMLDialogElement.prototype.showModal = function () {
        this.open = true;
    };
});
afterEach(cleanup);

it("focuses the name and saves a trimmed label once", async () => {
    let finish!: (id: number) => void;
    const save = vi.fn(
        () =>
            new Promise<number>((resolve) => {
                finish = resolve;
            }),
    );
    const onclose = vi.fn();
    const ui = render(NameVersionPrompt, { save, onclose });
    const input = ui.getByLabelText("Version name");
    expect(document.activeElement).toBe(input);
    await fireEvent.input(input, { target: { value: "  Opening  " } });
    await fireEvent.submit(input.closest("form")!);
    await fireEvent.submit(input.closest("form")!);
    expect(save.mock.calls).toEqual([["Opening"]]);
    expect(onclose).not.toHaveBeenCalled();
    finish(1);
    await vi.waitFor(() => expect(onclose).toHaveBeenCalledOnce());
});

it("rejects whitespace and cancels without creating a snapshot", async () => {
    const save = vi.fn();
    const onclose = vi.fn();
    const ui = render(NameVersionPrompt, { save, onclose });
    const input = ui.getByLabelText("Version name");
    await fireEvent.input(input, { target: { value: "   " } });
    await fireEvent.submit(input.closest("form")!);
    expect((ui.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    await fireEvent(ui.getByRole("dialog"), new Event("cancel", { cancelable: true }));
    expect(onclose).toHaveBeenCalledOnce();
    expect(save).not.toHaveBeenCalled();
});

it("keeps the prompt and label after a failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const ui = render(NameVersionPrompt, {
        save: vi.fn().mockRejectedValue(new Error("disk full")),
        onclose: vi.fn(),
    });
    const input = ui.getByLabelText("Version name") as HTMLInputElement;
    await fireEvent.input(input, { target: { value: "Opening" } });
    await fireEvent.submit(input.closest("form")!);
    await ui.findByRole("alert");
    expect(input.value).toBe("Opening");
    vi.restoreAllMocks();
});
