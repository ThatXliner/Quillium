/**
 * Auth module exports.
 */
export { supabase, supabaseConfigured } from "./supabase";
export {
    getCurrentUserName,
    getDisplayName,
    getSession,
    getUser,
    getUserEmail,
    getConnectionState,
    initAuth,
    isAnonymous,
    isAuthenticated,
    isLoading,
    isOffline,
    reconnectAuth,
    signIn,
    signInAnonymously,
    signOut,
    signUp,
} from "./auth.svelte";
export {
    displayNameSchema,
    loginSchema,
    signUpSchema,
    type DisplayNameInput,
    type LoginInput,
    type SignUpInput,
} from "./schemas";
export { avatarColor, initials } from "./avatarUtils";
