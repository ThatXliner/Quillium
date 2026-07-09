/**
 * share.ts — Desktop wiring for the dependency-injected Web Preview share
 * repository. Keeps application-specific auth state out of the data layer.
 */
import { getCurrentUserName } from "$lib/auth/auth.svelte";
import { supabase } from "$lib/auth/supabase";
import { writable } from "svelte/store";
import {
    type PublishReadonlyShareInput,
    type ReadonlyShare,
    type ShareRepository,
    buildReadonlyShareUrl,
    buildSharePreviewText,
    createShareRepository,
} from "./shareRepository";

export { buildReadonlyShareUrl, buildSharePreviewText };
export type { ReadonlyShare };

export const readonlyShareState = writable<ReadonlyShare | null>(null);

function requireShareRepository(): ShareRepository {
    if (!supabase) {
        throw new Error("Supabase not configured");
    }
    return createShareRepository(supabase);
}

export async function getReadonlyShare(documentId: string): Promise<ReadonlyShare | null> {
    return requireShareRepository().getReadonlyShare(documentId);
}

export async function publishReadonlyShare(
    input: PublishReadonlyShareInput,
): Promise<ReadonlyShare> {
    return requireShareRepository().publishReadonlyShare({
        ...input,
        authorName: getCurrentUserName(),
    });
}

export async function disableReadonlyShare(documentId: string): Promise<ReadonlyShare | null> {
    return requireShareRepository().disableReadonlyShare(documentId);
}
