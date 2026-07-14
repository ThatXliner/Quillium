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
        for (const [revisionProvenance, expected] of [
            ["human", "human-revision"],
            ["ai", "ai-revision"],
            ["mixed", "mixed-revision"],
        ] as const) {
            it(`explicit ${revisionProvenance} revision wins over ${JSON.stringify(userEvent)}`, () => {
                expect(
                    classifyOrigin({
                        userEvent,
                        hasRevisionInternalEdit: true,
                        hasNestedEditorEdit: false,
                        revisionProvenance,
                    }),
                ).toBe(expected);
            });
        }

        it(`nested marker wins over ${JSON.stringify(userEvent)} -> "nested-edit"`, () => {
            expect(
                classifyOrigin({
                    userEvent,
                    hasRevisionInternalEdit: false,
                    hasNestedEditorEdit: true,
                }),
            ).toBe("nested-edit");
        });

        it("nested AI text edited by a human is explicitly mixed", () => {
            expect(
                classifyOrigin({
                    userEvent,
                    hasRevisionInternalEdit: false,
                    hasNestedEditorEdit: true,
                    revisionProvenance: "mixed",
                }),
            ).toBe("mixed-revision");
        });
    }

    it("does not infer AI from a revision marker without explicit provenance", () => {
        expect(
            classifyOrigin({
                userEvent: undefined,
                hasRevisionInternalEdit: true,
                hasNestedEditorEdit: false,
            }),
        ).toBe("unknown");
    });

    it("explicit revision provenance wins over nested when both markers are present", () => {
        expect(
            classifyOrigin({
                userEvent: "input.type",
                hasRevisionInternalEdit: true,
                hasNestedEditorEdit: true,
                revisionProvenance: "human",
            }),
        ).toBe("human-revision");
    });
});
