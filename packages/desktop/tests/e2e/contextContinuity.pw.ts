// Exercises the real Chat transport and annotation reply path with deterministic provider output.
import { type Page, expect, test } from "@playwright/test";
import { QuilliumPage } from "./QuilliumPage";

function responseStream(id: string, text?: string, call?: { name: string; input: object }): string {
    const item = call
        ? {
              type: "function_call",
              id: `fc_${id}`,
              call_id: `call_${id}`,
              name: call.name,
              arguments: JSON.stringify(call.input),
              status: "completed",
          }
        : { type: "message", id: `msg_${id}`, role: "assistant", status: "completed" };
    return [
        {
            type: "response.created",
            response: { id: `resp_${id}`, created_at: 1, model: "gpt-5.6-sol" },
        },
        { type: "response.output_item.added", output_index: 0, item },
        ...(call ? [] : [{ type: "response.output_text.delta", item_id: item.id, delta: text }]),
        { type: "response.output_item.done", output_index: 0, item },
        {
            type: "response.completed",
            response: { usage: { input_tokens: 100, output_tokens: 20 } },
        },
    ]
        .map((event) => `data: ${JSON.stringify(event)}\n\n`)
        .join("");
}

const feedback = (page: Page) => page.locator('[data-panel-id="feedback"]');

async function sendFeedback(page: Page, text: string): Promise<void> {
    if (!(await feedback(page).isVisible())) await page.locator("#ai-tab-feedback").click();
    await feedback(page).getByPlaceholder("Ask for specific feedback...").fill(text);
    await feedback(page).getByRole("button", { name: "Send", exact: true }).click();
}

test("Feedback reconsiders draft edits and the latest annotation qualification without pasted context", async ({
    page,
}) => {
    const draft = "The garden improved our neighborhood.";
    const withdrawal = `${"The original criticism requires a careful distinction. ".repeat(9)}I withdraw the evidence concern; only the timeline remains unclear.`;
    const q = new QuilliumPage(page, { apiKey: "fixture-key", initialDoc: draft });
    q.capturePageErrors();
    const requests: Array<Record<string, unknown>> = [];
    let phase = "feedback";
    await page.route("https://api.openai.com/**", async (route) => {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        requests.push(body);
        let output: string;
        if (phase === "feedback") {
            phase = "thread";
            output = responseStream("feedback", undefined, {
                name: "createComment",
                input: {
                    targetText: draft,
                    comment: "The evidence is missing. What changed for the neighborhood?",
                },
            });
        } else if (phase === "thread") {
            expect(JSON.stringify(body)).toContain("I added the harvest figures");
            phase = "reconsider";
            output = responseStream("thread", withdrawal);
        } else if (phase === "reconsider") {
            expect(JSON.stringify(body)).toContain("The harvest doubled in 2025.");
            expect(JSON.stringify(body.tools)).toContain("readAnnotationThread");
            phase = "list";
            output = responseStream("list", undefined, {
                name: "listAnnotationThreads",
                input: { query: "evidence", offset: 0 },
            });
        } else if (phase === "list") {
            const items = body.input as Array<{ type?: string; output?: string }>;
            const result = items.filter((item) => item.type === "function_call_output").at(-1);
            expect(result?.output).toBeTruthy();
            const listing = JSON.parse(result!.output!);
            const entry = listing.threads[0];
            expect(entry.threadReference).toBeTruthy();
            phase = "read";
            output = responseStream("read", undefined, {
                name: "readAnnotationThread",
                input: { threadReference: entry.threadReference, offset: 0 },
            });
        } else {
            const items = body.input as Array<{ type?: string; output?: string }>;
            const result = items.filter((item) => item.type === "function_call_output").at(-1);
            expect(result?.output).toContain("I withdraw the evidence concern");
            phase = "done";
            output = responseStream(
                "reassessment",
                "The new harvest figures address the evidence concern. Our annotation discussion withdrew that criticism; the timeline still needs clarification.",
            );
        }
        await route.fulfill({ contentType: "text/event-stream", body: output });
    });
    await q.init();
    await page.locator("#ai-tab-feedback").click();
    await expect(feedback(page)).toBeVisible();
    await expect(feedback(page).locator("[data-next-turn-context]")).toContainText(
        "refreshed when you send",
    );
    await sendFeedback(page, "Review the evidence.");
    await expect(
        page
            .getByText("The evidence is missing. What changed for the neighborhood?", {
                exact: true,
            })
            .first(),
    ).toBeVisible();
    await q.editor.click();
    await q.editor.press("End");
    await q.editor.press("ArrowLeft");
    const reply = page.getByPlaceholder("Reply…").filter({ visible: true }).first();
    await reply.fill("I added the harvest figures. Does that address your criticism?");
    await reply.press("Control+Enter");
    // The thread stores writer replies through the actual annotation transaction.
    await expect(
        page
            .getByText("I added the harvest figures. Does that address your criticism?", {
                exact: true,
            })
            .first(),
    ).toBeVisible();
    await page
        .getByRole("button", { name: "Get AI suggestion", exact: true })
        .filter({ visible: true })
        .first()
        .click();
    await expect(page.getByText(withdrawal, { exact: true }).first()).toBeVisible();
    await q.editor.click();
    await q.editor.press("ControlOrMeta+End");
    await q.editor.press("ArrowRight");
    await page.keyboard.type(" The harvest doubled in 2025.");
    await sendFeedback(page, "I addressed your concerns. Please reconsider.");
    await expect(feedback(page)).toContainText(
        "Our annotation discussion withdrew that criticism",
        { timeout: 15000 },
    );
    expect(phase).toBe("done");
    expect(requests).toHaveLength(5);
    // Reading context neither adds a new comment nor changes prose.
    await expect(q.editor).toHaveText(`${draft} The harvest doubled in 2025.`);
    await expect(q.annotationCards).toHaveCount(1);
    await page.screenshot({ path: "test-results/context-continuity.png", fullPage: true });
    q.expectNoPageErrors();
});

