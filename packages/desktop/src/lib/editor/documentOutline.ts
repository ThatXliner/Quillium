// documentOutline.ts — Heading labels and positions for the active draft.
import { parser } from "@lezer/markdown";

export type OutlineHeading = { from: number; level: number; label: string };

export function getDocumentOutline(doc: string): OutlineHeading[] {
    const headings: OutlineHeading[] = [];
    parser.parse(doc).iterate({
        enter(node) {
            const match = /^(?:ATX|Setext)Heading([1-6])$/.exec(node.name);
            if (!match) return;
            const marks: { from: number; to: number }[] = [];
            node.node.toTree().iterate({
                enter(child) {
                    if (/^(HeaderMark|EmphasisMark|CodeMark|LinkMark|URL)$/.test(child.name)) {
                        marks.push({ from: node.from + child.from, to: node.from + child.to });
                    }
                },
            });
            let label = "";
            let position = node.from;
            for (const mark of marks) {
                label += doc.slice(position, mark.from);
                position = mark.to;
            }
            label += doc.slice(position, node.to);
            headings.push({
                from: node.from,
                level: Number(match[1]),
                label: label.replace(/\s+/g, " ").trim() || "Untitled heading",
            });
        },
    });
    return headings;
}
