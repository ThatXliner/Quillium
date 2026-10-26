import { codeMirrorToYjsAnnotation, yjsAnnotationToCodeMirror } from "$lib/collab/annotationSchema";
import { isAnnotationOfType, makeVersion } from "$lib/editor/plugins/annotations/models";
import { EditorSelection } from "@codemirror/state";
import { expect, it } from "vitest";
import * as Y from "yjs";

it.each(["annotation request", "version request", "version author"])(
    "discards malformed %s metadata while preserving the peer revision",
    (field) => {
        const doc = new Y.Doc();
        try {
            const text = doc.getText("document");
            text.insert(0, "Raw words");
            const version = makeVersion({ doc: "Raw words", provenance: "human" });
            const node = codeMirrorToYjsAnnotation(
                {
                    id: 0,
                    _type: "revision",
                    status: "active",
                    selection: EditorSelection.single(0, text.length),
                    thread: [],
                    versions: [version],
                    activeVersionId: version.id,
                },
                text,
                "writer",
                doc,
            );
            doc.getMap("annotations").set("revision", node);
            expect(yjsAnnotationToCodeMirror(node, doc, text, 0)).not.toBeNull();
            if (field === "annotation request") {
                node.set("aiProvenance", { requestId: 42 });
            } else {
                const versions = node.get("versions");
                if (!(versions instanceof Y.Map)) throw new Error("Missing versions");
                const child = versions.get(version.id);
                if (!(child instanceof Y.Map)) throw new Error("Missing version");
                if (field === "version request") child.set("aiProvenance", { requestId: 42 });
                else child.set("provenance", "external");
            }
            const restored = yjsAnnotationToCodeMirror(node, doc, text, 0);
            if (!restored || !isAnnotationOfType(restored, "revision"))
                throw new Error("Revision was lost");
            expect(restored.versions[0].doc).toBe("Raw words");
            expect(restored.aiProvenance).toBeUndefined();
            expect(restored.versions[0].aiProvenance).toBeUndefined();
            expect(restored.versions[0].provenance).toBe(
                field === "version author" ? undefined : "human",
            );
        } finally {
            doc.destroy();
        }
    },
);
