/**
 * harperLinter.ts — Harper-specific linting source for CodeMirror.
 *
 * Initializes a WorkerLinter with WASM, calls organizedLints(),
 * and maps Harper Lint objects into the vendored Diagnostic format.
 */
import type { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { type Dialect, WorkerLinter, SuggestionKind, type Suggestion, type Lint } from "harper.js";
import { slimBinaryInlined } from "harper.js/slimBinaryInlined";
import { linter, type Diagnostic, type Action } from "./lint";
import { lintKindClass } from "./lintKindColor";

const HARPER_DICTIONARY_KEY = "harper-dictionary";
const DEFAULT_DELAY = 750;

let harperInstance: InstanceType<typeof WorkerLinter> | null = null;

function getHarper(dialect?: Dialect): InstanceType<typeof WorkerLinter> {
    if (!harperInstance) {
        harperInstance = new WorkerLinter({
            binary: slimBinaryInlined,
            dialect,
        });
    }
    return harperInstance;
}

/** Dispose the current linter (call when dialect changes). */
export function resetHarper(dialect?: Dialect): void {
    if (harperInstance) {
        harperInstance.dispose();
        harperInstance = null;
    }
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

/** Build the CM6 linter extension powered by Harper. */
export function harperExtension(): Extension {
    return linter(
        async (view: EditorView) => {
            const harper = getHarper();
            const text = view.state.doc.sliceString(0);
            const lints = await harper.organizedLints(text);

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
    );
}
