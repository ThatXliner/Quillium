<script lang="ts">
import { lightTint, mediumTint } from "$lib/readers/colors";
import { readersSettings } from "$lib/readers/settings.svelte";
import { ThreadMessage as ThreadMessageView } from "@quillium/share";
/**
 * ThreadMessage.svelte — Renders a single message within an
 * annotation thread (avatar, author, timestamp, body).
 *
 * Props:
 *   - message: ThreadMessage — the message data to display
 *   - thread: Thread — full thread array (needed to produce an
 *     updated copy when the user edits this message)
 *   - index: number — position of this message within the thread
 *   - updateThread: (thread: Thread) => void — callback to
 *     replace the thread array after an edit
 *
 * Events emitted: none (delegates via updateThread callback)
 * Stores: none
 *
 * Parent: Thread.svelte
 * Children: none
 *
 * Local state:
 *   - editing: whether the inline edit textarea is visible
 *   - editMessage: draft text while editing
 */
import type { Thread, ThreadMessage } from ".";

let {
    message,
    thread,
    index,
    updateThread,
    truncate = false,
}: {
    message: ThreadMessage;
    updateThread: (thread: Thread) => void;
    thread: Thread;
    index: number;
    truncate?: boolean;
} = $props();

/** Look up persona metadata by author name for emoji-in-circle avatar. */
const persona = $derived(readersSettings.personas.find((p) => p.name === message.author));

/** Commit the in-place edit back to the parent via updateThread. */
function saveEdit(editMessage: string) {
    const newThread = [...thread];
    newThread[index] = { ...thread[index], message: editMessage };
    updateThread(newThread);
}
</script>

<ThreadMessageView
    {message}
    {truncate}
    persona={persona
        ? {
              emoji: persona.emoji,
              background: lightTint(persona.color),
              border: mediumTint(persona.color),
          }
        : undefined}
    onEdit={saveEdit}
/>
