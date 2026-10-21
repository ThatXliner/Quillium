// invoke.ts — Track database mutations and close their ingress during restart.
import { requireEditorialMutation, trackDatabaseWrite } from "$lib/updater/restartState";
import { type InvokeArgs, invoke as nativeInvoke } from "@tauri-apps/api/core";

const restartFlushCommands = new Set([
    "cmd_append_event",
    "cmd_create_snapshot",
    "cmd_create_named_snapshot",
    "cmd_update_document_meta",
    "cmd_save_ai_conversation",
    "cmd_save_ai_conversation_messages",
    "cmd_register_open_doc",
    "cmd_deregister_open_doc",
]);

export function invokeDatabase<T>(command: string, args?: InvokeArgs): Promise<T> {
    const readOnly = /^cmd_(get_|list_|load_|search_|is_)/.test(command);
    if (readOnly) return nativeInvoke<T>(command, args);
    if (!restartFlushCommands.has(command)) requireEditorialMutation();
    return trackDatabaseWrite(nativeInvoke<T>(command, args));
}
