// panels.ts — Typed sidebar panel contributions and scoped panel sessions.
//
// The session is the small capability boundary between the sidebar host and a
// panel. It carries only the current target, cancellation, and read-only
// accessors; editor stores, views, provider settings, and credentials remain
// outside this contract.

import type { MessageCircleIcon } from "lucide-svelte";
import type { Component } from "svelte";

export interface SidebarPanelTarget {
    readonly documentId: string | null;
    readonly tabId: string | null;
    readonly draftId: string | null;
}

export interface SidebarPanelSession {
    readonly target: Readonly<SidebarPanelTarget>;
    readonly signal: AbortSignal;
    readonly readSelection: () => string | null;
    readonly isCurrent: () => boolean;
}

export interface SidebarPanelProps {
    readonly active: boolean;
    readonly session: SidebarPanelSession | null;
}

export interface SidebarPanelSessionSources {
    readonly readTarget: () => SidebarPanelTarget | null;
    readonly readSelection: () => string | null;
}

export interface SidebarPanelSessionHandle {
    readonly session: SidebarPanelSession;
    readonly dispose: () => void;
}

export type SidebarPanelIcon = typeof MessageCircleIcon;

export interface SidebarPanelContribution {
    readonly id: string;
    readonly component: Component<SidebarPanelProps>;
    readonly icon: SidebarPanelIcon;
    readonly label: string;
    readonly title: string;
    readonly order: number;
    readonly shortcutKey?: string;
    readonly placement: "main" | "utility";
    readonly activeClass: string;
    readonly hoverClass: string;
    readonly requiresModel: boolean;
    readonly preferredWidth?: number;
    readonly preferredHeight?: number;
    readonly contentClass: string;
    readonly mount: "eager" | "active";
    readonly contextMode?: "chat" | "feedback" | "revise";
    readonly contextRingClass?: string;
}

export function createSidebarPanelSession(
    target: SidebarPanelTarget,
    sources: SidebarPanelSessionSources,
): SidebarPanelSessionHandle {
    const targetSnapshot = Object.freeze({
        documentId: target.documentId,
        tabId: target.tabId,
        draftId: target.draftId,
    });
    const controller = new AbortController();
    let disposed = false;

    function isCurrent(): boolean {
        if (disposed || controller.signal.aborted) return false;
        const currentTarget = sources.readTarget();
        return (
            currentTarget !== null &&
            currentTarget.documentId === targetSnapshot.documentId &&
            currentTarget.tabId === targetSnapshot.tabId &&
            currentTarget.draftId === targetSnapshot.draftId
        );
    }

    function readSelection(): string | null {
        if (
            targetSnapshot.documentId === null ||
            targetSnapshot.tabId === null ||
            targetSnapshot.draftId === null ||
            !isCurrent()
        ) {
            return null;
        }
        return sources.readSelection();
    }

    function dispose(): void {
        if (disposed) return;
        disposed = true;
        controller.abort();
    }

    const session = Object.freeze<SidebarPanelSession>({
        target: targetSnapshot,
        signal: controller.signal,
        readSelection,
        isCurrent,
    });

    return Object.freeze<SidebarPanelSessionHandle>({ session, dispose });
}

export function createSidebarPanels(
    contributions: readonly SidebarPanelContribution[],
): readonly SidebarPanelContribution[] {
    const ids = new Set<string>();
    const shortcutKeys = new Set<string>();

    const snapshot = contributions.map((contribution, index) => {
        if (typeof contribution.id !== "string" || contribution.id.trim().length === 0) {
            throw new Error(`[sidebar panels] panel at index ${index} must have a nonempty id`);
        }
        if (ids.has(contribution.id)) {
            throw new Error(`[sidebar panels] duplicate panel id "${contribution.id}"`);
        }
        ids.add(contribution.id);

        if (contribution.shortcutKey !== undefined) {
            if (shortcutKeys.has(contribution.shortcutKey)) {
                throw new Error(
                    `[sidebar panels] duplicate shortcut key "${contribution.shortcutKey}"`,
                );
            }
            shortcutKeys.add(contribution.shortcutKey);
        }

        return Object.freeze({ ...contribution });
    });

    snapshot.sort((left, right) => left.order - right.order);
    return Object.freeze(snapshot);
}
