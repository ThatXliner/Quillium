import { roleContext } from "$lib/collab/roleContext";
import { Facet } from "@codemirror/state";
import { type EditorView, ViewPlugin } from "@codemirror/view";
import { createSubscriber } from "svelte/reactivity";

// Nested editors prepend a stable version scope before the default local-state scope.
export const commentDraftScope = Facet.define<object, object | undefined>({
    combine: (scopes) => scopes[0],
});

class ViewScope {
    // Scope identity is also a WeakMap key; a Svelte proxy would change ownership.
    scope = $state.raw<object>({});
    constructor(scope: object) {
        this.scope = scope;
    }
}

// Explicit notifications keep lazily created draft maps reactive.
class ScopeDrafts {
    readonly values = new Map<number, string>();
    changed = () => {};
    readonly subscribe = createSubscriber((update) => {
        this.changed = update;
        return () => {
            this.changed = () => {};
        };
    });
}

const viewScopes = new WeakMap<EditorView, ViewScope>();
const fallbackScopes = new WeakMap<EditorView, object>();
const scopeDrafts = new WeakMap<object, ScopeDrafts>();
const nestedScopes = new WeakMap<object, Map<number, Map<string, object>>>();

function resolveScope(view: EditorView): object {
    const context = view.state.facet(roleContext);
    const liveScope = context?.isOwner ? undefined : context?.annotations;
    const scope = liveScope ?? view.state.facet(commentDraftScope);
    if (scope) return scope;
    let fallback = fallbackScopes.get(view);
    if (!fallback) {
        fallback = {};
        fallbackScopes.set(view, fallback);
    }
    return fallback;
}

function scopeFor(view: EditorView): ViewScope {
    let scope = viewScopes.get(view);
    if (!scope) {
        scope = new ViewScope(resolveScope(view));
        viewScopes.set(view, scope);
    }
    return scope;
}

function refreshScope(view: EditorView): void {
    const current = scopeFor(view);
    const next = resolveScope(view);
    if (current.scope !== next) current.scope = next;
}

export const commentDraftScopeBridge = ViewPlugin.fromClass(
    class {
        constructor(private readonly view: EditorView) {
            refreshScope(view);
        }
        update(): void {
            refreshScope(this.view);
        }
        destroy(): void {
            refreshScope(this.view);
        }
    },
);

export function getNestedCommentDraftScope(
    parentView: EditorView,
    revisionId: number,
    versionId: string,
): object {
    const parentScope = resolveScope(parentView);
    let revisions = nestedScopes.get(parentScope);
    if (!revisions) {
        revisions = new Map();
        nestedScopes.set(parentScope, revisions);
    }
    let versions = revisions.get(revisionId);
    if (!versions) {
        versions = new Map();
        revisions.set(revisionId, versions);
    }
    let scope = versions.get(versionId);
    if (!scope) {
        scope = {};
        versions.set(versionId, scope);
    }
    return scope;
}

export function getCommentDraftScope(view: EditorView | undefined): object | undefined {
    return view ? scopeFor(view).scope : undefined;
}

function draftsFor(view: EditorView): ScopeDrafts {
    const scope = scopeFor(view).scope;
    let drafts = scopeDrafts.get(scope);
    if (!drafts) {
        drafts = new ScopeDrafts();
        scopeDrafts.set(scope, drafts);
    }
    return drafts;
}

export function getDraft(view: EditorView | undefined, annotationId: number): string {
    if (!view) return "";
    const drafts = draftsFor(view);
    drafts.subscribe();
    return drafts.values.get(annotationId) ?? "";
}

export function setDraft(view: EditorView | undefined, annotationId: number, text: string): void {
    if (!view) return;
    const drafts = draftsFor(view);
    if (text) drafts.values.set(annotationId, text);
    else drafts.values.delete(annotationId);
    drafts.changed();
}

export function clearDraft(view: EditorView | undefined, annotationId: number): void {
    if (view) setDraft(view, annotationId, "");
}
