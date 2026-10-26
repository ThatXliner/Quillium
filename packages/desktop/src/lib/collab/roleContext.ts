import { Facet } from "@codemirror/state";
import type { CommentScope, LiveRole } from "@quillium/share/collab-contract";
import type * as Y from "yjs";
import { AnnotationIdMap } from "./annotationSchema";
import type { CommentInput } from "./yjsProvider";

export type RoleContext = {
    role: LiveRole;
    text: Y.Text;
    annotations: Y.Map<Y.Map<unknown>>;
    ids: AnnotationIdMap;
    scope: CommentScope;
    send: (command: CommentInput) => Promise<void>;
};
export const roleContext = Facet.define<RoleContext, RoleContext | undefined>({
    combine: (values) => values[0],
});
const scopeIds = new WeakMap<object, AnnotationIdMap>();
export function annotationScopeIds<T>(
    annotations: Y.Map<T>,
    initial?: AnnotationIdMap,
): AnnotationIdMap {
    if (initial) {
        scopeIds.set(annotations, initial);
        return initial;
    }
    let ids = scopeIds.get(annotations);
    if (!ids) {
        ids = new AnnotationIdMap();
        scopeIds.set(annotations, ids);
    }
    return ids;
}
