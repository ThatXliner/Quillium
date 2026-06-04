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

type FormatResult = {
    text: string;
    selection: { from: number; to: number };
};

function selectionText(doc: string, from: number, to: number) {
    return doc.slice(from, to);
}

function wrapSelection(doc: string, from: number, to: number, token: string): FormatResult {
    const selected = selectionText(doc, from, to);
    if (from === to) {
        const insert = `${token}${token}`;
        return {
            text: doc.slice(0, from) + insert + doc.slice(to),
            selection: { from: from + token.length, to: from + token.length },
        };
    }

    const hasWrap =
        selected.startsWith(token) &&
        selected.endsWith(token) &&
        selected.length >= token.length * 2;

    if (hasWrap) {
        const unwrapped = selected.slice(token.length, selected.length - token.length);
        return {
            text: doc.slice(0, from) + unwrapped + doc.slice(to),
            selection: { from, to: from + unwrapped.length },
        };
    }

    const before = doc.slice(Math.max(0, from - token.length), from);
    const after = doc.slice(to, to + token.length);
    if (before === token && after === token) {
        return {
            text: doc.slice(0, from - token.length) + selected + doc.slice(to + token.length),
            selection: { from: from - token.length, to: to - token.length },
        };
    }

    const wrapped = `${token}${selected}${token}`;
    return {
        text: doc.slice(0, from) + wrapped + doc.slice(to),
        selection: { from: from + token.length, to: from + token.length + selected.length },
    };
}

function getLineBlock(doc: string, from: number, to: number) {
    const start = doc.lastIndexOf("\n", Math.max(0, from - 1)) + 1;
    const rawEnd = doc.indexOf("\n", to);
    const end = rawEnd === -1 ? doc.length : rawEnd;
    return { start, end, text: doc.slice(start, end) };
}

function transformLines(
    doc: string,
    from: number,
    to: number,
    transform: (lines: string[]) => string[],
): FormatResult {
    const block = getLineBlock(doc, from, to);
    const nextBlock = transform(block.text.split("\n")).join("\n");
    return {
        text: doc.slice(0, block.start) + nextBlock + doc.slice(block.end),
        selection: {
            from: block.start,
            to: block.start + nextBlock.length,
        },
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

export function applyMarkdownFormat(
    doc: string,
    from: number,
    to: number,
    format: MarkdownFormat,
): FormatResult {
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

export function formatMarkdownSelection(view: EditorView, format: MarkdownFormat) {
    const doc = view.state.doc.toString();
    const { from, to } = view.state.selection.main;
    const result = applyMarkdownFormat(doc, from, to, format);

    view.dispatch({
        changes: {
            from: 0,
            to: doc.length,
            insert: result.text,
        },
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
