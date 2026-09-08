import { expect, test } from "@playwright/test";
import { QuilliumPage } from "./QuilliumPage";

test("College overlap is an editable Feedback action that creates linked, undoable comments", async ({
    page,
}) => {
    const prose = "I organized the community garden and taught new volunteers to plant seeds.";
    const quote = "organized the community garden";
    const q = new QuilliumPage(page, {
        apiKey: "fixture-key",
        initialDoc: prose,
        settings: { editorMode: "plain" },
        snapshots: [
            {
                id: 100,
                draftId: "draft-test-3",
                tabId: "tab-test-3",
                upToEventId: 100,
                createdAt: 0,
                label: "Source essay fixture",
                doc: prose,
            },
        ],
    });
    const requests: string[] = [];
    await page.route("https://api.openai.com/**", async (route) => {
        requests.push(route.request().postData() ?? "");
        const sourceTabId = await page
            .getByRole("tab", { name: /PIQ 7/ })
            .getAttribute("data-tab-id");
        const output = JSON.stringify({
            findings: [
                {
                    targetQuote: quote,
                    comment:
                        "Both responses retell organizing the garden. Could this essay focus on a different decision so the reader learns something new?",
                    sourceTabId,
                    sourceQuote: quote,
                    sourceFrom: prose.indexOf(quote),
                    sourceTo: prose.indexOf(quote) + quote.length,
                },
            ],
        });
        await route.fulfill({
            contentType: "application/json",
            body: JSON.stringify({
                id: "resp_overlap",
                object: "response",
                created_at: 1,
                model: "gpt-5.6-sol",
                status: "completed",
                output: [
                    {
                        id: "msg_overlap",
                        type: "message",
                        role: "assistant",
                        status: "completed",
                        content: [{ type: "output_text", text: output, annotations: [] }],
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
    await q.init();
    await expect(page.locator("#ai-tab-college")).toHaveCount(0);
    await page.locator("#ai-tab-feedback").click();
    await expect(
        page.getByRole("button", { name: "Check overlap with other essays", exact: true }),
    ).toHaveCount(0);
    await page.locator('button[aria-label="AI Settings"]:visible').last().click();
    await page
        .getByRole("region", { name: "College applications setup" })
        .getByRole("button", { name: "UC PIQ", exact: true })
        .click();
    const college = page.locator('[data-panel-id="college"]');
    await college.getByRole("checkbox", { name: /PIQ 1/ }).check();
    await college.getByRole("checkbox", { name: /PIQ 7/ }).check();
    await college.getByRole("button", { name: "Create 2 essay tabs" }).click();
    await expect(page.getByRole("tab", { name: /PIQ 1/ })).toBeVisible();
    const firstHeading = await q.cmText();
    await q.typeInEditor(`${firstHeading}\n${prose}`);
    await page
        .getByRole("toolbar", { name: "Sidebar panels" })
        .last()
        .getByRole("button", { name: "Feedback (⌘⇧2)", exact: true })
        .click();
    const action = page.getByRole("button", {
        name: "Check overlap with other essays",
        exact: true,
    });
    await expect(action).toBeVisible();
    await action.click();
    const picker = page.getByRole("dialog", { name: "Check essay overlap" });
    await expect(picker.getByRole("checkbox", { name: /PIQ 7/ })).toBeChecked();
    expect(requests).toHaveLength(0);
    await picker.getByRole("checkbox", { name: /PIQ 7/ }).uncheck();
    await expect(picker.getByRole("button", { name: "Check overlap", exact: true })).toBeDisabled();
    await picker.getByRole("checkbox", { name: /PIQ 7/ }).check();
    await page.setViewportSize({ width: 320, height: 600 });
    await expect.poll(async () => (await picker.boundingBox())!.width).toBeLessThanOrEqual(288);
    await picker.getByRole("button", { name: "Check overlap", exact: true }).click({ trial: true });
    await page.screenshot({
        path: "/tmp/quillium-college-sections-overlap-narrow.png",
        animations: "disabled",
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(picker.getByRole("button", { name: "Check overlap", exact: true })).toBeEnabled();
    await page.screenshot({
        path: "/tmp/quillium-college-sections-overlap.png",
        animations: "disabled",
    });
    await picker.getByRole("button", { name: "Check overlap", exact: true }).click();
    const link = page.getByRole("button", { name: "Supporting passage ↗", exact: true });
    await expect(link).toBeVisible();
    expect(requests).toHaveLength(1);
    await expect(page.getByRole("tab", { name: /PIQ 1/ })).toHaveAttribute("aria-selected", "true");
    expect(await q.cmText()).toContain(prose);
    await q.editor.click();
    await q.undo();
    await expect(link).toHaveCount(0);
    expect(await q.cmText()).toContain(prose);
    await q.editor.click();
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(link).toBeVisible();
    await link.click();
    await expect(page.getByRole("tab", { name: /PIQ 7/ })).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(quote);
    q.expectNoPageErrors();
});
