/**
 * Auth module exports.
 */
export { supabase, supabaseConfigured } from "./supabase";
export {
    getDisplayName,
    getSession,
    getUser,
    getUserEmail,
    initAuth,
    isAnonymous,
    isAuthenticated,
    isLoading,
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
