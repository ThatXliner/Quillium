import { EditorSelection, Prec } from "@codemirror/state";
import { type EditorView, keymap } from "@codemirror/view";

export type MarkdownFormat =
    | "bold"
    | "italic"
    | "strikethrough"
    | "code"
    | "heading1"
    | "heading2"
    | "bulletList"
    | "numberedList"
    | "blockquote";

// A surgical edit: replace [from, to) with `insert`. Insertions have from === to.
type Change = { from: number; to: number; insert: string };

type FormatResult = {
    // The exact, minimal edits this format makes. We dispatch these directly
    // instead of replacing the whole document, so untouched text keeps its
    // positions and annotation ranges remap cleanly (see formatMarkdownSelection).
    changes: Change[];
    selection: { from: number; to: number };
};

// Apply changes to a doc string. Used only by callers/tests that want the
// resulting text; the editor dispatches `changes` directly. Changes must be
// sorted ascending and non-overlapping (every builder below produces them so).
function applyChanges(doc: string, changes: Change[]): string {
    let out = "";
    let cursor = 0;
    for (const change of changes) {
        out += doc.slice(cursor, change.from) + change.insert;
        cursor = change.to;
    }
    return out + doc.slice(cursor);
}

function selectionText(doc: string, from: number, to: number) {
    return doc.slice(from, to);
}

function wrapSelection(doc: string, from: number, to: number, token: string): FormatResult {
    const selected = selectionText(doc, from, to);
    const len = token.length;

    if (from === to) {
        // Insert an empty pair and place the cursor between the tokens.
        return {
            changes: [{ from, to, insert: `${token}${token}` }],
            selection: { from: from + len, to: from + len },
        };
    }

    const hasInnerWrap =
        selected.startsWith(token) && selected.endsWith(token) && selected.length >= len * 2;

    if (hasInnerWrap) {
        // Strip the tokens sitting just inside the selection: two small deletes.
        return {
            changes: [
                { from, to: from + len, insert: "" },
                { from: to - len, to, insert: "" },
            ],
            selection: { from, to: to - len * 2 },
        };
    }

    const before = doc.slice(Math.max(0, from - len), from);
    const after = doc.slice(to, to + len);
    if (before === token && after === token) {
        // Strip the tokens sitting just outside the selection: two small deletes.
        return {
            changes: [
                { from: from - len, to: from, insert: "" },
                { from: to, to: to + len, insert: "" },
            ],
            selection: { from: from - len, to: to - len },
        };
    }

    // Wrap: insert a token before and after the selection. The selected text
    // itself is never part of any change, so annotations on it stay intact.
    return {
        changes: [
            { from, to: from, insert: token },
            { from: to, to: to, insert: token },
        ],
        selection: { from: from + len, to: to + len },
    };
}

function getLineBlock(doc: string, from: number, to: number) {
    const start = doc.lastIndexOf("\n", Math.max(0, from - 1)) + 1;
    const rawEnd = doc.indexOf("\n", to);
    const end = rawEnd === -1 ? doc.length : rawEnd;
    return { start, end, text: doc.slice(start, end) };
}

// Build per-line changes by comparing each old line to its transformed line.
// Only the differing prefix/suffix of each line is replaced, so any annotation
// in the unchanged middle of a line survives. Lines that don't change emit no
// change at all.
function transformLines(
    doc: string,
    from: number,
    to: number,
    transform: (lines: string[]) => string[],
): FormatResult {
    const block = getLineBlock(doc, from, to);
    const oldLines = block.text.split("\n");
    const newLines = transform(oldLines);

    const changes: Change[] = [];
    let lineStart = block.start;
    let newBlockLen = 0;
    for (let i = 0; i < oldLines.length; i++) {
        const oldLine = oldLines[i];
        const newLine = newLines[i];
        if (oldLine !== newLine) {
            const change = diffLine(lineStart, oldLine, newLine);
            if (change) changes.push(change);
        }
        newBlockLen += newLine.length + (i < oldLines.length - 1 ? 1 : 0);
        lineStart += oldLine.length + 1; // +1 for the "\n" separator
    }

    return {
        changes,
        selection: { from: block.start, to: block.start + newBlockLen },
    };
}

