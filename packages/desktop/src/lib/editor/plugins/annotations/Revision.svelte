<script lang="ts">
import { annotationEventBus } from "$lib/events/annotationEventBus";
import posthog from "$lib/posthog";
import { appSettings } from "$lib/settings.svelte";
import { linkAnchor, versionGroups } from "$lib/stores";
import { modalStack } from "$lib/stores";
import Kbd from "$lib/ui/Kbd.svelte";
/**
 * Revision.svelte — Displays a single revision annotation card
 * with multiple named versions, a textarea for quick inline editing,
 * and actions to create/delete versions or expand into a full-screen
 * modal for deep editing (nested annotations, rich undo history).
 *
 * Architecture: the nested editor is a direct viewport onto the
 * parent document's revision range. Edits in the nested editor
 * are translated to parent coordinates via translateAndDispatch()
 * and dispatched to the parent EditorView.
 *
 * External changes to the revision range (e.g. undo or non-atomic
 * typing in the parent editor) are reflected back into the nested
 * editor via Svelte reactivity: when the active revision/version
 * changes, reactive effects update the nested editor's state and
 * document buffer directly to keep it in sync.
 *
 * The nested editor is only destroyed/recreated on version switch.
 * All other changes (typing, undo) are applied as incremental
 * updates/deltas to the existing nested editor instance.
 */
import { EditorView } from "@codemirror/view";
import {
    RevisionCard,
    type RevisionVersionView,
    groupColor as sharedGroupColor,
} from "@quillium/share";
import { ChevronDown, ChevronUp, Link2, PlusIcon, X } from "lucide-svelte";
import { onDestroy, tick } from "svelte";
import { cubicOut } from "svelte/easing";
import { slide } from "svelte/transition";
import {
    type Annotation,
    type GenericAnnotation,
    type Thread as ThreadType,
    annotationField,
    annotationsChanged,
    createNewRevision,
    deleteRevisionVersion,
    isAnnotationOfType,
    setActiveRevisionVersion,
    updateRevisionVersionLabel,
} from ".";
import { NestedEditorController } from "./NestedEditorController";
import Thread from "./Thread.svelte";
import { type VersionState, activeVersionIndex, versionById, versionText } from "./models";
import { type VersionGroupMember, canAddMemberToGroup, groupOfMember } from "./models";
import { previewVersionText } from "./nestedEditor";
import { addVersionToGroup, createVersionGroup, removeVersionFromGroup } from "./versionGroupField";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const modKey = isMac ? "⌘" : "Ctrl";

const {
    revision,
    isActive,
    view,
    remove,
    updateThread,
}: {
    revision: Annotation<"revision">;
    isActive: boolean;
    view: EditorView;
    remove: () => void;
    updateThread: (thread: ThreadType) => void;
} = $props();

const thread = $derived(revision.thread);
const activeVersion = $derived(versionById(revision, revision.activeVersionId));
const activeText = $derived(activeVersion ? versionText(activeVersion) : "");

let isEditorOpen = $state(false);
let userClosedEditor = false;
let nestedEditorFocused = $state(false);

$effect(() => {
    if (isActive) {
        if (!userClosedEditor && appSettings.showNestedEditor) isEditorOpen = true;
    } else {
        isEditorOpen = false;
        userClosedEditor = false;
    }
});

function openEditor() {
    userClosedEditor = false;
    isEditorOpen = true;
}

let nestedEditorHost = $state<HTMLDivElement>();
let activeAnnotation = $state<GenericAnnotation | undefined>(undefined);

const controller = new NestedEditorController(
    view,
    revision.id,
    {
        onUpdate: (_annotations, active) => {
            activeAnnotation = active;
        },
    },
    "flush-on-destroy",
);

function readCurrentRevision(): Annotation<"revision"> | undefined {
    const current = view.state.field(annotationField)[revision.id];
    return current && isAnnotationOfType(current, "revision") ? current : undefined;
}

