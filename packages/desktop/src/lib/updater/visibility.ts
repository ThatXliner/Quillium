// visibility.ts — Native updates take priority over frontend update notices.
import { writable } from "svelte/store";
export const nativeUpdateVisible = writable(false);
