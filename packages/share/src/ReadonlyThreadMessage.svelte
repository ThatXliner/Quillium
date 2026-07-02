<script lang="ts">
import type { SerializedThreadMessage } from "./types";

let { message, truncate = false }: { message: SerializedThreadMessage; truncate?: boolean } =
    $props();

const AVATAR_COLORS = ["#3B82F6", "#10B981", "#F59E0B", "#8B5CF6", "#EC4899", "#06B6D4"];

function normalizeDisplayName(displayName: string): string {
    return displayName.trim().replace(/\s+/g, " ");
}

function initials(displayName: string): string {
    const normalized = normalizeDisplayName(displayName);
    if (!normalized) return "?";
    return normalized
        .split(" ")
        .map((word) => word[0])
        .join("")
        .toUpperCase()
        .slice(0, 2);
}

function avatarColor(displayName: string): string {
    const normalized = normalizeDisplayName(displayName);
    if (!normalized) return AVATAR_COLORS[0];
    let hash = 0;
    for (let i = 0; i < normalized.length; i += 1) {
        hash = normalized.charCodeAt(i) + ((hash << 5) - hash);
    }
    return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
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

<div class="flex gap-2.5">
	<div
		class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white shadow-sm"
		style={`background: ${avatarColor(message.author)};`}
		title={message.author}
	>
		{initials(message.author)}
	</div>
	<div class="min-w-0 flex-1">
		<div class="flex items-baseline gap-1.5">
			<span class="text-xs font-semibold text-[color:var(--text)]">{message.author}</span>
			<span class="text-[10px] text-[color:var(--text-faint)]">{formatTime(message.time)}</span>
		</div>
		<p
			class="mt-0.5 text-xs leading-relaxed text-[color:var(--text)] {truncate
				? 'truncate'
				: 'whitespace-pre-wrap'}"
		>
			{message.message}
		</p>
	</div>
</div>