function readCurrentActiveVersion(): { version: VersionState; versionIndex: number } | undefined {
    const current = readCurrentRevision();
    if (!current) return undefined;
    const versionIndex = activeVersionIndex(current);
    const version = current.versions[versionIndex];
    return version ? { version, versionIndex } : undefined;
}

let cursorArriving = $state(false);
let cursorArrivingTimeout: ReturnType<typeof setTimeout> | undefined;
let pendingFocusPos: number | undefined;

function placeCursorInEditor(editor: EditorView, relPos: number) {
    editor.dispatch({ selection: { anchor: relPos }, scrollIntoView: true });
    editor.focus();
    clearTimeout(cursorArrivingTimeout);
    cursorArriving = false;
    void nestedEditorHost?.offsetWidth;
    cursorArriving = true;
    cursorArrivingTimeout = setTimeout(() => {
        cursorArriving = false;
    }, 650);
}

let showBoundaryHint = $state(false);
let boundaryHintTimeout: ReturnType<typeof setTimeout> | undefined;

// Label editing state
let editingLabelIndex = $state<number | null>(null);
let labelInputValue = $state("");

function startLabelEdit(i: number) {
    editingLabelIndex = i;
    labelInputValue = revision.versions[i]?.label ?? "";
}

function commitLabelEdit() {
    if (editingLabelIndex === null) return;
    const versionId = revision.versions[editingLabelIndex]?.id;
    if (versionId === undefined) {
        editingLabelIndex = null;
        return;
    }
    const trimmed = labelInputValue.trim();
    view.dispatch(
        updateRevisionVersionLabel(view.state, revision.id, versionId, trimmed || undefined),
    );
    editingLabelIndex = null;
}

function cancelLabelEdit() {
    editingLabelIndex = null;
}

// ── Version groups (linking versions across revisions, #268) ────────────────
// A stable per-group color so a linked pill's badge matches its partners
// elsewhere. Keyed by group id hashed into the palette. Linking is the brand
// blue, so the first (common single-group) color is blue-500; the rest are
// distinct categorical hues for telling multiple groups apart.
function groupColor(groupId: string): string {
    return sharedGroupColor(groupId);
}

const allGroups = $derived($versionGroups ?? {});
function memberOf(versionId: string): VersionGroupMember {
    return { revisionId: revision.id, versionId };
}

/**
 * Make this revision the active annotation by moving the editor cursor into its
 * range — but only when it isn't already active. Collapses the "double
 * selection" so any interaction with this card (link, delete, switching the
 * already-active pill) focuses the card you're touching, instead of leaving the
 * panel anchored to whatever the cursor happened to be on.
 */
function focusThisRevision() {
    if (isActive) return;
    view.dispatch({
        selection: { anchor: revision.selection.main.from },
        scrollIntoView: true,
    });
}
// The group a given version belongs to, if any.
function groupForVersion(versionId: string) {
    return groupOfMember(allGroups, memberOf(versionId));
}

const revisionVersionViews = $derived(
    revision.versions.map((version, index): RevisionVersionView => {
        const group = groupForVersion(version.id);
        return {
            id: version.id,
            index,
            label: version.label ?? previewVersionText(version),
            text: versionText(version),
            active: index === activeVersionIndex(revision),
            group: group
                ? {
                      id: group.id,
                      label: group.label,
                      memberCount: group.members.length,
                      color: groupColor(group.id),
                  }
                : undefined,
        };
    }),
);

// Which version's link dropdown is open (-1 = none).
let openLinkMenu = $state<number | null>(null);

// Groups this version is allowed to JOIN: existing groups that don't already
// hold a different version of this same revision, and aren't the version's
// current group.
function joinableGroups(versionId: string) {
    const current = groupForVersion(versionId);
    return Object.values(allGroups).filter(
        (g) => g.id !== current?.id && canAddMemberToGroup(g, memberOf(versionId)),
    );
}

