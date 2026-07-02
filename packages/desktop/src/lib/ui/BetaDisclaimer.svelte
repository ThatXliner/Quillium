<!--
    BetaDisclaimer.svelte — First-launch beta terms acknowledgement modal.

    Shown once after the tutorial completes (or on first visit if the tutorial
    was already seen). Presents a brief summary of beta terms and links to the
    full terms on the website. Persists acceptance to localStorage.
-->
<script lang="ts">
import posthog from "$lib/posthog";

const { onaccept }: { onaccept: () => void } = $props();

const TERMS_URL = "https://quillium.bryanhu.com/terms";

function accept() {
    localStorage.setItem("quillium_beta_accepted", "true");
    posthog.capture("beta_terms_accepted");
    onaccept();
}
</script>

<div class="fixed inset-0 z-[9999]" role="dialog" aria-modal="true" aria-label="Beta disclaimer">
    <button
        type="button"
        class="absolute inset-0 bg-black/55 border-0 p-0 cursor-default"
        aria-label="Background"
        tabindex="-1"
    ></button>

    <!--
        WebKit glass-shadow-square fix: split into two layers. The OUTER keeps the
        drop shadow + radius (no overflow, no backdrop-filter) so the shadow stays
        rounded; the INNER clips the backdrop-blur to the radius via overflow-hidden.
    -->
    <div
        class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[420px] shadow-xl rounded-2xl"
        role="document"
    >
        <div
            class="overflow-hidden backdrop-blur-md bg-gray-300/85 border border-white/40 rounded-2xl p-6 flex flex-col gap-4"
        >
            <div>
                <h3 class="text-sm font-semibold text-black/80 mb-1">Welcome to the Quillium Beta</h3>
                <p class="text-xs text-black/60 leading-relaxed">
                    By continuing, you agree to the
                    <a
                        href={TERMS_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="text-blue-500 hover:text-blue-600 underline transition-colors"
                    >beta terms</a>.
                </p>
            </div>

            <div class="flex items-center justify-end pt-1">
                <button
                    onclick={accept}
                    class="text-xs px-4 py-1.5 rounded-full bg-blue-500 hover:bg-blue-600 text-white transition-colors font-medium"
                >
                    I understand
                </button>
            </div>
        </div>
    </div>
</div>
