import { describe, it, expect } from "vitest";
import { renderMarkdown } from "$lib/ai/utils";

describe("renderMarkdown", () => {
    it("renders **bold** as <strong>", async () => {
        const html = await renderMarkdown("**bold**");
        expect(html).toContain("<strong>bold</strong>");
    });

    it("renders *italic* as <em>", async () => {
        const html = await renderMarkdown("*italic*");
        expect(html).toContain("<em>italic</em>");
    });

    it("renders # Heading as <h1>", async () => {
        const html = await renderMarkdown("# Heading");
        expect(html).toContain("<h1>");
    });

    it("renders links as <a> with href", async () => {
        const html = await renderMarkdown("[link text](https://example.com)");
        expect(html).toContain('<a href="https://example.com"');
        expect(html).toContain("link text");
    });

    it("renders inline `code` as <code>", async () => {
        const html = await renderMarkdown("inline `code` here");
        expect(html).toContain("<code>code</code>");
    });

    it("wraps plain text in <p>", async () => {
        const html = await renderMarkdown("Hello world");
        expect(html).toContain("<p>Hello world</p>");
    });

    it("strips <script> tags (XSS)", async () => {
        const html = await renderMarkdown("<script>alert(1)</script>");
        expect(html).not.toContain("<script>");
    });

    it("strips onerror attributes (XSS)", async () => {
        const html = await renderMarkdown("<img src=x onerror=alert(1)>");
        expect(html.toLowerCase()).not.toContain("onerror");
    });

    it("renders ~~strikethrough~~ as <del> (GFM)", async () => {
        const html = await renderMarkdown("~~strikethrough~~");
        expect(html).toContain("<del>strikethrough</del>");
    });

    it("renders fenced code blocks as <pre><code>", async () => {
        const html = await renderMarkdown("```\nconsole.log(1)\n```");
        expect(html).toContain("<pre>");
        expect(html).toContain("<code>");
    });

    it("renders unordered lists as <ul> with <li>", async () => {
        const html = await renderMarkdown("- item1\n- item2");
        expect(html).toContain("<ul>");
        expect(html).toContain("<li>");
    });

    it("returns empty string for empty input", async () => {
        const html = await renderMarkdown("");
        expect(html.trim()).toBe("");
    });
});
