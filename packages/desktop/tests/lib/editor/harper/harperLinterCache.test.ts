import type { EditorView } from "@codemirror/view";
/**
 * Tests for lintWithCache caching behavior.
 *
 * Mocks harper.js so we can count organizedLints() calls without WASM.
 * Stubs EditorView.visibleRanges to control which paragraphs are "visible".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockOrganizedLints = vi.fn();

vi.mock("harper.js", () => {
    class WorkerLinter {
        organizedLints = mockOrganizedLints;
        dispose = vi.fn();
        importWords = vi.fn();
    }
    return {
        WorkerLinter,
        SuggestionKind: { Remove: "Remove", Replace: "Replace", InsertAfter: "InsertAfter" },
    };
});

vi.mock("harper.js/slimBinaryInlined", () => ({ slimBinaryInlined: "mock-binary" }));
vi.mock("$lib/editor/harper/lint", () => ({ linter: vi.fn() }));
vi.mock("$lib/editor/harper/lintKindColor", () => ({ lintKindClass: vi.fn() }));

// Import after mocks are set up
const { lintWithCache, resetCache } = await import("$lib/editor/harper/harperLinter");

/** Build a minimal EditorView stub with controllable visibleRanges. */
function makeView(visibleRanges: Array<{ from: number; to: number }>): EditorView {
    return { visibleRanges } as unknown as EditorView;
}

/** Make a minimal lint-like object (only span() needed by shiftLints). */
function makeLint(start: number, end: number) {
    return { span: () => ({ start, end }), message: () => "" };
}

function makeResult(start = 0, end = 1) {
    return { Spelling: [makeLint(start, end)] };
}

beforeEach(() => {
    resetCache();
    mockOrganizedLints.mockReset();
    mockOrganizedLints.mockResolvedValue(makeResult());
});

afterEach(() => {
    vi.useRealTimers();
});

describe("lintWithCache — cache hits", () => {
    it("calls organizedLints once for a visible paragraph, then uses cache on second run", async () => {
        const doc = "hello world";
        // Full paragraph is visible
        const view = makeView([{ from: 0, to: doc.length }]);

        // First run: cache miss → Harper called
        await lintWithCache(view, doc);
        expect(mockOrganizedLints).toHaveBeenCalledTimes(1);

        // Second run: cache hit → Harper NOT called again
        mockOrganizedLints.mockClear();
        await lintWithCache(view, doc);
        expect(mockOrganizedLints).toHaveBeenCalledTimes(0);
    });

    it("only re-lints changed paragraphs", async () => {
        const doc = "para one\n\npara two";
        const view = makeView([{ from: 0, to: doc.length }]);

        await lintWithCache(view, doc);
        expect(mockOrganizedLints).toHaveBeenCalledTimes(2);

        // Change only first paragraph
        const doc2 = "para ONE\n\npara two";
        mockOrganizedLints.mockClear();
        await lintWithCache(view, doc2);
        // "para ONE" is new (cache miss), "para two" is cached
        expect(mockOrganizedLints).toHaveBeenCalledTimes(1);
        expect(mockOrganizedLints).toHaveBeenCalledWith("para ONE");
    });
});

describe("lintWithCache — off-screen paragraphs", () => {
    it("skips Harper for off-screen uncached paragraphs", async () => {
        const doc = "visible para\n\noff screen para";
        // Only first paragraph is visible (ends at offset 12)
        const view = makeView([{ from: 0, to: 12 }]);

        await lintWithCache(view, doc);
        // Only visible paragraph linted
        expect(mockOrganizedLints).toHaveBeenCalledTimes(1);
        expect(mockOrganizedLints).toHaveBeenCalledWith("visible para");
    });

    it("uses cached result for off-screen paragraphs without re-linting", async () => {
        const doc = "visible para\n\noff screen para";
        const fullView = makeView([{ from: 0, to: doc.length }]);
        const partialView = makeView([{ from: 0, to: 12 }]);

        // First run: full viewport warms cache for both paragraphs
        await lintWithCache(fullView, doc);
        expect(mockOrganizedLints).toHaveBeenCalledTimes(2);

        // Second run: only first paragraph visible, but second is cached → no Harper call
        mockOrganizedLints.mockClear();
        const result = await lintWithCache(partialView, doc);
        expect(mockOrganizedLints).toHaveBeenCalledTimes(0);
        // Both paragraphs' results should still be present
        expect(result.Spelling).toHaveLength(2);
    });
});

describe("lintWithCache — full-doc interval", () => {
    it("runs full organizedLints on the whole doc when interval has elapsed", async () => {
        vi.useFakeTimers();
        const doc = "para one\n\npara two";
        const view = makeView([{ from: 0, to: doc.length }]);

        // First run is incremental (resetCache sets lastFullLintAt = now)
        await lintWithCache(view, doc);
        mockOrganizedLints.mockClear();

        // Advance time past the full-lint interval
        vi.advanceTimersByTime(30_001);

        // Next run should do a full-doc lint
        await lintWithCache(view, doc);
        expect(mockOrganizedLints).toHaveBeenCalledWith(doc);
    });

    it("does NOT run full-doc lint before interval has elapsed", async () => {
        vi.useFakeTimers();
        const doc = "para one\n\npara two";
        const view = makeView([{ from: 0, to: doc.length }]);

        // Trigger the initial full run
        await lintWithCache(view, doc);
        mockOrganizedLints.mockClear();

        // Only 5 seconds later — should be incremental, not full-doc
        vi.advanceTimersByTime(5_000);
        await lintWithCache(view, doc);
        // Full doc string should NOT be passed (only paragraph texts or nothing)
        const calls = mockOrganizedLints.mock.calls.map((c) => c[0]);
        expect(calls).not.toContain(doc);
    });
});

describe("lintWithCache — LRU eviction", () => {
    it("evicts least-recently-used entry when cache exceeds max size", async () => {
        const CACHE_MAX_SIZE = 200;
        const view = makeView([{ from: 0, to: 1_000_000 }]);

        // Fill cache to max — paragraph 0 is inserted first (LRU)
        for (let i = 0; i < CACHE_MAX_SIZE; i++) {
            await lintWithCache(view, `paragraph ${i}`);
        }

        // Insert one more unique entry to push paragraph 0 out
        await lintWithCache(view, "paragraph overflow");

        mockOrganizedLints.mockClear();

        // paragraph 0 was evicted → cache miss → Harper should be called
        await lintWithCache(view, "paragraph 0");
        expect(mockOrganizedLints).toHaveBeenCalledWith("paragraph 0");
    });

    it("recently accessed entries survive eviction", async () => {
        const CACHE_MAX_SIZE = 200;
        const view = makeView([{ from: 0, to: 1_000_000 }]);

        // Fill to max — paragraph 0 is LRU
        for (let i = 0; i < CACHE_MAX_SIZE; i++) {
            await lintWithCache(view, `paragraph ${i}`);
        }

        // Re-access paragraph 0 to bump it to MRU position
        await lintWithCache(view, "paragraph 0");

        // Insert one more — now paragraph 1 is LRU and gets evicted
        await lintWithCache(view, "paragraph overflow");

        mockOrganizedLints.mockClear();

        // paragraph 0 was recently accessed → still in cache → no Harper call
        await lintWithCache(view, "paragraph 0");
        expect(mockOrganizedLints).toHaveBeenCalledTimes(0);
    });
});
