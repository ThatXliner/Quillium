import {
    type CollegeReference,
    type CollegeSetup,
    parseCollegeSetup,
    serializeCollegeSetup,
} from "$lib/college/model";
import { newCollegeSetup } from "$lib/college/presets";
import {
    COLLEGE_ESSAY_GUY_HOSTNAME,
    type ResearchAdapterResult,
    type ResearchExtraction,
    type ResearchSource,
    type ResearchTarget,
    collegeResearchSetupKey,
    findingKey,
    researchTargetSchema,
    runSchoolResearch,
} from "$lib/college/research";
import { describe, expect, it, vi } from "vitest";

const SOURCE = "https://example.edu/admissions";

type FindingInput = {
    url: string;
    kind?: "requirement" | "official-advice" | "editorial-guidance";
    summary: string;
    evidence: string;
    cycle?: string;
    promptIds?: string[];
};

function target(overrides: Partial<ResearchTarget> = {}): ResearchTarget {
    return {
        school: "Example University",
        cycle: "2026–2027",
        program: "History",
        sourceUrl: SOURCE,
        prompts: [{ id: "p1", label: "Supplement", text: "Describe a meaningful experience." }],
        ...overrides,
    };
}

function extraction(
    findings: FindingInput[] = [],
    institutionMatches = true,
    warnings: string[] = [],
): ResearchExtraction {
    return {
        findings: findings.map((finding) => ({
            url: finding.url,
            kind: finding.kind ?? "requirement",
            summary: finding.summary,
            evidence: finding.evidence,
            cycle: finding.cycle ?? "2026–2027",
            promptIds: finding.promptIds ?? ["p1"],
        })),
        warnings,
        institutionMatches,
    };
}

function adapterResult(
    sources: ResearchSource[],
    findings: FindingInput[] = [],
    institutionMatches = true,
    warnings: string[] = [],
): ResearchAdapterResult {
    return {
        extraction: extraction(findings, institutionMatches, warnings),
        sources,
    };
}

function reference(id = "r1"): CollegeReference {
    return {
        id,
        publisher: "example.edu",
        url: SOURCE,
        checkedDate: "2026-09-07",
        cycle: "2026–2027",
        kind: "requirement",
        summary: "650 words",
        research: {
            setupKey: "",
            snapshotId: "snapshot-1",
            promptIds: ["p1"],
            school: "Example University",
            program: "History",
            targetCycle: "2026–2027",
            evidence: "650 words",
        },
    };
}

describe("school research target and persistence models", () => {
    it("accepts HTTPS URLs with ordinary or private-looking hosts and rejects other forms", () => {
        for (const sourceUrl of [
            SOURCE,
            "https://example.edu/admissions?cycle=2026",
            "https://example.edu/admissions#current",
            "https://example.edu:443/admissions",
            "https://localhost/admissions",
            "https://admissions.local/admissions",
            "https://10.0.0.4/admissions",
        ]) {
            expect(researchTargetSchema.safeParse(target({ sourceUrl })).success).toBe(true);
        }
        for (const sourceUrl of [
            "http://example.edu/admissions",
            "https://user:password@example.edu/admissions",
            "example.edu/admissions",
            "https://",
        ]) {
            expect(researchTargetSchema.safeParse(target({ sourceUrl })).success).toBe(false);
        }
        expect(
            researchTargetSchema.safeParse(
                target({
                    prompts: [
                        { id: "p1", label: "", text: "A" },
                        { id: "p1", label: "", text: "B" },
                    ],
                }),
            ).success,
        ).toBe(false);
    });

    it("round-trips accepted research provenance and an optional review while preserving v1 blobs", () => {
        const setup = newCollegeSetup("supplemental");
        const accepted = reference();
        setup.references = [accepted];
        setup.researchReview = {
            target: target(),
            rejectedKeys: [findingKey(accepted)],
            checkedDate: "2026-09-07",
        };
        const parsed = parseCollegeSetup(serializeCollegeSetup(setup));
        expect(parsed.references[0]?.research).toEqual(accepted.research);
        expect(parsed.researchReview?.target.sourceUrl).toBe(SOURCE);
        const old = { ...setup };
        old.researchReview = undefined;
        old.references = [];
        expect(parseCollegeSetup(JSON.stringify(old)).researchReview).toBeUndefined();
    });

    it("creates a compact setup key that changes with prompt constraints", () => {
        const setup = newCollegeSetup("supplemental");
        const first = collegeResearchSetupKey(setup);
        setup.prompts[0].constraints[0].max = 650;
        expect(collegeResearchSetupKey(setup)).not.toBe(first);
        expect(first.length).toBeLessThanOrEqual(100);
    });

    it("normalizes a finding associated with fourteen prompts", async () => {
        const promptIds = Array.from({ length: 14 }, (_, index) => `p${index + 1}`);
        const selectedTarget = target({
            prompts: promptIds.map((id) => ({
                id,
                label: `Prompt ${id}`,
                text: `Describe ${id}.`,
            })),
        });

        const result = await runSchoolResearch(
            selectedTarget,
            vi.fn(async () =>
                adapterResult(
                    [{ url: SOURCE, title: "Requirements", text: "650 words" }],
                    [
                        {
                            url: SOURCE,
                            summary: "650 words",
                            evidence: "650 words",
                            promptIds,
                        },
                    ],
                ),
            ),
            new AbortController().signal,
        );

        expect(result.findings).toHaveLength(1);
        expect(result.findings[0]?.research?.promptIds).toEqual(promptIds);
    });
});

