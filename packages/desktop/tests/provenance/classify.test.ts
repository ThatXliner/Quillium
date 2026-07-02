import type { ChangeOrigin } from "$lib/db/events";
import { classifyOrigin } from "$lib/provenance/classify";
import { describe, expect, it } from "vitest";

// ── userEvent → origin mapping ───────────────────────────────────────────────

describe("classifyOrigin — userEvent mapping", () => {
    const cases: Array<{ userEvent: string | undefined; expected: ChangeOrigin }> = [
        { userEvent: "input.type", expected: "type" },
        { userEvent: "input.type.compose", expected: "type" },
        { userEvent: "input", expected: "format" },
        { userEvent: "input.paste", expected: "paste" },
        { userEvent: "input.restore", expected: "restore" },
        { userEvent: "delete.cut", expected: "cut" },
        { userEvent: "delete.forward", expected: "delete" },
        { userEvent: "delete.backward", expected: "delete" },
        { userEvent: undefined, expected: "unknown" },
        { userEvent: "select.pointer", expected: "unknown" },
    ];

    for (const { userEvent, expected } of cases) {
        it(`maps ${JSON.stringify(userEvent)} -> "${expected}"`, () => {
            expect(
                classifyOrigin({
                    userEvent,
                    hasRevisionInternalEdit: false,
                    hasNestedEditorEdit: false,
                }),
            ).toBe(expected);
        });
    }
});

// ── precedence of revision / nested markers ──────────────────────────────────

describe("classifyOrigin — marker precedence", () => {
    const userEvents: Array<string | undefined> = [
        undefined,
        "input.type",
        "input.type.compose",
        "input",
        "input.paste",
        "input.restore",
        "delete.cut",
        "delete.forward",
        "select.pointer",
    ];

    for (const userEvent of userEvents) {
        it(`revision marker wins over ${JSON.stringify(userEvent)} -> "ai-revision"`, () => {
            expect(
                classifyOrigin({
                    userEvent,
                    hasRevisionInternalEdit: true,
                    hasNestedEditorEdit: false,
                }),
            ).toBe("ai-revision");
        });

        it(`nested marker wins over ${JSON.stringify(userEvent)} -> "nested-edit"`, () => {
            expect(
                classifyOrigin({
                    userEvent,
                    hasRevisionInternalEdit: false,
                    hasNestedEditorEdit: true,
                }),
            ).toBe("nested-edit");
        });
    }

    it("revision wins over nested when both markers are true", () => {
        expect(
            classifyOrigin({
                userEvent: "input.type",
                hasRevisionInternalEdit: true,
                hasNestedEditorEdit: true,
            }),
        ).toBe("ai-revision");
    });
});
