/**
 * harperLinter.ts — Harper-specific linting source for CodeMirror.
 *
 * Initializes a WorkerLinter with WASM, calls organizedLints(),
 * and maps Harper Lint objects into the vendored Diagnostic format.
 *
 * Caching strategy (inspired by salsa/incremental compilation):
 * - Each paragraph is a cache entry keyed by its text content.
 * - Only visible (viewport) paragraphs are linted on each debounced run.
 * - Off-screen paragraphs reuse cached results (stale-while-revalidate).
 * - A full-document run fires every FULL_LINT_INTERVAL ms to catch
 *   cross-paragraph rules (e.g. RepeatedWords) and warm off-screen cache.
 * - Cache is LRU-bounded to CACHE_MAX_SIZE entries to prevent unbounded growth.
 */
import { type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { type Dialect, WorkerLinter, SuggestionKind, type Suggestion, type Lint } from "harper.js";
import { slimBinaryInlined } from "harper.js/slimBinaryInlined";
import { linter, forceLinting, type Diagnostic, type Action } from "./lint";
import { lintKindClass } from "./lintKindColor";

const HARPER_DICTIONARY_KEY = "harper-dictionary";
const DEFAULT_DELAY = 300;
const SCROLL_DELAY = 800;
const FULL_LINT_INTERVAL = 30_000;
const CACHE_MAX_SIZE = 200;

type OrganizedLints = Awaited<ReturnType<InstanceType<typeof WorkerLinter>["organizedLints"]>>;

/**
 * FNV-1a 32-bit hash — sync, zero deps, good enough distribution for a cache key.
 * 2^32 output space; collision probability ≈ entries/4B (negligible at CACHE_MAX_SIZE).
 * https://en.wikipedia.org/wiki/Fowler%E2%80%93Noll%E2%80%93Vo_hash_function
 */
export function hashText(text: string): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = (hash * 0x01000193) >>> 0;
    }
    return hash;
}

// LRU cache keyed by FNV-1a hash of paragraph text.
// Insertion order = access order (Map preserves insertion order;
// we delete+re-insert on access to move to "most recently used" position).
const paragraphCache = new Map<number, OrganizedLints>();

let harperInstance: InstanceType<typeof WorkerLinter> | null = null;
let lastFullLintAt = 0;

function getHarper(dialect?: Dialect): InstanceType<typeof WorkerLinter> {
    if (!harperInstance) {
        harperInstance = new WorkerLinter({
            binary: slimBinaryInlined,
            dialect,
        });
    }
    return harperInstance;
}

function cacheGet(hash: number): OrganizedLints | undefined {
    const val = paragraphCache.get(hash);
    if (val !== undefined) {
        // Move to most-recently-used position
        paragraphCache.delete(hash);
        paragraphCache.set(hash, val);
    }
    return val;
}

function cacheSet(hash: number, val: OrganizedLints): void {
    if (paragraphCache.has(hash)) {
        paragraphCache.delete(hash);
    } else if (paragraphCache.size >= CACHE_MAX_SIZE) {
        // Evict least-recently-used (first entry)
        const lru = paragraphCache.keys().next().value;
        if (lru !== undefined) paragraphCache.delete(lru);
    }
    paragraphCache.set(hash, val);
}

/**
 * Reset all module-level state. Exported for testing only.
 * Sets lastFullLintAt to now so the first test run uses incremental mode.
 */
export function resetCache(): void {
    paragraphCache.clear();
    lastFullLintAt = Date.now();
    harperInstance = null;
}

export { lintWithCache };

/** Dispose the current linter (call when dialect changes). */
export function resetHarper(dialect?: Dialect): void {
    if (harperInstance) {
        harperInstance.dispose();
        harperInstance = null;
    }
    paragraphCache.clear();
    lastFullLintAt = 0;
    getHarper(dialect);
}

/** Load user dictionary words from localStorage into Harper. */
export async function loadUserDictionary(): Promise<void> {
    const harper = getHarper();
    try {
        const raw = localStorage.getItem(HARPER_DICTIONARY_KEY);
        if (raw) {
            const words: string[] = JSON.parse(raw);
            if (words.length > 0) {
                await harper.importWords(words);
            }
        }
    } catch {}
}

