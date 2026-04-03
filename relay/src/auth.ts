import { getDb, isDocumentOwner, getSharePermission } from "./db.js";

export type AuthResult = {
    userId: string;
    permission: "owner" | "view" | "comment" | "edit";
};

/**
 * Verify a Supabase JWT and determine the user's permission for a document.
 *
 * Auth flow:
 * 1. Client sends JWT (from Supabase Auth) in the WebSocket URL query: ?token=<jwt>
 * 2. We verify it with Supabase's getUser()
 * 3. Check if user is the document owner → full access
 * 4. Otherwise, check share token (query: &share=<token>) for collaborator access
 */
export async function authenticate(
    docId: string,
    jwt: string,
    shareToken?: string,
): Promise<AuthResult | null> {
    const db = getDb();
    // Verify the JWT with Supabase
    const { data, error } = await db.auth.getUser(jwt);
    if (error || !data.user) return null;
    const userId = data.user.id;

    // Check if owner
    if (await isDocumentOwner(docId, userId)) {
        return { userId, permission: "owner" };
    }

    // Check share token for collaborator access
    if (shareToken) {
        const permission = await getSharePermission(docId, shareToken);
        if (permission) {
            return { userId, permission: permission as AuthResult["permission"] };
        }
    }

    return null;
}