function linkToExistingGroup(versionId: string, groupId: string) {
    view.dispatch(addVersionToGroup(view.state, groupId, memberOf(versionId)));
    openLinkMenu = null;
}
function unlinkVersion(versionId: string) {
    view.dispatch(removeVersionFromGroup(view.state, memberOf(versionId)));
    openLinkMenu = null;
}

// "Link mode": a group needs ≥2 members from DIFFERENT revisions, which the
// inline card can't form alone. So linking is a two-pick flow via a shared
// store: pick an anchor version on one revision, then pick a partner version on
// ANOTHER revision to complete the link. The anchor persists across cards.
function startLink(versionId: string) {
    const existing = groupForVersion(versionId);
    // Picking an already-grouped version anchors on its group (so the next pick
    // joins that group); otherwise anchor on the bare member.
    $linkAnchor = { member: memberOf(versionId), groupId: existing?.id };
    openLinkMenu = null;
}
function completeLink(versionId: string) {
    const anchor = $linkAnchor;
    if (!anchor || anchor.member.revisionId === revision.id) return;
    const partner = memberOf(versionId);
    if (anchor.groupId && allGroups[anchor.groupId]) {
        // Anchor is in a group → just add the partner to it.
        view.dispatch(addVersionToGroup(view.state, anchor.groupId, partner));
    } else {
        // Neither grouped → create a fresh 2-member group.
        const { spec } = createVersionGroup("Linked", [anchor.member, partner]);
        view.dispatch(spec);
    }
    $linkAnchor = null;
    openLinkMenu = null;
}
function cancelLink() {
    $linkAnchor = null;
}
// True for this card's versions while an anchor on ANOTHER revision is waiting.
const linkTargetable = $derived(
    $linkAnchor !== null && $linkAnchor.member.revisionId !== revision.id,
);

$effect(() => {
    return annotationEventBus.on("revision-boundary-nudge", (event) => {
        if (event.revisionId !== revision.id) return;
        showBoundaryHint = true;
        clearTimeout(boundaryHintTimeout);
        boundaryHintTimeout = setTimeout(() => {
            showBoundaryHint = false;
        }, 4000);
    });
});

$effect(() => {
    return annotationEventBus.on("revision-request-modal", (event) => {
        if (event.command.revisionId !== revision.id || event.sourceView !== view) return;
        const cmd = event.command;
        modalStack.push({
            type: "revision",
            revisionId: revision.id,
            parentView: view,
            label: activeVersion ? previewVersionText(activeVersion) : "Revision",
            pendingNestedCommand: {
                type: cmd.type,
                selectionFrom: cmd.selectionFrom,
                selectionTo: cmd.selectionTo,
            },
        });
    });
});

$effect(() => {
    return annotationEventBus.on("nested-annotation-create", (event) => {
        if (event.command.revisionId !== revision.id || event.sourceView !== view) return;
        // If a modal is already open for this exact revision (same ID + same parent view),
        // let that modal handle the event. Must check parentView to avoid ID collisions
        // across nesting levels.
        if (
            $modalStack.some(
                (entry) =>
                    entry.type === "revision" &&
                    entry.revisionId === revision.id &&
                    entry.parentView === view,
            )
        )
            return;
        const cmd = event.command;
        modalStack.push({
            type: "revision",
            revisionId: revision.id,
            parentView: view,
            label: activeVersion ? previewVersionText(activeVersion) : "Revision",
            pendingNestedCommand: {
                type: cmd.type,
                selectionFrom: cmd.selectionFrom,
                selectionTo: cmd.selectionTo,
            },
        });
    });
});

