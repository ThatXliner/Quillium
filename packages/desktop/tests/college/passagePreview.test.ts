import { ReadonlyThreadMessage, serializePassageLink } from "@quillium/share";
import { cleanup, render } from "@testing-library/svelte";
import { afterEach, expect, it } from "vitest";

afterEach(cleanup);

it("read-only comments show source prose instead of encoded desktop link data", () => {
    const quote = "The garden (and its volunteers) grew.";
    const suffix = serializePassageLink({
        documentId: "document-1",
        tabId: "tab-2",
        draftId: "draft-2",
        from: 0,
        to: quote.length,
        quote,
        fingerprint: "12345678-abcdef00",
    });
    const { container } = render(ReadonlyThreadMessage, {
        message: { author: "AI", time: 0, message: `Consider a different example.\n${suffix}` },
    });
    expect(container.textContent).toContain("Consider a different example.");
    expect(container.textContent).toContain(quote);
    expect(container.textContent).not.toContain("quillium-passage");
    expect(container.querySelector("a")).toBeNull();
});