test("next-turn preview follows the focused nested editor and returns to the draft", async ({
    page,
}) => {
    const q = new QuilliumPage(page, {
        apiKey: "fixture-key",
        initialStateJson: JSON.stringify({
            doc: "Opening paragraph.\n\nA revision passage.",
            selection: { ranges: [{ anchor: 0, head: 0 }], main: 0 },
            annotationField: {
                1: {
                    id: 1,
                    _type: "revision",
                    status: "active",
                    selection: { ranges: [{ anchor: 20, head: 39 }], main: 0 },
                    thread: [],
                    activeVersionId: "version-a",
                    versions: [
                        {
                            id: "version-a",
                            label: "Original",
                            doc: "A revision passage.",
                            annotationField: {},
                        },
                    ],
                },
            },
        }),
    });
    q.capturePageErrors();
    await q.init();
    await q.editor.getByText("A revision passage.", { exact: true }).click();
    await expect(q.inlineEditor).toBeVisible();
    await q.inlineEditor.click();
    await page.locator("#ai-tab-feedback").click();
    await expect(feedback(page).locator("[data-next-turn-context]")).toContainText(
        "focused revision version",
    );
    await page.locator("[data-context-info-button]").click();
    await expect(page.getByRole("dialog", { name: "AI context details" })).toContainText(
        "Next turn: focused revision version",
    );
    await q.editor.click({ position: { x: 20, y: 8 } });
    if (!(await feedback(page).isVisible())) await page.locator("#ai-tab-feedback").click();
    await expect(feedback(page).locator("[data-next-turn-context]")).toContainText("current draft");
    q.expectNoPageErrors();
});

test("a retrieval roundtrip rejects a nested-editor switch instead of reading a reused annotation ID", async ({
    page,
}) => {
    const doc = "Opening paragraph.\n\nA revision passage.";
    const selection = (from: number, to = from) => ({
        ranges: [{ anchor: from, head: to }],
        main: 0,
    });
    const comment = (message: string) => ({
        id: 1,
        _type: "comment",
        status: "active",
        selection: selection(0, 7),
        thread: [{ author: "AI", message, time: 1 }],
    });
    const q = new QuilliumPage(page, {
        apiKey: "fixture-key",
        initialStateJson: JSON.stringify({
            doc,
            selection: selection(0),
            annotationField: {
                1: comment("ROOT_CONCERN"),
                2: {
                    id: 2,
                    _type: "revision",
                    status: "active",
                    selection: selection(20, 39),
                    thread: [],
                    activeVersionId: "v1",
                    versions: [
                        {
                            id: "v1",
                            doc: "A revision passage.",
                            annotationField: { 1: comment("NESTED_DIFFERENT_CONCERN") },
                        },
                    ],
                },
            },
        }),
    });
    q.capturePageErrors();
    let roundtrip = false;
    await page.route("https://api.openai.com/**", async (route) => {
        const body = route.request().postDataJSON();
        const results = body.input.filter(
            (item: { type: string }) => item.type === "function_call_output",
        );
        if (results.length === 0) {
            await q.editor.getByText("A revision passage.", { exact: true }).click();
            await q.inlineEditor.click();
            await route.fulfill({
                contentType: "text/event-stream",
                body: responseStream("switch-list", undefined, {
                    name: "listAnnotationThreads",
                    input: { offset: 0 },
                }),
            });
        } else {
            const result = JSON.parse(results.at(-1).output);
            expect(result.available).toBe(false);
            expect(result.reason).toBe("context-switched");
            expect(result.threads).toEqual([]);
            expect(JSON.stringify(result)).not.toContain("NESTED_DIFFERENT_CONCERN");
            roundtrip = true;
            await route.fulfill({
                contentType: "text/event-stream",
                body: responseStream(
                    "switch-answer",
                    "The focused editor changed during this turn. Send again to review that version.",
                ),
            });
        }
    });
    await q.init();
    await page.locator("#ai-tab-feedback").click();
    await sendFeedback(page, "Reconsider the discussion.");
    await expect.poll(() => roundtrip).toBe(true);
    if (!(await feedback(page).isVisible())) await page.locator("#ai-tab-feedback").click();
    await expect(feedback(page)).toContainText("The focused editor changed during this turn");
    await expect(q.inlineEditor).toHaveText("A revision passage.");
    q.expectNoPageErrors();
});