$effect(() => {
    return annotationEventBus.on("revision-focus-request", (event) => {
        if (event.revisionId !== revision.id || event.sourceView !== view) return;
        const relPos = event.relativePos;
        if (appSettings.showNestedEditor) {
            if (isEditorOpen && controller.editor) {
                placeCursorInEditor(controller.editor, relPos);
            } else {
                // Store the pending focus position — the creation $effect
                // will apply it when the editor is ready. We can't use
                // tick() here because the event bus fires synchronously
                // before Svelte's reactive flush, so the editor doesn't
                // exist yet when the first tick() resolves.
                pendingFocusPos = relPos;
                userClosedEditor = false;
                isEditorOpen = true;
            }
        } else {
            modalStack.push({
                type: "revision",
                revisionId: revision.id,
                parentView: view,
                label: activeVersion ? previewVersionText(activeVersion) : "Revision",
                pendingNestedCommand: {
                    type: "cursor",
                    selectionFrom: relPos,
                    selectionTo: relPos,
                },
            });
        }
    });
});

// ⌘E → enter the revision's editor (inline or modal)
$effect(() => {
    return annotationEventBus.on("annotation-enter-editor", (event) => {
        if (event.annotationId !== revision.id) return;
        if (appSettings.showNestedEditor) {
            if (isEditorOpen && controller.editor) {
                controller.editor.focus();
            } else {
                userClosedEditor = false;
                isEditorOpen = true;
            }
        } else {
            modalStack.push({
                type: "revision",
                revisionId: revision.id,
                parentView: view,
                label: activeVersion ? previewVersionText(activeVersion) : "Revision",
            });
        }
    });
});

/**
 * Mount a nested CodeMirror editor for the given version.
 */
function createNestedEditor(versionOverride?: VersionState, versionIndexOverride?: number) {
    if (!nestedEditorHost || controller.editor) return;
    const current = readCurrentActiveVersion();
    const version = versionOverride ?? current?.version;
    const versionIndex =
        versionIndexOverride ?? current?.versionIndex ?? activeVersionIndex(revision);
    if (!version) return;
    controller.create(nestedEditorHost, version, versionIndex);
    controller.applyPendingSelection();
    // Apply pending focus from revision-focus-request that arrived before
    // the editor was created (event bus fires synchronously before Svelte flush).
    if (pendingFocusPos !== undefined && controller.editor) {
        placeCursorInEditor(controller.editor, pendingFocusPos);
        pendingFocusPos = undefined;
    }
    // DEV bridge: expose inline nested EditorViews by revision ID so the
    // screenshot script can retrieve them via window.__inlineEditors__[revisionId].
    if (import.meta.env.DEV && controller.editor) {
        const w = window as unknown as Record<string, unknown>;
        if (!w.__inlineEditors__) w.__inlineEditors__ = {};
        (w.__inlineEditors__ as Record<number, unknown>)[revision.id] = controller.editor;
    }
}

function destroyNestedEditor() {
    // If a modal is open for this revision, it holds the authoritative
    // annotation state. Skip the inline editor's flush to avoid
    // overwriting the modal's annotations with stale (empty) data.
    const modalHasAuthority = $modalStack.some(
        (entry) =>
            entry.type === "revision" &&
            entry.revisionId === revision.id &&
            entry.parentView === view,
    );
    controller.destroy({ skipFlush: modalHasAuthority });
    activeAnnotation = undefined;
    // Clean up DEV bridge
    if (import.meta.env.DEV) {
        const w = window as unknown as Record<string, unknown>;
        const editors = w.__inlineEditors__ as Record<number, unknown> | undefined;
        if (editors) delete editors[revision.id];
    }
}

// Create or destroy the nested editor when the toggle changes.
$effect(() => {
    if (!isEditorOpen) {
        destroyNestedEditor();
        return;
    }
    void activeVersion; // re-run when a version becomes available while open
    tick().then(() => {
        if (!isEditorOpen || !nestedEditorHost?.isConnected) return;
        createNestedEditor();
    });
});