describe("runSchoolResearch", () => {
    it("accepts College Essay Guy root and subdomain sources and forces editorial guidance", async () => {
        const rootUrl = `https://${COLLEGE_ESSAY_GUY_HOSTNAME}/school/example-university`;
        const subdomainUrl = `https://guides.${COLLEGE_ESSAY_GUY_HOSTNAME}/example-university`;
        const result = await runSchoolResearch(
            target(),
            vi.fn(async () =>
                adapterResult(
                    [
                        { url: rootUrl, title: "Example University guide", text: "Be specific." },
                        {
                            url: subdomainUrl,
                            title: "Example University essay guide",
                            text: "Show your voice.",
                        },
                        {
                            url: `https://${COLLEGE_ESSAY_GUY_HOSTNAME}.evil.example/guide`,
                            title: "Spoof",
                            text: "Be specific.",
                        },
                        {
                            url: `https://evil${COLLEGE_ESSAY_GUY_HOSTNAME}/guide`,
                            title: "Suffix spoof",
                            text: "Show your voice.",
                        },
                        {
                            url: `https://user:password@${COLLEGE_ESSAY_GUY_HOSTNAME}/private`,
                            title: "Credentials",
                            text: "Be specific.",
                        },
                    ],
                    [
                        {
                            url: rootUrl,
                            kind: "requirement",
                            summary: "Be specific.",
                            evidence: "Be specific.",
                            cycle: "",
                        },
                        {
                            url: subdomainUrl,
                            kind: "official-advice",
                            summary: "Show your voice.",
                            evidence: "Show your voice.",
                            cycle: "",
                        },
                    ],
                ),
            ),
            new AbortController().signal,
        );

        expect(result.pages).toEqual([
            { url: rootUrl, title: "Example University guide" },
            { url: subdomainUrl, title: "Example University essay guide" },
        ]);
        expect(result.findings.map((finding) => finding.kind)).toEqual([
            "editorial-guidance",
            "editorial-guidance",
        ]);
        expect(result.warnings.join(" ")).toMatch(/outside example\.edu or College Essay Guy/i);
    });

    it("forces a College Essay Guy confirmed source to editorial guidance", async () => {
        const sourceUrl = `https://${COLLEGE_ESSAY_GUY_HOSTNAME}/guide`;
        const result = await runSchoolResearch(
            target({ sourceUrl }),
            vi.fn(async () =>
                adapterResult(
                    [{ url: sourceUrl, title: "Guide", text: "Be specific." }],
                    [
                        {
                            url: sourceUrl,
                            kind: "requirement",
                            summary: "Be specific.",
                            evidence: "Be specific.",
                            cycle: "",
                        },
                    ],
                ),
            ),
            new AbortController().signal,
        );

        expect(result.findings[0]?.kind).toBe("editorial-guidance");
    });

    it("calls one adapter with a reconstructed public target", async () => {
        const adapter = vi.fn(async (receivedTarget: ResearchTarget) => {
            expect(receivedTarget).toEqual(target());
            expect(Object.keys(receivedTarget)).toEqual([
                "school",
                "cycle",
                "program",
                "sourceUrl",
                "prompts",
            ]);
            expect(receivedTarget).not.toHaveProperty("privateNotes");
            expect(receivedTarget.prompts[0]).not.toHaveProperty("essay");
            return adapterResult(
                [
                    {
                        url: SOURCE,
                        title: "Admissions",
                        text: "Example University 2026–2027: 650 words.",
                    },
                ],
                [
                    {
                        url: SOURCE,
                        summary: "650 words",
                        evidence: "650 words",
                    },
                ],
            );
        });
        const input = {
            ...target(),
            privateNotes: "PRIVATE_NOTES",
            prompts: [{ ...target().prompts[0], essay: "PRIVATE_ESSAY" }],
        } as unknown as ResearchTarget;

        const result = await runSchoolResearch(input, adapter, new AbortController().signal);

        expect(adapter).toHaveBeenCalledTimes(1);
        expect(result.findings).toHaveLength(1);
        expect(result.findings[0]?.research?.evidence).toBe("650 words");
    });

    it("keeps only exact returned URLs on the confirmed host or its subdomains", async () => {
        const returnedUrl = "https://example.edu/admissions/requirements?cycle=2026#limit";
        const subdomainUrl = "https://admissions.example.edu/essays";
        const adapter = vi.fn(async () =>
            adapterResult(
                [
                    { url: returnedUrl, title: "Requirements", text: "650 words" },
                    { url: subdomainUrl, title: "Essays", text: "Use your own voice" },
                    {
                        url: "https://other.edu/admissions",
                        title: "Other school",
                        text: "650 words",
                    },
                    { url: "http://example.edu/insecure", title: "HTTP", text: "650 words" },
                    { url: "https://user:password@example.edu/private", title: "Credentials" },
                    { url: "malformed", title: "Malformed" },
                ],
                [
                    {
                        url: returnedUrl,
                        summary: "650 words",
                        evidence: "650 words",
                    },
                    {
                        url: subdomainUrl,
                        kind: "official-advice",
                        summary: "Use your own voice",
                        evidence: "Use your own voice",
                    },
                    {
                        url: "https://example.edu/admissions/requirements",
                        summary: "This URL was not returned exactly.",
                        evidence: "650 words",
                    },
                ],
            ),
        );

        const result = await runSchoolResearch(target(), adapter, new AbortController().signal);

        expect(result.pages).toEqual([
            { url: returnedUrl, title: "Requirements" },
            { url: subdomainUrl, title: "Essays" },
        ]);
        expect(result.findings.map((finding) => finding.url)).toEqual([returnedUrl, subdomainUrl]);
        expect(result.warnings.join(" ")).toMatch(/outside example\.edu|not returned/i);
    });

    it("ignores findings with unknown prompt IDs", async () => {
        const result = await runSchoolResearch(
            target(),
            vi.fn(async () =>
                adapterResult(
                    [{ url: SOURCE, title: "Requirements", text: "650 words" }],
                    [
                        {
                            url: SOURCE,
                            summary: "650 words",
                            evidence: "650 words",
                            promptIds: ["unknown-prompt"],
                        },
                    ],
                ),
            ),
            new AbortController().signal,
        );

        expect(result.findings).toEqual([]);
        expect(result.warnings.join(" ")).toMatch(/unknown prompt ID/i);
    });

    it("rejects fallback findings whose evidence is not an exact source-text substring", async () => {
        const result = await runSchoolResearch(
            target(),
            vi.fn(async () =>
                adapterResult(
                    [
                        {
                            url: SOURCE,
                            title: "Requirements",
                            text: "Example University says 650 words.",
                        },
                    ],
                    [
                        {
                            url: SOURCE,
                            summary: "650 characters",
                            evidence: "650 characters",
                        },
                    ],
                ),
            ),
            new AbortController().signal,
        );

        expect(result.findings).toEqual([]);
        expect(result.warnings.join(" ")).toMatch(/unsupported evidence/i);
    });

    it("rejects a broader summary even when its attached evidence is exact source text", async () => {
        const result = await runSchoolResearch(
            target(),
            vi.fn(async () =>
                adapterResult(
                    [
                        {
                            url: SOURCE,
                            title: "Requirements",
                            text: "Write no more than 250 words.",
                        },
                    ],
                    [
                        {
                            url: SOURCE,
                            summary: "The response has a 250-word maximum.",
                            evidence: "Write no more than 250 words.",
                        },
                    ],
                ),
            ),
            new AbortController().signal,
        );

        const warningText = result.warnings.join(" ");
        expect(result.findings).toEqual([]);
        expect(warningText).toMatch(
            /summary is not a contiguous excerpt of its attached evidence/i,
        );
        expect(warningText).not.toMatch(/unsupported evidence/i);
    });

    it("accepts a direct extractive summary when its attached evidence is exact source text", async () => {
        const result = await runSchoolResearch(
            target({ cycle: "" }),
            vi.fn(async () =>
                adapterResult(
                    [
                        {
                            url: SOURCE,
                            title: "Requirements",
                            text: "Write no more than 250 words.",
                        },
                    ],
                    [
                        {
                            url: SOURCE,
                            summary: "Write no more than 250 words.",
                            evidence: "Write no more than 250 words.",
                            cycle: "",
                        },
                    ],
                ),
            ),
            new AbortController().signal,
        );

        expect(result.findings).toHaveLength(1);
        expect(result.findings[0]?.summary).toBe("Write no more than 250 words.");
        expect(result.warnings.join(" ")).not.toMatch(/summary is not a contiguous excerpt/i);
    });

    it("accepts hosted sources without text and preserves empty-cycle uncertainty", async () => {
        const result = await runSchoolResearch(
            target(),
            vi.fn(async () =>
                adapterResult(
                    [{ url: SOURCE, title: "Admissions search result" }],
                    [
                        {
                            url: SOURCE,
                            kind: "official-advice",
                            summary: "Application guidance",
                            evidence: "Application guidance",
                            cycle: "",
                        },
                    ],
                ),
            ),
            new AbortController().signal,
        );

        expect(result.pages).toEqual([{ url: SOURCE, title: "Admissions search result" }]);
        expect(result.findings).toHaveLength(1);
        expect(result.findings[0]?.cycle).toBe("");
        expect(result.warnings.join(" ")).toMatch(/no verified cycle|no verified requirement/i);
    });

    it("does not treat a cycle year after a word limit as another numeric limit", async () => {
        const result = await runSchoolResearch(
            target(),
            vi.fn(async () =>
                adapterResult(
                    [
                        {
                            url: SOURCE,
                            title: "Duke-like admissions requirements",
                            text: "The response is limited to 250 words for 2026-27.",
                        },
                    ],
                    [
                        {
                            url: SOURCE,
                            summary: "limited to 250 words for 2026-27",
                            evidence: "limited to 250 words for 2026-27",
                            cycle: "2026-27",
                        },
                    ],
                ),
            ),
            new AbortController().signal,
        );

        expect(result.findings).toHaveLength(1);
        expect(result.warnings.join(" ")).not.toMatch(/conflicting numeric limits/i);
    });

    it("does not treat question counts after a word limit as another numeric limit", async () => {
        const result = await runSchoolResearch(
            target({ cycle: "" }),
            vi.fn(async () =>
                adapterResult(
                    [
                        {
                            url: SOURCE,
                            title: "UC-like admissions requirements",
                            text: "Each response is limited to 350 words. Choose 4 of 8 questions.",
                        },
                    ],
                    [
                        {
                            url: SOURCE,
                            summary: "limited to 350 words",
                            evidence: "limited to 350 words. Choose 4 of 8 questions",
                            cycle: "",
                        },
                    ],
                ),
            ),
            new AbortController().signal,
        );

        expect(result.findings).toHaveLength(1);
        expect(result.warnings.join(" ")).not.toMatch(/conflicting numeric limits/i);
        expect(result.warnings.join(" ")).not.toMatch(/No verified requirement was found/i);
    });

    it("compares equivalent cycle labels without rewriting the returned label", async () => {
        for (const cycle of ["2026-27", "2026-2027", "2026–27", "2026–2027"]) {
            const result = await runSchoolResearch(
                target(),
                vi.fn(async () =>
                    adapterResult(
                        [
                            {
                                url: SOURCE,
                                title: "Admissions requirements",
                                text: `The ${cycle} response limit is 250 words.`,
                            },
                        ],
                        [
                            {
                                url: SOURCE,
                                summary: "response limit is 250 words",
                                evidence: `${cycle} response limit is 250 words`,
                                cycle,
                            },
                        ],
                    ),
                ),
                new AbortController().signal,
            );

            expect(result.findings[0]?.cycle).toBe(cycle);
            expect(result.warnings.join(" ")).not.toMatch(
                /differs from requested cycle|No requirement was verified for requested cycle/i,
            );
        }
    });

    it("keeps an undated requirement when the target cycle is unknown", async () => {
        const result = await runSchoolResearch(
            target({ cycle: "" }),
            vi.fn(async () =>
                adapterResult(
                    [
                        {
                            url: SOURCE,
                            title: "Undated requirements",
                            text: "The limit is 350 words.",
                        },
                    ],
                    [
                        {
                            url: SOURCE,
                            summary: "The limit is 350 words.",
                            evidence: "The limit is 350 words.",
                            cycle: "",
                        },
                    ],
                ),
            ),
            new AbortController().signal,
        );

        expect(result.findings).toHaveLength(1);
        expect(result.warnings.join(" ")).toMatch(/application cycle is unverified/i);
        expect(result.warnings.join(" ")).not.toMatch(/No verified requirement was found/i);
    });

    it("reports missing cycle verification without claiming an undated requirement is absent", async () => {
        const result = await runSchoolResearch(
            target(),
            vi.fn(async () =>
                adapterResult(
                    [
                        {
                            url: SOURCE,
                            title: "Undated requirements",
                            text: "The limit is 350 words.",
                        },
                    ],
                    [
                        {
                            url: SOURCE,
                            summary: "The limit is 350 words.",
                            evidence: "The limit is 350 words.",
                            cycle: "",
                        },
                    ],
                ),
            ),
            new AbortController().signal,
        );

        const warningText = result.warnings.join(" ");
        expect(result.findings).toHaveLength(1);
        expect(warningText).toMatch(/has no verified cycle for requested cycle/i);
        expect(warningText).toMatch(/No requirement was verified for requested cycle/i);
        expect(warningText).not.toMatch(/No verified requirement was found/i);
    });

    it("keeps a stale requirement visible and identifies the requested cycle precisely", async () => {
        const result = await runSchoolResearch(
            target({ cycle: "2024–2025" }),
            vi.fn(async () =>
                adapterResult(
                    [
                        {
                            url: SOURCE,
                            title: "Archived admissions requirements",
                            text: "The 2026-27 response limit is 250 words.",
                        },
                    ],
                    [
                        {
                            url: SOURCE,
                            summary: "response limit is 250 words",
                            evidence: "The 2026-27 response limit is 250 words",
                            cycle: "2026-27",
                        },
                    ],
                ),
            ),
            new AbortController().signal,
        );

        const warningText = result.warnings.join(" ");
        expect(result.findings).toHaveLength(1);
        expect(result.findings[0]?.cycle).toBe("2026-27");
        expect(warningText).toMatch(/differs from requested cycle/i);
        expect(warningText).toMatch(/No requirement was verified for requested cycle/i);
        expect(warningText).not.toMatch(/No verified requirement was found/i);
    });

    it("drops findings when the provider reports an institution mismatch", async () => {
        const result = await runSchoolResearch(
            target(),
            vi.fn(async () =>
                adapterResult(
                    [{ url: SOURCE, title: "Unrelated admissions page" }],
                    [
                        {
                            url: SOURCE,
                            summary: "Another school's requirement",
                            evidence: "Another school's requirement",
                            cycle: "",
                        },
                    ],
                    false,
                ),
            ),
            new AbortController().signal,
        );

        expect(result.findings).toEqual([]);
        expect(result.warnings.join(" ")).toMatch(/did not clearly match/i);
    });

    it("retains archived cycles and reports conflicting numeric limits", async () => {
        const result = await runSchoolResearch(
            target(),
            vi.fn(async () =>
                adapterResult(
                    [
                        {
                            url: SOURCE,
                            title: "Admissions cycles",
                            text: "Archived 2025–2026: 500 words. Current 2026–2027: 650 words.",
                        },
                    ],
                    [
                        {
                            url: SOURCE,
                            summary: "500 words",
                            evidence: "500 words",
                            cycle: "2025–2026",
                        },
                        {
                            url: SOURCE,
                            summary: "650 words",
                            evidence: "650 words",
                            cycle: "2026–2027",
                        },
                    ],
                ),
            ),
            new AbortController().signal,
        );

        expect(result.findings).toHaveLength(2);
        expect(result.findings.map((finding) => finding.cycle)).toEqual(["2025–2026", "2026–2027"]);
        expect(result.warnings.join(" ")).toMatch(/differs from requested cycle/i);
        expect(result.warnings.join(" ")).toMatch(/conflicting numeric limits/i);
    });

    it.each(["Words:", "Words =", "Characters:", "Chars ="])(
        "detects conflicting limits labeled with %s",
        async (label) => {
            const evidence = [`${label} 250`, `${label} 500`];
            const result = await runSchoolResearch(
                target({ cycle: "" }),
                async () =>
                    adapterResult(
                        [{ url: SOURCE, title: "Requirements", text: evidence.join(". ") }],
                        evidence.map((passage) => ({
                            url: SOURCE,
                            summary: passage,
                            evidence: passage,
                            cycle: "",
                        })),
                    ),
                new AbortController().signal,
            );

            expect(result.findings).toHaveLength(2);
            expect(result.warnings.join(" ")).toMatch(/conflicting numeric limits/i);
        },
    );

    it("returns a warning for malformed adapter output", async () => {
        const result = await runSchoolResearch(
            target(),
            vi.fn(async () => null as unknown as ResearchAdapterResult),
            new AbortController().signal,
        );

        expect(result.pages).toEqual([]);
        expect(result.findings).toEqual([]);
        expect(result.warnings.join(" ")).toMatch(/adapter response did not match/i);
    });

    it("returns a timeout result after 90 seconds even when the adapter ignores abort", async () => {
        vi.useFakeTimers();
        try {
            const adapter = vi.fn(async () => new Promise<ResearchAdapterResult>(() => undefined));
            const pending = runSchoolResearch(target(), adapter, new AbortController().signal);

            await vi.advanceTimersByTimeAsync(90_001);
            const result = await pending;

            expect(adapter).toHaveBeenCalledTimes(1);
            expect(result.pages).toEqual([]);
            expect(result.findings).toEqual([]);
            expect(result.warnings.join(" ")).toMatch(/timed out/i);
        } finally {
            vi.useRealTimers();
        }
    });

    it("rejects prompt caller cancellation even when the adapter ignores abort", async () => {
        const controller = new AbortController();
        const pending = runSchoolResearch(
            target(),
            vi.fn(async () => new Promise<ResearchAdapterResult>(() => undefined)),
            controller.signal,
        );

        controller.abort();
        await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    });

    it("uses deterministic finding keys", () => {
        const first = reference();
        expect(findingKey(first)).toBe(findingKey({ ...first }));
        expect(findingKey({ ...first, summary: "Different" })).not.toBe(findingKey(first));
    });
});
