<!--
    RevisionBreadcrumbs.svelte — Desktop adapter for the shared revision
    breadcrumb presentation. Modal-stack navigation and CodeMirror version
    models stay here; dropdown and label-editing behavior live in @quillium/share.
-->
<script lang="ts">
import { type ModalEntry, modalStack } from "$lib/stores";
import {
    type RevisionBreadcrumbCrumbView,
    RevisionBreadcrumbs as RevisionBreadcrumbsView,
} from "@quillium/share";
import type { Annotation } from ".";
import { previewVersionText } from "./nestedEditor";

const {
    crumbs,
    crumbRevisions,
    selectedVersions,
    onselect,
    ondeleteversion,
    getlabel,
    oncommitlabel,
}: {
    crumbs: ModalEntry[];
    crumbRevisions: (Annotation<"revision"> | undefined)[];
    selectedVersions: number[];
    onselect: (ci: number, vi: number, crumb: ModalEntry, isCurrent: boolean) => void;
    ondeleteversion: (vi: number) => void;
    getlabel: () => string;
    oncommitlabel: (label: string) => void;
} = $props();

const breadcrumbViews = $derived.by((): RevisionBreadcrumbCrumbView[] =>
    crumbs.map((_, crumbIndex) => {
        const revision = crumbRevisions[crumbIndex];
        const selectedVersionIndex = selectedVersions[crumbIndex] ?? 0;
        const isCurrent = crumbIndex === crumbs.length - 1;
        return {
            id: String(crumbIndex),
            label: "Revision",
            current: isCurrent,
            selectedVersionId: revision?.versions[selectedVersionIndex]?.id ?? null,
            versions:
                revision?.versions.map((version, versionIndex) => ({
                    id: version.id,
                    label: version.label ?? previewVersionText(version),
                    editableLabel:
                        isCurrent && versionIndex === selectedVersionIndex
                            ? getlabel()
                            : version.label,
                })) ?? [],
        };
    }),
);

function indexOfCrumb(crumbId: string): number | undefined {
    const crumbIndex = Number(crumbId);
    return Number.isInteger(crumbIndex) && crumbs[crumbIndex] ? crumbIndex : undefined;
}

function navigateToCrumb(crumbId: string): void {
    const crumbIndex = indexOfCrumb(crumbId);
    if (crumbIndex === undefined) return;
    modalStack.popTo(crumbIndex);
}

function selectCrumbVersion(crumbId: string, versionId: string): void {
    const crumbIndex = indexOfCrumb(crumbId);
    if (crumbIndex === undefined) return;
    const revision = crumbRevisions[crumbIndex];
    const versionIndex = revision?.versions.findIndex((version) => version.id === versionId) ?? -1;
    if (versionIndex < 0) return;
    onselect(crumbIndex, versionIndex, crumbs[crumbIndex], crumbIndex === crumbs.length - 1);
}

function deleteCurrentVersion(crumbId: string, versionId: string): void {
    const crumbIndex = indexOfCrumb(crumbId);
    if (crumbIndex === undefined || crumbIndex !== crumbs.length - 1) return;
    const revision = crumbRevisions[crumbIndex];
    const versionIndex = revision?.versions.findIndex((version) => version.id === versionId) ?? -1;
    if (versionIndex >= 0) ondeleteversion(versionIndex);
}
</script>

<RevisionBreadcrumbsView
    crumbs={breadcrumbViews}
    onNavigate={navigateToCrumb}
    onSelectVersion={selectCrumbVersion}
    onRenameCurrent={(_, __, label) => oncommitlabel(label)}
    onDeleteCurrentVersion={deleteCurrentVersion}
/>