// When the selected version changes, destroy and recreate.
$effect(() => {
    if (!controller.editor || !isEditorOpen) return;
    if (!controller.needsVersionSwitch(revision.activeVersionId)) return;

    destroyNestedEditor();

    tick().then(() => {
        if (!isEditorOpen || !nestedEditorHost?.isConnected) return;
        createNestedEditor();
        if (controller.editor) {
            const end = controller.editor.state.doc.length;
            controller.editor.dispatch({
                selection: { anchor: end },
                scrollIntoView: true,
            });
            controller.editor.focus();
        }
    });
});

// When the modal closes, it flushes nested annotations back into the
// version blob. Detect the flush by comparing the serialized blob —
// needsAnnotationRebuild compares against the mounted snapshot.
// Plan 8.5c-01: In collab mode this is a no-op (observeDeep reconciles live).
$effect(() => {
    const trackedVersion = activeVersion;
    const trackedVersionIndex = activeVersionIndex(revision);
    if (!controller.editor || !isEditorOpen || !trackedVersion) return;
    if (controller.needsVersionSwitch(revision.activeVersionId)) return;
    const current = readCurrentActiveVersion();
    const version = current?.version ?? trackedVersion;
    if (!controller.needsAnnotationRebuild(version)) return;
    controller.destroy({ skipFlush: true });
    activeAnnotation = undefined;
    createNestedEditor(version, current?.versionIndex ?? trackedVersionIndex);
});

// Phase 10: needsCollabModeRebuild $effect removed. Collab mode rebuild
// is no longer needed - nested editors always use local-only mode.

// When a modal for this revision closes and flushes, rebuild the inline
// editor from the flushed version blob. The event fires synchronously
// from onDestroy after the flush dispatch, so view.state already
// contains the flushed data. We skip the inline editor's own flush
// (skipFlush: true) because the modal just wrote the authoritative
// state — flushing the stale inline editor would overwrite it.
$effect(() => {
    return annotationEventBus.on("revision-modal-flushed", (event) => {
        if (event.revisionId !== revision.id || event.sourceView !== view) return;
        if (!controller.editor || !isEditorOpen) return;
        // Read the latest version directly from the parent editor state
        // (already updated by the modal's flush dispatch).
        const rev = view.state.field(annotationField)[revision.id];
        if (!rev || !isAnnotationOfType(rev, "revision")) return;
        const latestVersion = versionById(rev, rev.activeVersionId);
        if (!latestVersion) return;
        // Plan 8.5c-01: In collab mode this is a no-op (observeDeep reconciles live).
        if (!controller.needsAnnotationRebuild(latestVersion)) return;
        // Destroy WITHOUT flushing — the modal already wrote the correct state.
        controller.destroy({ skipFlush: true });
        activeAnnotation = undefined;
        createNestedEditor(latestVersion, activeVersionIndex(rev));
    });
});

// When the version doc changes externally (undo, parent typing), patch
// the nested editor. The controller handles skipping self-originated changes.
$effect(() => {
    const trackedVersion = activeVersion;
    if (!controller.editor) return;
    const current = readCurrentActiveVersion();
    if (current && controller.needsVersionSwitch(current.version.id)) {
        controller.destroy({ skipFlush: true });
        activeAnnotation = undefined;
        createNestedEditor(current.version, current.versionIndex);
        return;
    }
    const externalDoc = current?.version
        ? versionText(current.version)
        : (trackedVersion?.doc ?? "");
    controller.syncFromParent(externalDoc);
});

// ⌘Enter when this revision is active → create a new version
// When a modal is open for this revision, RevisionModal handles the
// event directly so it can synchronously transition its FSM. Letting
// both handle it would double-dispatch createNewRevision.
$effect(() => {
    return annotationEventBus.on("annotation-add-version", (event) => {
        if (event.annotationId !== revision.id) return;
        const modalOpen = $modalStack.some(
            (entry) =>
                entry.type === "revision" &&
                entry.revisionId === revision.id &&
                entry.parentView === view,
        );
        if (modalOpen) return;
        posthog.capture("revision_version_created", { version_count: revision.versions.length });
        controller.flushCurrentStateToParent(false);
        view.dispatch(createNewRevision(view.state, revision.id));
        tick().then(() => {
            if (appSettings.showNestedEditor) {
                userClosedEditor = false;
                isEditorOpen = true;
            }
        });
    });
});

