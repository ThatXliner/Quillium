<script lang="ts">
import posthog, { syncAnalyticsOptOut } from "$lib/posthog";

const { onresolve }: { onresolve: () => void } = $props();

function resolve(enabled: boolean) {
    syncAnalyticsOptOut(enabled);
    if (enabled) {
        posthog.capture("mas_analytics_consent_granted");
    }
    onresolve();
}
</script>

<div
    class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/55 px-6"
    role="dialog"
    aria-modal="true"
    aria-label="Analytics consent"
>
    <div
        class="w-full max-w-[28rem] rounded-2xl border border-white/40 bg-gray-300/90 p-6 shadow-xl backdrop-blur-md"
    >
        <div class="flex flex-col gap-3">
            <div>
                <h3 class="text-sm font-semibold text-black/80">Help improve Quillium?</h3>
                <p class="mt-1 text-xs leading-relaxed text-black/60">
                    This Mac App Store build keeps usage analytics off until you choose otherwise.
                    If you opt in, Quillium will send anonymous product analytics to help catch
                    broken flows and improve stability. You can change this later in Settings.
                </p>
            </div>

            <div class="flex flex-col gap-2 pt-1 sm:flex-row sm:justify-end">
                <button
                    type="button"
                    onclick={() => resolve(false)}
                    class="rounded-full border border-black/10 bg-white/70 px-4 py-2 text-xs font-medium text-black/65 transition-colors hover:bg-white/90"
                >
                    Keep analytics off
                </button>
                <button
                    type="button"
                    onclick={() => resolve(true)}
                    class="rounded-full bg-blue-500 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-600"
                >
                    Share anonymous analytics
                </button>
            </div>
        </div>
    </div>
</div>
