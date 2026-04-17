/**
 * Auth module exports.
 */
export { supabase } from "./supabase";
export {
    getDisplayName,
    getSession,
    getUser,
    getUserEmail,
    initAuth,
    isAuthenticated,
    isLoading,
    signIn,
    signOut,
    signUp,
} from "./auth.svelte";
export { loginSchema, signUpSchema, type LoginInput, type SignUpInput } from "./schemas";
export { avatarColor, initials } from "./avatarUtils";
