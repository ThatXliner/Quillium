import type { SidebarPanelSession } from "$lib/sidebar/panels";

export type PanelProbe = {
    mountCount: number;
    unmountCount: number;
    updates: { active: boolean; session: SidebarPanelSession | null }[];
};

export const panelProbe: PanelProbe = {
    mountCount: 0,
    unmountCount: 0,
    updates: [],
};

export const throwingPanelState = {
    shouldThrow: true,
};

export function resetPanelProbe(): void {
    panelProbe.mountCount = 0;
    panelProbe.unmountCount = 0;
    panelProbe.updates = [];
}
