import { derived } from "svelte/store";
import { collabSession } from "./store";

export const collabCapabilities = derived(collabSession, (session) => ({
    canEdit: session === null || session.role === "editor",
    canComment: session === null || session.role !== "viewer",
}));
