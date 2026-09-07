// schoolResearch.pw.ts — Research review through the real UI and hosted provider pipeline.
import { type Page, expect, test } from "@playwright/test";
import type { CollegeSetup } from "../../src/lib/college/model";
import { QuilliumPage } from "./QuilliumPage";

const source = "https://admissions.example.edu/essays";
const stored = "mock-college-setup:doc-test-1:tab-test-1";
const panel = (page: Page) => page.locator('#ai-sidebar [data-panel-id="college"]');
const research = (page: Page) => panel(page).getByRole("region", { name: "School research" });

async function openCollege(page: Page): Promise<void> {
    if (await panel(page).isVisible()) return;
    await page.locator("#ai-tab-college").click();
    await expect(panel(page)).toBeVisible();
}

async function prepare(page: Page): Promise<{ q: QuilliumPage; requests: string[] }> {
    const q = new QuilliumPage(page, {
        apiKey: "fixture-key",
        initialDoc: "PRIVATE_ESSAY_SENTINEL",
    });
    await q.setup();
    await page.addInitScript(() => {
        (window as unknown as { isTauri: boolean }).isTauri = true;
        localStorage.setItem("mock-writer-brief:doc-test-1", "PRIVATE_NOTES_SENTINEL");
    });

    const requests: string[] = [];
    await page.route("https://api.openai.com/**", async (route) => {
        const body = route.request().postData() || "";
        requests.push(body);
        const shouldFail = await page.evaluate(
            () => localStorage.getItem("research-api-failure") === "1",
        );
        if (shouldFail) {
            await route.fulfill({
                status: 500,
                contentType: "application/json",
                body: JSON.stringify({
                    error: {
                        message: "Fixture API unavailable",
                        type: "server_error",
                        param: null,
                        code: "fixture_failure",
                    },
                }),
            });
            return;
        }

        const promptId = await page.evaluate(
            (key) => JSON.parse(localStorage.getItem(key)!).prompts[0].id,
            stored,
        );
        const output = JSON.stringify({
            institutionMatches: true,
            warnings: [],
            findings: [
                {
                    url: source,
                    kind: "requirement",
                    summary: "The response has a 250-word maximum.",
                    evidence: "Write no more than 250 words.",
                    cycle: "2026-2027",
                    promptIds: [promptId],
                },
                {
                    url: source,
                    kind: "official-advice",
                    summary: "Keep your own voice.",
                    evidence: "Use your own voice.",
                    cycle: "2026-2027",
                    promptIds: [promptId],
                },
            ],
        });
        await route.fulfill({
            contentType: "application/json",
            body: JSON.stringify({
                id: "resp_fixture",
                object: "response",
                created_at: 1,
                model: "gpt-5.6-sol",
                status: "completed",
                output: [
                    {
                        id: "search_fixture",
                        type: "web_search_call",
                        status: "completed",
                        action: {
                            type: "search",
                            queries: [`site:${new URL(source).hostname} essays`],
                            sources: [{ type: "url", url: source }],
                        },
                    },
                    {
                        id: "msg_fixture",
                        type: "message",
                        role: "assistant",
                        status: "completed",
                        content: [
                            {
                                type: "output_text",
                                text: output,
                                annotations: [
                                    {
                                        type: "url_citation",
                                        start_index: 0,
                                        end_index: output.length,
                                        url: source,
                                        title: "Example University admissions",
                                    },
                                ],
                            },
                        ],
                    },
                ],
                usage: {
                    input_tokens: 100,
                    output_tokens: 100,
                    total_tokens: 200,
                    input_tokens_details: { cached_tokens: 0 },
                    output_tokens_details: { reasoning_tokens: 0 },
                },
            }),
        });
    });

    await q.goto();
    await page.locator("#ai-tab-college").click();
    await panel(page).getByRole("button", { name: "School supplement", exact: true }).click();
    await panel(page).getByLabel("School", { exact: true }).fill("Example University");
    await panel(page).getByLabel("Prompt", { exact: true }).fill("Why do you want to study here?");
    await panel(page).getByRole("button", { name: "Apply to existing tab", exact: true }).click();
    await page.locator('[data-tab-id="tab-test-1"]').click();
    await openCollege(page);
    await expect(
        panel(page).getByRole("button", { name: "Change prompt", exact: true }),
    ).toBeVisible();
    return { q, requests };
}

async function start(page: Page): Promise<void> {
    await panel(page)
        .getByRole("button", { name: "Research this school's prompt", exact: true })
        .click();
    await research(page).getByLabel("Application cycle", { exact: true }).fill("2026-2027");
    await research(page).getByLabel("Official admissions page", { exact: true }).fill(source);
    await research(page)
        .getByLabel("I checked that this is the official site for this school and campus.")
        .check();
    await research(page).getByRole("button", { name: "Start research", exact: true }).click();
}

