import { expect, test } from "@playwright/test";
import { installTauriMock } from "./utils";

test("inspect accepted AI wording and writer edits in authorship playback", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await page.evaluate(async () => {
        const tauri = (
            window as unknown as {
                __TAURI_INTERNALS__: { invoke: (cmd: string, args: unknown) => Promise<unknown> };
            }
        ).__TAURI_INTERNALS__;
        const original = tauri.invoke;
        const events = [
            { origin: "type", from: 0, to: 0, insert: "My words. " },
            { origin: "ai-revision", from: 10, to: 10, insert: "AI words." },
            { origin: "type", from: 13, to: 18, insert: "phrase" },
            { origin: "paste", from: 20, to: 20, insert: " pasted" },
        ].map((change, index) => ({
            id: index + 1,
            createdAt: index + 1,
            eventType: "doc_change",
            payload: JSON.stringify({
                type: "doc_change",
                changes: [{ from: change.from, to: change.to, insert: change.insert }],
                provenance: { origin: change.origin },
                selection: { ranges: [{ anchor: 0, head: 0 }], main: 0 },
            }),
        }));
        tauri.invoke = async (cmd, args) => {
            if (cmd === "cmd_list_draft_events") return events;
            if (cmd === "cmd_list_snapshots") return [];
            return original(cmd, args);
        };
        // Vite runtime imports intentionally address app modules directly.
        // @ts-expect-error browser-only Vite URL
        const stores = await import("/src/lib/stores.ts");
        stores.currentDraftId.set("draft-1");
        stores.currentDocumentId.set("doc-1");
        stores.currentDocumentTitle.set("Origin example");
        // @ts-expect-error browser-only Vite URL
        const { default: posthog } = await import("/src/lib/posthog.ts");
        posthog.init("phc_test", {
            api_host: "http://127.0.0.1:9",
            disable_session_recording: true,
        });
        posthog.featureFlags.override({ "authorship-provenance": true }, true);
        // @ts-expect-error browser-only Vite URL
        const { goToAuthorship } = await import("/src/lib/navigation.ts");
        await goToAuthorship();
    });
    await expect(page.locator(".provenance-preview .cm-content")).toContainText(
        "My words. AI phrase. pasted",
    );
    await page.getByRole("checkbox", { name: "Show text origin" }).check();
    await expect(page.locator(".provenance-preview .cm-text-origin-ai")).toHaveText(["AI ", "."]);
    await expect(page.locator(".provenance-preview .cm-text-origin-edited-ai")).toHaveText(
        "phrase",
    );
    await expect(page.locator(".provenance-preview .cm-text-origin-unknown")).toHaveText(" pasted");
    await expect(
        page.getByText("Text origin is unavailable for this history. No wording has been labeled."),
    ).toHaveCount(0);
    await page.screenshot({ path: "/tmp/quillium-text-origin.png", fullPage: true });
    await page.getByRole("checkbox", { name: "Show text origin" }).uncheck();
    await expect(page.locator(".provenance-preview .cm-text-origin-ai")).toHaveCount(0);
});
