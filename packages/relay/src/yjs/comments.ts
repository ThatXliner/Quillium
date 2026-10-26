import { randomUUID } from "node:crypto";
import type { CommentCommand } from "@quillium/share/collab-contract";
import * as Y from "yjs";

function resolveScope(
    doc: Y.Doc,
    command: CommentCommand,
): { text: Y.Text; annotations: Y.Map<unknown> } {
    let text = doc.getText("document");
    let annotations = doc.getMap<unknown>("annotations");
    for (const step of command.scope) {
        const revision = annotations.get(step.annotationId);
        if (!(revision instanceof Y.Map) || revision.get("_type") !== "revision")
            throw new Error("Revision not found");
        const versions = revision.get("versions");
        const version = versions instanceof Y.Map ? versions.get(step.versionId) : undefined;
        if (!(version instanceof Y.Map)) throw new Error("Version not found");
        const childText = version.get("text");
        const childAnnotations = version.get("annotations");
        if (!(childText instanceof Y.Text) || !(childAnnotations instanceof Y.Map))
            throw new Error("Invalid comment scope");
        text = childText;
        annotations = childAnnotations;
    }
    return { text, annotations };
}

export function applyCommentCommand(
    doc: Y.Doc,
    command: CommentCommand,
    author: string,
    origin: unknown,
): void {
    const { text, annotations } = resolveScope(doc, command);
    const message = { message: command.message, author, time: Date.now() };
    if (command.kind === "replyToComment") {
        const node = annotations.get(command.annotationId);
        if (
            !(node instanceof Y.Map) ||
            node.get("_type") !== "comment" ||
            node.get("status") !== "active"
        )
            throw new Error("Comment not found");
        const thread = node.get("thread");
        if (!(thread instanceof Y.Array)) throw new Error("Invalid comment thread");
        doc.transact(() => thread.push([message]), origin);
        return;
    }
    const start = Y.createAbsolutePositionFromRelativePosition(
        Y.decodeRelativePosition(Uint8Array.from(command.start)),
        doc,
    );
    const end = Y.createAbsolutePositionFromRelativePosition(
        Y.decodeRelativePosition(Uint8Array.from(command.end)),
        doc,
    );
    if (!start || !end || start.type !== text || end.type !== text || start.index > end.index)
        throw new Error("Comment selection is no longer available");
    const id = randomUUID();
    doc.transact(() => {
        const node = new Y.Map<unknown>();
        node.set("id", id);
        node.set("_type", "comment");
        node.set("status", "active");
        node.set(
            "startPos",
            Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(text, start.index)),
        );
        node.set(
            "endPos",
            Y.encodeRelativePosition(
                Y.createRelativePositionFromTypeIndex(
                    text,
                    end.index,
                    start.index === end.index ? 0 : -1,
                ),
            ),
        );
        node.set("annotations", new Y.Map());
        const thread = new Y.Array();
        node.set("thread", thread);
        annotations.set(id, node);
        thread.push([message]);
    }, origin);
}
