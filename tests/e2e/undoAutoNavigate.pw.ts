/**
 * E2E test for undo auto-navigation (D-96).
 *
 * Scenario:
 *   1. Two Quillium instances connect to the same document via collab
 *   2. Instance A types into a revision's nested editor
 *   3. Instance A switches focus back to the main editor
 *   4. Instance A presses Ctrl-Z
 *   Expected: The nested revision modal OPENS (or inline editor scrolls into view)
 *             and the most-recent nested edit is undone.
 *
 * This test requires:
 *   - A running relay server (per CLAUDE.md constraints)
 *   - Two browser contexts connecting to the same doc
 *
 * Run with:
 *   bun run test:e2e -g "undo auto-navigates"
 *
 * If the two-instance harness is unreliable, defer to manual testing:
 *   1. Open two Quillium windows via `bun run tauri dev`
 *   2. Connect both to the same doc
 *   3. Type in a revision on one window
 *   4. Switch focus to main editor
 *   5. Ctrl-Z
 *   6. Confirm the modal opens or inline revision scrolls into view
 */

import { expect, test, type Page } from "@playwright/test";
import { installTauriMock, getCmText } from "./utils";

test.describe("collab undo auto-navigation", () => {
    test.skip("undo auto-navigates to nested revision", async ({ browser }) => {
        // This test requires a relay server and two-instance coordination.
        // Skipped by default; run manually with -g "undo auto-navigates"
        // after starting the relay server.
        //
        // Implementation outline:
        // 1. Create two browser contexts
        // 2. Navigate both to the same document with collab enabled
        // 3. In context A, create a revision and type in its nested editor
        // 4. In context A, click outside the revision to focus main editor
        // 5. In context A, press Ctrl-Z
        // 6. Assert: revision modal is visible OR inline editor is scrolled into view
        // 7. Assert: the nested edit is undone

        const contextA = await browser.newContext();
        const contextB = await browser.newContext();

        const pageA = await contextA.newPage();
        const pageB = await contextB.newPage();

        await installTauriMock(pageA);
        await installTauriMock(pageB);

        // ... test implementation would go here ...

        await contextA.close();
        await contextB.close();
    });
});