// When a nested revision decoration inside our inline editor is clicked,
// the revisionClickHandler fires revision-focus-request with that nested
// revision's ID. No other component matches it, so we handle it here by
// opening a modal for the nested revision.
$effect(() => {
    return annotationEventBus.on("revision-focus-request", (event) => {
        const nestedEditor = controller.editor;
        if (!nestedEditor || event.sourceView !== nestedEditor) return;
        // Only handle if the target revision exists in our inline nested editor
        const nestedAnns = nestedEditor.state.field(annotationField);
        const nestedRev = nestedAnns[event.revisionId];
        if (!nestedRev || !isAnnotationOfType(nestedRev, "revision")) return;
        // Expand this parent revision as a modal first, then place the cursor
        // on the nested revision so it activates inline within that modal.
        const nestedRevPos = nestedRev.selection.main.from;
        modalStack.push({
            type: "revision",
            revisionId: revision.id,
            parentView: view,
            label: activeVersion ? previewVersionText(activeVersion) : "Revision",
            pendingNestedCommand: {
                type: "cursor",
                selectionFrom: nestedRevPos,
                selectionTo: nestedRevPos,
            },
        });
    });
});

onDestroy(() => {
    clearTimeout(boundaryHintTimeout);
    clearTimeout(cursorArrivingTimeout);
    destroyNestedEditor();
});

function openRevisionModal() {
    posthog.capture("revision_modal_opened", { version_count: revision.versions.length });
    modalStack.push({
        type: "revision",
        revisionId: revision.id,
        parentView: view,
        label: activeVersion ? previewVersionText(activeVersion) : "Revision",
    });
}

function deleteEntireRevision() {
    posthog.capture("annotation_deleted", {
        type: "revision",
        version_count: revision.versions.length,
    });
    remove();
}

function selectRevisionVersion(version: RevisionVersionView) {
    if (linkTargetable) {
        completeLink(version.id);
        return;
    }
    if (!version.active) {
        posthog.capture("revision_version_switched", {
            version_index: version.index,
            version_count: revision.versions.length,
        });
        controller.flushCurrentStateToParent(false);
        view.dispatch(
            setActiveRevisionVersion(view.state, revision.id, version.id, { moveCursor: true }),
        );
    }
    if (appSettings.showNestedEditor) {
        userClosedEditor = false;
        isEditorOpen = true;
    }
}
</script>

