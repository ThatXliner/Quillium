import { isTauri } from "@tauri-apps/api/core";
import { writable } from "svelte/store";

export const pendingInvitation = writable<string | null>(null);

export function parseInvitationToken(input: string): string | null {
    const value = input.trim();
    if (/^[A-Za-z0-9_-]{43}$/.test(value)) return value;
    const match = /^quillium:\/\/join\/([A-Za-z0-9_-]{43})$/.exec(value);
    if (match) return match[1];
    const web = /^https:\/\/quillium\.bryanhu\.com\/join#([A-Za-z0-9_-]{43})$/.exec(value);
    return web?.[1] ?? null;
}

export async function listenForInvitations(onInvitation: () => void): Promise<() => void> {
    if (!isTauri()) return () => {};
    const { getCurrent, onOpenUrl } = await import("@tauri-apps/plugin-deep-link");
    let lastUrl: string | undefined;
    let lastReceivedAt = 0;
    const receive = (urls: string[]): void => {
        const url = urls.find((candidate) => candidate.startsWith("quillium://join/"));
        if (!url || (url === lastUrl && Date.now() - lastReceivedAt < 1000)) return;
        lastUrl = url;
        lastReceivedAt = Date.now();
        pendingInvitation.set(url);
        onInvitation();
    };
    const unlisten = await onOpenUrl(receive);
    const current = await getCurrent();
    if (current) receive(current);
    return unlisten;
}