/** Save a word to the user dictionary and re-lint. */
async function addToDictionary(word: string): Promise<void> {
    const harper = getHarper();
    await harper.importWords([word]);
    // Invalidate all cached paragraphs — spelling results change globally
    paragraphCache.clear();
    try {
        const raw = localStorage.getItem(HARPER_DICTIONARY_KEY);
        const words: string[] = raw ? JSON.parse(raw) : [];
        if (!words.includes(word)) {
            words.push(word);
            localStorage.setItem(HARPER_DICTIONARY_KEY, JSON.stringify(words));
        }
    } catch {}
}

function suggestionToLabel(sug: Suggestion): string {
    const kind = sug.kind();
    if (kind === SuggestionKind.Remove) return "Remove";
    const text = sug.get_replacement_text();
    if (text.trim().length === 0) return "Fix";
    if (kind === SuggestionKind.InsertAfter) return `Insert "${text}"`;
    return `Replace with "${text}"`;
}

const ignoredDiagnostics = new Set<string>();

function diagKey(source: string, from: number, to: number, message: string): string {
    return `${source}:${from}:${to}:${message}`;
}

/**
 * Split the document into paragraphs (separated by blank lines),
 * returning each with its start offset in the full document.
 */
export function splitParagraphs(text: string): Array<{ text: string; offset: number }> {
    const paragraphs: Array<{ text: string; offset: number }> = [];
    const re = /\n\s*\n/g;
    let start = 0;
    let match = re.exec(text);
    while (match !== null) {
        const para = text.slice(start, match.index);
        if (para.trim().length > 0) {
            paragraphs.push({ text: para, offset: start });
        }
        start = match.index + match[0].length;
        match = re.exec(text);
    }
    const last = text.slice(start);
    if (last.trim().length > 0) {
        paragraphs.push({ text: last, offset: start });
    }
    return paragraphs;
}

/**
 * Returns the set of paragraph offsets that overlap the editor viewport.
 */
function visibleParagraphOffsets(
    view: EditorView,
    paragraphs: Array<{ text: string; offset: number }>,
): Set<number> {
    const visible = new Set<number>();
    for (const range of view.visibleRanges) {
        for (const para of paragraphs) {
            const paraEnd = para.offset + para.text.length;
            if (paraEnd >= range.from && para.offset <= range.to) {
                visible.add(para.offset);
            }
        }
    }
    return visible;
}

/**
 * Shift all span offsets in an organizedLints result by a given amount.
 */
export function shiftLints(lints: OrganizedLints, offset: number): OrganizedLints {
    if (offset === 0) return lints;
    const shifted: OrganizedLints = {};
    for (const [linterName, lintList] of Object.entries(lints)) {
        shifted[linterName] = lintList.map((lint: Lint) => {
            const span = lint.span();
            return new Proxy(lint, {
                get(target, prop) {
                    if (prop === "span") {
                        return () => ({ start: span.start + offset, end: span.end + offset });
                    }
                    return (target as unknown as Record<string | symbol, unknown>)[prop];
                },
            }) as Lint;
        });
    }
    return shifted;
}

/**
 * Merge multiple organizedLints results into one.
 */
export function mergeLints(...results: OrganizedLints[]): OrganizedLints {
    const merged: OrganizedLints = {};
    for (const result of results) {
        for (const [linterName, lintList] of Object.entries(result)) {
            if (!merged[linterName]) merged[linterName] = [];
            merged[linterName].push(...lintList);
        }
    }
    return merged;
}

/**
 * Core lint runner with viewport-priority and LRU paragraph caching.
 *
 * Visible paragraphs are always re-checked (cache miss → Harper, hit → free).
 * Off-screen paragraphs use whatever is in cache without re-linting.
 * Every FULL_LINT_INTERVAL ms a full-doc run fires for cross-paragraph rules.
 */
