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

    <div
        class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[420px] backdrop-blur-md bg-[color:var(--surface)] border border-[color:var(--border)] shadow-xl rounded-2xl p-6 flex flex-col gap-4"
        role="document"
    >
        <div>
            <h3 class="text-sm font-semibold text-[color:var(--text)] mb-1">Welcome to the Quillium Beta</h3>
            <p class="text-xs text-[color:var(--text-soft)] leading-relaxed">
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
                class="text-xs px-4 py-1.5 rounded-full bg-[color:var(--chip-blue)] hover:bg-[color:var(--chip-blue-strong)] text-[color:var(--accent-blue-text)] transition-colors font-medium"
            >
                I understand
            </button>
        </div>
    </div>
</div>
