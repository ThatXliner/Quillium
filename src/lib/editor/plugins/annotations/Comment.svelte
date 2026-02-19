<script lang="ts">
    import { SparklesIcon, Trash2 } from "lucide-svelte";
    import type { Annotation, Thread as ThreadType } from ".";
    import { editorView } from "$lib/stores";

    const {
        comment,
        isActive,
        removeComment,
        updateThread,
    }: {
        comment: Annotation<"comment">;
        isActive: boolean;
        removeComment: () => void;
        updateThread: (thread: ThreadType) => void;
    } = $props();

    const thread = $derived(comment.thread);

    const selectedText = $derived(
        $editorView
            ? $editorView.state.sliceDoc(
                  comment.selection.main.from,
                  comment.selection.main.to,
              )
            : "",
    );

    let newMessage = $state("");
    let inputEl: HTMLInputElement;

    function save() {
        if (!newMessage.trim()) return;
        updateThread([
            ...thread,
            { message: newMessage, author: "User", time: Date.now() },
        ]);
        newMessage = "";
    }

    async function aiSuggestion() {
        let prompt = "Provide suggestions based on the following";
        if (thread.length === 1) {
            prompt += " comment:\n";
        } else {
            prompt += " conversation thread:\n";
        }
        prompt += "```\n";
        if (thread.length === 1) {
            prompt += thread[0].message;
        } else {
            prompt += thread
                .map((message) => `${message.author}: ${message.message}`)
                .join("\n");
        }
        prompt += "\n```\n";
        prompt +=
            "For context, here is the selected text the comment is referring to:\n";
        prompt += "```\n";
        prompt += selectedText;
        prompt += "```\n";
        prompt += "Be concise.";

        try {
            const response = await fetch("/api/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    messages: [{ role: "user", content: prompt }],
                }),
            });

            if (!response.ok) throw new Error("Failed to get AI response");

            const reader = response.body?.getReader();
            if (!reader) throw new Error("No response body");

            const decoder = new TextDecoder();
            let done = false;
            let aiResponse = "";

            while (!done) {
                const { value, done: streamDone } = await reader.read();
                done = streamDone;
                if (value) {
                    const chunk = decoder.decode(value);
                    for (const line of chunk.split("\n").filter((l) => l.trim())) {
                        if (line.startsWith("0:")) {
                            try {
                                aiResponse += JSON.parse(line.slice(2));
                            } catch {
                                // skip
                            }
                        }
                    }
                }
            }

            updateThread([
                ...thread,
                { message: aiResponse, author: "AI", time: Date.now() },
            ]);
        } catch {
            updateThread([
                ...thread,
                {
                    message: "Sorry, I encountered an error generating a suggestion.",
                    author: "AI",
                    time: Date.now(),
                },
            ]);
        }
    }

    function initials(author: string) {
        return author
            .split(" ")
            .map((w) => w[0])
            .join("")
            .toUpperCase()
            .slice(0, 2);
    }

    function formatTime(ts: number) {
        return new Intl.DateTimeFormat("default", {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
        }).format(new Date(ts));
    }
</script>

<div
    class="backdrop-blur-md border shadow-lg overflow-hidden transition-all duration-200
        {isActive
            ? 'bg-gray-200/80 border-white/50 shadow-xl rounded-[14px]'
            : 'bg-gray-300/70 border-white/30 rounded-[12px] opacity-90 hover:opacity-100 hover:bg-gray-200/75'}"
>
    <!-- Quoted text chip -->
    {#if selectedText}
        <div class="px-3 pt-3 pb-0">
            <div class="text-xs text-black/50 border-l-2 border-yellow-400/80 pl-2 truncate italic">
                {selectedText.slice(0, 80)}{selectedText.length > 80 ? "…" : ""}
            </div>
        </div>
    {/if}

    <!-- Thread messages -->
    <div class="px-3 pt-3 {isActive ? 'space-y-3' : ''}">
        {#each thread as msg, i}
            {#if isActive || i === 0}
                <div class="flex gap-2.5">
                    <!-- Avatar -->
                    <div class="shrink-0 w-7 h-7 rounded-full bg-white/50 inset-shadow-sm inset-shadow-white shadow-sm flex items-center justify-center text-black/70 text-xs font-semibold">
                        {initials(msg.author)}
                    </div>
                    <div class="flex-1 min-w-0">
                        <div class="flex items-baseline gap-1.5">
                            <span class="text-xs font-semibold text-black/80">{msg.author}</span>
                            <span class="text-[10px] text-black/40">{formatTime(msg.time)}</span>
                        </div>
                        <p class="text-xs text-black/70 mt-0.5 leading-relaxed
                            {!isActive && i === 0 ? 'truncate' : ''}">
                            {msg.message}
                        </p>
                    </div>
                </div>
            {/if}
        {/each}

        {#if thread.length > 1 && !isActive}
            <p class="text-[10px] text-black/40 mt-1 pl-9">{thread.length - 1} more repl{thread.length === 2 ? "y" : "ies"}</p>
        {/if}
    </div>

    <!-- Reply input — only when active -->
    {#if isActive}
        <div class="flex items-center gap-2 px-3 py-2.5 mt-2 mx-2 mb-1 rounded-[10px] bg-white/40 inset-shadow-sm inset-shadow-white">
            <div class="shrink-0 w-6 h-6 rounded-full bg-white/50 inset-shadow-sm inset-shadow-white flex items-center justify-center text-black/50 text-[10px] font-semibold">
                U
            </div>
            <input
                bind:this={inputEl}
                bind:value={newMessage}
                onkeydown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        save();
                    }
                }}
                placeholder="Reply…"
                class="flex-1 text-xs bg-transparent outline-none text-black/70 placeholder:text-black/30"
            />
            {#if newMessage}
                <button
                    onclick={save}
                    class="text-xs font-medium text-blue-600/80 hover:text-blue-700 transition-colors shrink-0"
                >
                    Send
                </button>
            {/if}
        </div>

        <!-- Actions -->
        <div class="flex justify-end gap-1 px-2 pb-2">
            <button
                aria-label="Get AI suggestion"
                class="p-1.5 rounded-lg text-black/30 hover:text-black/60 hover:bg-white/40 transition-colors"
                onclick={() => aiSuggestion()}
            >
                <SparklesIcon size={13} />
            </button>
            <button
                aria-label="Delete comment"
                class="p-1.5 rounded-lg text-black/30 hover:text-red-500/70 hover:bg-white/40 transition-colors"
                onclick={() => removeComment()}
            >
                <Trash2 size={13} />
            </button>
        </div>
    {/if}
</div>
