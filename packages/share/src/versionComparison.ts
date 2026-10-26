/**
 * versionComparison.ts — Content-only comparison for revision versions.
 *
 * Revision documents contain Markdown source while annotation state is stored
 * separately. These helpers discard Markdown syntax and compare only the text
 * a reader would perceive.
 */
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

type MarkdownNode = {
    type: string;
    value?: string;
    alt?: string | null;
    children?: MarkdownNode[];
};

const markdownParser = unified().use(remarkParse).use(remarkGfm);
const INLINE_CONTAINERS = new Set([
    "delete",
    "emphasis",
    "heading",
    "link",
    "linkReference",
    "paragraph",
    "strong",
]);

function nodeText(node: MarkdownNode): string {
    if (node.type === "definition" || node.type === "footnoteDefinition") return "";
    if (node.type === "footnoteReference" || node.type === "thematicBreak") return "";
    if (node.type === "image" || node.type === "imageReference") return node.alt ?? "";
    if (node.type === "break") return "\n";
    if (node.type === "html") return (node.value ?? "").replace(/<[^>]*>/g, " ");
    if (node.value !== undefined) return node.value;

    const separator = INLINE_CONTAINERS.has(node.type) ? "" : "\n";
    return (node.children ?? []).map(nodeText).join(separator);
}

export function markdownTextContent(markdown: string): string {
    const tree = markdownParser.parse(markdown) as MarkdownNode;
    return nodeText(tree).replace(/\s+/g, " ").trim();
}

export function hasIdenticalTextContent(current: string, previous: string): boolean {
    // TODO(performance): If large-document comparisons become measurable, split normalized
    // document content into a Merkle tree and compare cached subtree hashes instead of
    // reparsing both complete strings on each revision update.
    return markdownTextContent(current) === markdownTextContent(previous);
}

export function hasIdenticalPreviousVersion(
    versions: readonly string[],
    activeIndex: number,
): boolean {
    if (activeIndex <= 0 || activeIndex >= versions.length) return false;
    return hasIdenticalTextContent(versions[activeIndex], versions[activeIndex - 1]);
}