async function lintWithCache(view: EditorView, text: string): Promise<OrganizedLints> {
    const harper = getHarper();
    const now = Date.now();
    const paragraphs = splitParagraphs(text);

    if (now - lastFullLintAt >= FULL_LINT_INTERVAL) {
        const result = await harper.organizedLints(text);
        lastFullLintAt = now;
        // Warm cache for any unseen paragraphs without re-linting already-cached ones
        for (const { text: paraText } of paragraphs) {
            const hash = hashText(paraText);
            if (!paragraphCache.has(hash)) {
                cacheSet(hash, await harper.organizedLints(paraText));
            }
        }
        return result;
    }

    const visibleOffsets = visibleParagraphOffsets(view, paragraphs);
    const results: OrganizedLints[] = [];

    for (const { text: paraText, offset } of paragraphs) {
        const isVisible = visibleOffsets.has(offset);
        let paraResult: OrganizedLints | undefined;

        const hash = hashText(paraText);
        if (isVisible) {
            // Always re-lint visible paragraphs; update cache with fresh result
            paraResult = cacheGet(hash);
            if (!paraResult) {
                paraResult = await harper.organizedLints(paraText);
                cacheSet(hash, paraResult);
            }
        } else {
            // Off-screen: use cached result if available, skip otherwise
            paraResult = cacheGet(hash);
            if (!paraResult) continue;
        }

        results.push(shiftLints(paraResult, offset));
    }

    return mergeLints(...results);
}

/**
 * ViewPlugin that debounces viewport changes and triggers a lint run after
 * SCROLL_DELAY ms of scroll inactivity. Kept separate from the typing debounce
 * so scrolling doesn't reset the typing timer and vice versa.
 */
const scrollLintPlugin = ViewPlugin.fromClass(
    class {
        private timeout = -1;

        update(update: ViewUpdate) {
            if (!update.viewportChanged || update.docChanged) return;
            clearTimeout(this.timeout);
            this.timeout = window.setTimeout(() => {
                forceLinting(update.view);
            }, SCROLL_DELAY);
        }

        destroy() {
            clearTimeout(this.timeout);
        }
    },
);

/** Build the CM6 linter extension powered by Harper. */
export function harperExtension(): Extension {
    return [scrollLintPlugin, linter(
        async (view: EditorView) => {
            const text = view.state.doc.sliceString(0);
            const lints = await lintWithCache(view, text);

            const result = Object.entries(lints).flatMap(([linterName, lintList]) =>
                lintList
                    .map((lint): Diagnostic | null => {
                        const span = lint.span();
                        const msg = lint.message();
                        const key = diagKey(linterName, span.start, span.end, msg);
                        if (ignoredDiagnostics.has(key)) return null;

                        const actions: Action[] = lint.suggestions().map((sug: Suggestion) => ({
                            kind: "suggestion" as const,
                            name:
                                sug.kind() === SuggestionKind.Replace &&
                                sug.get_replacement_text().trim().length > 0
                                    ? sug.get_replacement_text()
                                    : suggestionToLabel(sug),
                            title: suggestionToLabel(sug),
                            apply: (view: EditorView, from: number, to: number) => {
                                if (sug.kind() === SuggestionKind.Remove) {
                                    view.dispatch({
                                        changes: { from, to, insert: "" },
                                        selection: { anchor: from },
                                    });
                                } else if (sug.kind() === SuggestionKind.Replace) {
                                    const replacement = sug.get_replacement_text();
                                    view.dispatch({
                                        changes: { from, to, insert: replacement },
                                        selection: { anchor: from + replacement.length },
                                    });
                                } else if (sug.kind() === SuggestionKind.InsertAfter) {
                                    const replacement = sug.get_replacement_text();
                                    view.dispatch({
                                        changes: { from: to, to, insert: replacement },
                                        selection: { anchor: to + replacement.length },
                                    });
                                }
                            },
                        }));

                        if (lint.lint_kind() === "Spelling") {
                            const word = lint.get_problem_text();
                            actions.push({
                                kind: "dictionary",
                                name: "Add to dictionary",
                                title: `Add "${word}" to your dictionary`,
                                apply: (_view: EditorView) => {
                                    addToDictionary(word);
                                },
                            });
                        }

                        return {
                            from: span.start,
                            to: span.end,
                            source: linterName,
                            severity: "warning",
                            markClass: lintKindClass(lint.lint_kind()),
                            title: lint.lint_kind_pretty(),
                            message: msg,
                            renderMessage: () => {
                                const el = document.createElement("span");
                                el.innerHTML = lint.message_html();
                                return el;
                            },
                            ignore: () => {
                                ignoredDiagnostics.add(key);
                            },
                            actions,
                        };
                    })
                    .filter((d): d is Diagnostic => d !== null),
            );
            return result;
        },
        { delay: DEFAULT_DELAY },
    )];
}