// Reduce a single line's edit to the smallest replaced span by stripping the
// shared prefix and suffix. `lineStart` is the line's offset in the document.
function diffLine(lineStart: number, oldLine: string, newLine: string): Change | null {
    let start = 0;
    const maxStart = Math.min(oldLine.length, newLine.length);
    while (start < maxStart && oldLine[start] === newLine[start]) start++;

    let oldEnd = oldLine.length;
    let newEnd = newLine.length;
    while (oldEnd > start && newEnd > start && oldLine[oldEnd - 1] === newLine[newEnd - 1]) {
        oldEnd--;
        newEnd--;
    }

    if (start === oldEnd && start === newEnd) return null;
    return {
        from: lineStart + start,
        to: lineStart + oldEnd,
        insert: newLine.slice(start, newEnd),
    };
}

function toggleHeading(doc: string, from: number, to: number, level: 1 | 2): FormatResult {
    const prefix = `${"#".repeat(level)} `;
    return transformLines(doc, from, to, (lines) => {
        const nonBlank = lines.filter((line) => line.trim().length > 0);
        const allTarget = nonBlank.length > 0 && nonBlank.every((line) => line.startsWith(prefix));

        return lines.map((line) => {
            if (!line.trim()) return line;
            if (allTarget) return line.slice(prefix.length);
            const stripped = line.replace(/^#{1,6}\s+/, "");
            return `${prefix}${stripped}`;
        });
    });
}

function togglePrefixedLines(
    doc: string,
    from: number,
    to: number,
    matcher: RegExp,
    addPrefix: (line: string, index: number) => string,
    removePrefix: (line: string) => string,
): FormatResult {
    return transformLines(doc, from, to, (lines) => {
        const nonBlank = lines.filter((line) => line.trim().length > 0);
        const allPrefixed = nonBlank.length > 0 && nonBlank.every((line) => matcher.test(line));

        let itemIndex = 0;
        return lines.map((line) => {
            if (!line.trim()) return line;
            if (allPrefixed) return removePrefix(line);
            const next = addPrefix(line, itemIndex);
            itemIndex += 1;
            return next;
        });
    });
}

function buildFormat(doc: string, from: number, to: number, format: MarkdownFormat): FormatResult {
    switch (format) {
        case "bold":
            return wrapSelection(doc, from, to, "**");
        case "italic":
            return wrapSelection(doc, from, to, "_");
        case "strikethrough":
            return wrapSelection(doc, from, to, "~~");
        case "code":
            return wrapSelection(doc, from, to, "`");
        case "heading1":
            return toggleHeading(doc, from, to, 1);
        case "heading2":
            return toggleHeading(doc, from, to, 2);
        case "bulletList":
            return togglePrefixedLines(
                doc,
                from,
                to,
                /^-\s+/,
                (line) => `- ${line.replace(/^-\s+/, "")}`,
                (line) => line.replace(/^-\s+/, ""),
            );
        case "numberedList":
            return togglePrefixedLines(
                doc,
                from,
                to,
                /^\d+\.\s+/,
                (line, index) => `${index + 1}. ${line.replace(/^\d+\.\s+/, "")}`,
                (line) => line.replace(/^\d+\.\s+/, ""),
            );
        case "blockquote":
            return togglePrefixedLines(
                doc,
                from,
                to,
                /^>\s+/,
                (line) => `> ${line.replace(/^>\s+/, "")}`,
                (line) => line.replace(/^>\s+/, ""),
            );
    }
}

// Returns the surgical changes plus the resulting document text. The editor
// dispatches `changes`; callers/tests that want the final string use `text`.
export function applyMarkdownFormat(
    doc: string,
    from: number,
    to: number,
    format: MarkdownFormat,
): FormatResult & { text: string } {
    const result = buildFormat(doc, from, to, format);
    return { ...result, text: applyChanges(doc, result.changes) };
}

export function formatMarkdownSelection(view: EditorView, format: MarkdownFormat) {
    const doc = view.state.doc.toString();
    const { from, to } = view.state.selection.main;
    const result = buildFormat(doc, from, to, format);

    view.dispatch({
        changes: result.changes,
        selection: EditorSelection.range(result.selection.from, result.selection.to),
        scrollIntoView: true,
        userEvent: "input",
    });
    view.focus();
    return true;
}

function runFormat(format: MarkdownFormat) {
    return (view: EditorView) => formatMarkdownSelection(view, format);
}

export const markdownFormattingKeymap = Prec.high(
    keymap.of([
        { key: "Mod-b", run: runFormat("bold"), preventDefault: true },
        { key: "Mod-i", run: runFormat("italic"), preventDefault: true },
        { key: "Mod-Alt-1", run: runFormat("heading1"), preventDefault: true },
        { key: "Mod-Alt-2", run: runFormat("heading2"), preventDefault: true },
    ]),
);
