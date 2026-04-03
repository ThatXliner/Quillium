import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "./env.js";

export type DocumentRow = {
    id: string;
    owner_id: string;
    title: string;
    content: string;
    version: number;
};

export type UpdateRow = {
    document_id: string;
    version: number;
    changes: unknown;
    client_id: string;
};

let client: SupabaseClient | null = null;

export function getDb(): SupabaseClient {
    if (client) return client;
    client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
    });
    return client;
}

/** Load a document's current state. Returns null if not found. */
export async function loadDocument(docId: string): Promise<DocumentRow | null> {
    const { data, error } = await getDb()
        .from("sync_documents")
        .select("id, owner_id, title, content, version")
        .eq("id", docId)
        .single();
    if (error) return null;
    return data;
}

/** Get all updates for a document since a given version. */
export async function getUpdatesSince(
    docId: string,
    sinceVersion: number,
): Promise<UpdateRow[]> {
    const { data, error } = await getDb()
        .from("collab_updates")
        .select("document_id, version, changes, client_id")
        .eq("document_id", docId)
        .gt("version", sinceVersion)
        .order("version", { ascending: true });
    if (error) throw new Error(`Failed to load updates: ${error.message}`);
    return data ?? [];
}

/** Persist a collab update and bump the document version + content. */
export async function saveUpdate(
    docId: string,
    version: number,
    changes: unknown,
    clientId: string,
    newContent: string,
): Promise<void> {
    const db = getDb();
    // Insert the update row
    const { error: insertErr } = await db
        .from("collab_updates")
        .insert({ document_id: docId, version, changes, client_id: clientId });
    if (insertErr) throw new Error(`Failed to save update: ${insertErr.message}`);
    // Bump document version + content
    const { error: updateErr } = await db
        .from("sync_documents")
        .update({ version, content: newContent, updated_at: new Date().toISOString() })
        .eq("id", docId);
    if (updateErr) throw new Error(`Failed to update document: ${updateErr.message}`);
}

/** Check if a share token is valid for a document and return its permission level. */
export async function getSharePermission(
    docId: string,
    token: string,
): Promise<string | null> {
    const { data, error } = await getDb()
        .from("shares")
        .select("permission")
        .eq("document_id", docId)
        .eq("token", token)
        .single();
    if (error) return null;
    return data.permission;
}

/** Check if a user is the owner of a document. */
export async function isDocumentOwner(
    docId: string,
    userId: string,
): Promise<boolean> {
    const { data } = await getDb()
        .from("sync_documents")
        .select("id")
        .eq("id", docId)
        .eq("owner_id", userId)
        .single();
    return data !== null;
}