{#snippet versionControls(versionView: RevisionVersionView)}
    {@const version = revision.versions[versionView.index]}
    {@const versionGroup = groupForVersion(version.id)}
    <button
        class="px-1 py-1 transition-colors text-black/30 hover:text-blue-600
            {versionGroup ? 'text-blue-600' : ''}"
        onclick={() => {
            focusThisRevision();
            openLinkMenu = openLinkMenu === versionView.index ? null : versionView.index;
        }}
        title="Link to a version of another revision"
        aria-label="Link version"
    >
        <Link2 size={10} />
    </button>
    <button
        class="pr-1.5 pl-0.5 py-1 transition-colors
            {versionView.active
                ? 'text-white/60 hover:text-white'
                : 'text-black/30 hover:text-red-500/70'}"
        onclick={() => {
            if (editingLabelIndex === versionView.index) cancelLabelEdit();
            controller.flushCurrentStateToParent(false);
            view.dispatch(deleteRevisionVersion(view.state, revision.id, version.id));
        }}
        title={`Delete version ${versionView.index + 1}`}
    >
        <X size={9} />
    </button>
{/snippet}

{#snippet versionMenu(versionView: RevisionVersionView)}
    {@const version = revision.versions[versionView.index]}
    {@const versionGroup = groupForVersion(version.id)}
    {#if openLinkMenu === versionView.index}
        <div
            class="absolute z-30 top-full mt-1 left-0 min-w-[170px] rounded-lg bg-white shadow-lg ring-1 ring-black/10 py-1 text-[11px]"
            transition:slide={{ duration: 120, easing: cubicOut }}
        >
            {#if versionGroup}
                <button
                    class="w-full text-left px-3 py-1.5 hover:bg-red-50 text-red-600"
                    onclick={() => unlinkVersion(version.id)}
                >
                    Unlink from "{versionGroup.label}"
                </button>
                <div class="my-1 border-t border-black/5"></div>
            {/if}
            <button
                class="w-full text-left px-3 py-1.5 hover:bg-blue-50 text-blue-700 font-medium"
                onclick={() => startLink(version.id)}
            >
                Link to another revision…
            </button>
            {#each joinableGroups(version.id) as group}
                <button
                    class="w-full flex items-center gap-2 text-left px-3 py-1.5 hover:bg-black/5"
                    onclick={() => linkToExistingGroup(version.id, group.id)}
                >
                    <span
                        class="w-1.5 h-1.5 rounded-full shrink-0"
                        style:background-color={groupColor(group.id)}
                    ></span>
                    <span class="truncate">Join "{group.label}"</span>
                </button>
            {/each}
        </div>
    {/if}
{/snippet}

{#snippet afterVersions()}
    {#if $linkAnchor && $linkAnchor.member.revisionId === revision.id}
        <div class="px-3 pb-2 -mt-1 flex items-center gap-2 text-[10px] text-blue-700">
            <span>Pick a version on another revision to link…</span>
            <button class="underline hover:text-blue-800" onclick={cancelLink}>cancel</button>
        </div>
    {/if}
{/snippet}

{#snippet actions()}
    <div class="px-3 pb-3 flex gap-1.5">
        <button
            class="flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium text-purple-600/80
                bg-white/50 hover:bg-white/70 rounded-md ring-1 ring-purple-200/40 transition-colors"
            onclick={async () => {
                posthog.capture("revision_version_created", {
                    version_count: revision.versions.length,
                });
                controller.flushCurrentStateToParent(false);
                view.dispatch(createNewRevision(view.state, revision.id));
                await tick();
                if (appSettings.showNestedEditor) {
                    userClosedEditor = false;
                    isEditorOpen = true;
                } else {
                    openRevisionModal();
                }
            }}
            title="Create a new version ({modKey}↵)"
        >
            <PlusIcon size={14} />
            <span>New Version</span>
            <span class="ml-0.5 opacity-50"><Kbd keys={["Cmd", "↵"]} /></span>
        </button>
        {#if appSettings.showNestedEditor}
            <button
                data-tutorial-action="toggle-nested-editor"
                data-revision-id={revision.id}
                class="flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md ring-1 transition-colors
                    {isEditorOpen
                        ? 'text-purple-600/80 bg-purple-100/40 ring-purple-300/40 hover:bg-purple-100/60'
                        : 'text-purple-600/60 bg-white/50 ring-purple-200/40 hover:bg-white/70'}"
                onclick={() => {
                    userClosedEditor = isEditorOpen;
                    isEditorOpen = !isEditorOpen;
                }}
                title={isEditorOpen ? "Hide editor" : "Open editor"}
            >
                {#if isEditorOpen}<ChevronUp size={10} />{:else}<ChevronDown size={10} />{/if}
            </button>
        {/if}
    </div>
{/snippet}

{#snippet editorContent()}
    {#if showBoundaryHint}
        {#if appSettings.showNestedEditor}
            <button
                class="mx-3 mb-3 flex items-start gap-1.5 px-2 py-1.5 rounded-md w-[calc(100%-1.5rem)]
                    bg-purple-50/70 ring-1 ring-purple-200/50 text-[10px] text-purple-600/80 leading-snug
                    hover:bg-purple-100/60 transition-colors text-left"
                onclick={() => {
                    userClosedEditor = false;
                    isEditorOpen = true;
                    tick().then(() => controller.editor?.focus());
                }}
            >
                <span class="shrink-0 mt-px">↓</span>
                <span>Edit in the inline editor below.</span>
            </button>
        {:else}
            <button
                class="mx-3 mb-3 flex items-start gap-1.5 px-2 py-1.5 rounded-md w-[calc(100%-1.5rem)]
                    bg-purple-50/70 ring-1 ring-purple-200/50 text-[10px] text-purple-600/80 leading-snug
                    hover:bg-purple-100/60 transition-colors text-left"
                onclick={openRevisionModal}
            >
                <span class="shrink-0 mt-px">↗</span>
                <span>Open in the revision editor to edit at boundaries.</span>
            </button>
        {/if}
    {/if}

    {#if isEditorOpen && appSettings.showNestedEditor}
        <div
            transition:slide={{ duration: 120, easing: cubicOut }}
            class="mx-3 mb-3 rounded-lg overflow-hidden ring-1 ring-white/40 bg-white/60"
        >
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
                bind:this={nestedEditorHost}
                class="revision-inline-editor"
                class:cursor-arriving={cursorArriving}
                onfocusin={() => (nestedEditorFocused = true)}
                onfocusout={() => (nestedEditorFocused = false)}
            ></div>
            {#if !nestedEditorFocused}
                <div class="flex items-center justify-center gap-1.5 px-2.5 pb-1.5 text-[10px] text-purple-400/70">
                    <Kbd keys={["Cmd", "E"]} /> <span>to edit</span>
                </div>
            {/if}
        </div>
    {:else if isActive}
        <div class="mx-3 mb-2 flex items-center gap-1.5 text-[10px] text-purple-400/70">
            <Kbd keys={["Cmd", "E"]} /> <span>to edit</span>
        </div>
    {/if}
{/snippet}

{#snippet threadContent()}
    <Thread
        {thread}
        {updateThread}
        {view}
        annotationId={revision.id}
        previewOnly={!isActive}
        accentClass="text-purple-600/80 hover:text-purple-700"
        sendPillClass="bg-purple-500 text-white hover:bg-purple-600"
    />
{/snippet}

<RevisionCard
    revisionId={revision.id}
    active={isActive}
    versions={revisionVersionViews}
    {linkTargetable}
    editingVersionIndex={editingLabelIndex}
    editingLabel={labelInputValue}
    onEditingLabelInput={(value) => (labelInputValue = value)}
    onCommitRename={commitLabelEdit}
    onCancelRename={cancelLabelEdit}
    onRenameVersion={(version) => startLabelEdit(version.index)}
    onSelectVersion={selectRevisionVersion}
    onOpen={openRevisionModal}
    onDelete={deleteEntireRevision}
    {versionControls}
    {versionMenu}
    {afterVersions}
    {actions}
    editor={editorContent}
    thread={thread.length > 0 || isActive ? threadContent : undefined}
/>


<style>
    .revision-inline-editor {
        min-height: 220px;
    }
    .revision-inline-editor :global(.cm-editor) {
        height: 100%;
        min-height: 220px;
        font-size: 13px;
        font-family: var(--doc-font-family);
        line-height: 1.6;
        background: transparent;
    }
    .revision-inline-editor :global(.cm-scroller) {
        overflow-y: auto;
        padding: 8px 10px 12px 10px;
    }
    .revision-inline-editor :global(.cm-content) {
        padding: 0;
        text-indent: 0;
        font-size: 13px;
        line-height: 1.6;
        font-family: var(--doc-font-family);
    }

    @keyframes focus-flash {
        0%   { background-color: rgba(254, 242, 205, 0.9); }
        70%  { background-color: rgba(254, 242, 205, 0.9); }
        100% { background-color: rgba(254, 242, 205, 0); }
    }

    .revision-inline-editor.cursor-arriving {
        animation: focus-flash 0.6s ease-out both;
    }
</style>