test("hosted research is reviewed, saved offline, and excluded after changing the prompt", async ({
    page,
}) => {
    const { q, requests } = await prepare(page);
    const before = await page.evaluate((key) => localStorage.getItem(key), stored);

    await start(page);
    await expect(research(page).getByRole("heading", { name: "Review sources" })).toBeVisible();
    expect(await page.evaluate((key) => localStorage.getItem(key), stored)).toBe(before);
    await expect(research(page).getByRole("checkbox", { checked: true })).toHaveCount(0);
    await expect(research(page).getByText("Published requirements", { exact: true })).toBeVisible();
    await expect(
        research(page).getByRole("link", { name: source, exact: true }).first(),
    ).toBeVisible();
    await research(page).getByText("Sources returned (1)", { exact: true }).click();
    await expect(
        research(page).getByRole("link", { name: source, exact: true }).last(),
    ).toBeVisible();
    await research(page)
        .getByLabel("The response has a 250-word maximum.", { exact: true })
        .check();
    await research(page).getByRole("button", { name: "Add to essay context", exact: true }).click();
    await expect(research(page).getByRole("status")).toContainText("Source review saved");

    const saved = JSON.parse(
        (await page.evaluate((key) => localStorage.getItem(key), stored))!,
    ) as CollegeSetup;
    expect(saved.references.filter((reference) => reference.research)).toHaveLength(1);
    expect(saved.references.find((reference) => reference.research)?.research?.evidence).toBe(
        "Write no more than 250 words.",
    );
    expect(saved.researchReview?.rejectedKeys).toHaveLength(1);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toContain('"allowed_domains":["admissions.example.edu"]');
    expect(requests.join(" ")).not.toMatch(/PRIVATE_ESSAY_SENTINEL|PRIVATE_NOTES_SENTINEL/);
    expect(await q.countInvocations("school_research_fetch")).toBe(0);

    await page.evaluate(() => localStorage.setItem("research-offline", "1"));
    await page.reload();
    await expect(q.editor).toBeVisible();
    await page.locator("#ai-tab-college").click();
    await expect(
        panel(page).getByRole("button", { name: "Change prompt", exact: true }),
    ).toBeVisible();
    await panel(page).getByText("Sources and settings", { exact: true }).click();
    await panel(page).getByRole("button", { name: "Context", exact: true }).click();
    const context = page.locator('#ai-sidebar [data-panel-id="context"]');
    await expect(context).toBeVisible();
    await context.getByText("Accepted source snapshots", { exact: true }).click();
    await expect(context.getByText("Write no more than 250 words.", { exact: true })).toBeVisible();
    expect(requests).toHaveLength(1);

    await page.locator("#ai-tab-college").evaluate((element: HTMLElement) => element.click());
    await panel(page).getByRole("button", { name: "Change prompt", exact: true }).click();
    await panel(page)
        .getByLabel("Prompt", { exact: true })
        .fill("Describe a community you belong to.");
    await panel(page).getByRole("button", { name: "Use this prompt", exact: true }).click();
    await expect(
        panel(page).getByRole("button", { name: "Change prompt", exact: true }),
    ).toBeVisible();
    const changed = JSON.parse(
        (await page.evaluate((key) => localStorage.getItem(key), stored))!,
    ) as CollegeSetup;
    expect(changed.prompts[0]?.text).toBe("Describe a community you belong to.");
    expect(changed.references.some((reference) => reference.research)).toBe(false);
    expect(changed.researchReview).toBeUndefined();
    await panel(page).getByText("Sources and settings", { exact: true }).click();
    await panel(page).getByRole("button", { name: "Context", exact: true }).click();
    await expect(context).toBeVisible();
    await context.getByText("Accepted source snapshots", { exact: true }).click();
    await expect(context.getByText("Write no more than 250 words.", { exact: true })).toHaveCount(
        0,
    );
    expect(requests).toHaveLength(1);
    expect(await q.countInvocations("school_research_fetch")).toBe(0);
    q.expectNoPageErrors();
});

test("an API failure leaves the saved prompt unchanged and can be retried", async ({ page }) => {
    const { q, requests } = await prepare(page);
    const before = await page.evaluate((key) => localStorage.getItem(key), stored);
    await page.evaluate(() => localStorage.setItem("research-api-failure", "1"));
    await start(page);
    await expect(research(page).getByText(/request failed.*HTTP 500.*retry/i)).toBeVisible();
    expect(await page.evaluate((key) => localStorage.getItem(key), stored)).toBe(before);
    expect(await q.countInvocations("school_research_fetch")).toBe(0);

    await page.evaluate(() => localStorage.removeItem("research-api-failure"));
    await research(page).getByText("Change target or retry", { exact: true }).click();
    await research(page)
        .getByLabel("I checked that this is the official site for this school and campus.")
        .check();
    await research(page).getByRole("button", { name: "Start research", exact: true }).click();
    await expect(research(page).getByRole("heading", { name: "Review sources" })).toBeVisible();
    expect(await page.evaluate((key) => localStorage.getItem(key), stored)).toBe(before);
    expect(requests).toHaveLength(2);
    expect(requests[1]).toContain('"allowed_domains":["admissions.example.edu"]');
    expect(requests.join(" ")).not.toMatch(/PRIVATE_ESSAY_SENTINEL|PRIVATE_NOTES_SENTINEL/);
    expect(await q.countInvocations("school_research_fetch")).toBe(0);
    q.expectNoPageErrors();
});
