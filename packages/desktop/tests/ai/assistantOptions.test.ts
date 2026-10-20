import {
    defaultAssistantOptions,
    loadAssistantOptions,
    saveAssistantOptions,
} from "$lib/ai/assistantOptions";
import { beforeEach, expect, it } from "vitest";

beforeEach(() => localStorage.clear());

it("keeps conversation permissions independent and preserves an empty set", () => {
    saveAssistantOptions("a", { requestedActions: [], responseLength: "brief", readers: true });
    saveAssistantOptions("b", {
        requestedActions: ["suggestion"],
        responseLength: "detailed",
        readers: false,
    });
    expect(loadAssistantOptions("a")).toEqual({
        requestedActions: [],
        responseLength: "brief",
        readers: true,
    });
    expect(loadAssistantOptions("b").requestedActions).toEqual(["suggestion"]);
    expect(loadAssistantOptions("new")).toEqual(defaultAssistantOptions());
});

it("does not re-enable tools when stored settings are malformed", () => {
    localStorage.setItem(
        "quillium-assistant:broken",
        JSON.stringify({ requestedActions: ["unknown"] }),
    );
    expect(loadAssistantOptions("broken").requestedActions).toEqual([]);
});

it("carries conversation choices into a new path without overriding its own saved choices", () => {
    saveAssistantOptions("source", {
        requestedActions: ["comment"],
        responseLength: "brief",
        readers: true,
    });
    expect(loadAssistantOptions("branch", "source").requestedActions).toEqual(["comment"]);
    saveAssistantOptions("branch", {
        requestedActions: [],
        responseLength: "detailed",
        readers: false,
    });
    expect(loadAssistantOptions("branch", "source").requestedActions).toEqual([]);
});
