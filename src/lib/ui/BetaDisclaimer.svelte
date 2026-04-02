<!--
    BetaDisclaimer.svelte — First-launch beta terms acknowledgement modal.

    Shown once after the tutorial completes (or on first visit if the tutorial
    was already seen). Presents a brief summary of beta terms and links to the
    full terms on the website. Persists acceptance to localStorage.
-->
<script lang="ts">
    import posthog from "$lib/posthog";

    const { onaccept }: { onaccept: () => void } = $props();

    const TERMS_URL = "https://quillium.bryanhu.com/";

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
        class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[380px] backdrop-blur-md bg-gray-300/85 border border-white/40 shadow-xl rounded-2xl p-6 flex flex-col gap-4"
        role="document"
    >
        <div>
            <h3 class="text-sm font-semibold text-black/80 mb-1">Welcome to the Quillium Beta</h3>
            <p class="text-xs text-black/60 leading-relaxed">
                Quillium is currently in beta. By continuing, you acknowledge the following:
            </p>
        </div>

        <ul class="text-xs text-black/60 leading-relaxed space-y-1.5 list-disc pl-4">
            <li>This is an <strong class="text-black/70">unstable beta</strong> &mdash; features may change or be removed at any time.</li>
            <li><strong class="text-black/70">Data loss is possible.</strong> Back up any important content.</li>
            <li>Anonymous analytics are collected. You may opt out anytime in Settings.</li>
            <li>Feedback you share may be used to improve the app without compensation.</li>
            <li>The service is provided as-is with no warranties.</li>
        </ul>

        <div class="flex items-center justify-between pt-1">
            <a
                href={TERMS_URL}
                target="_blank"
                rel="noopener noreferrer"
                class="text-[11px] text-blue-500 hover:text-blue-600 transition-colors"
            >
                Full terms &rarr;
            </a>
            <button
                onclick={accept}
                class="text-xs px-4 py-1.5 rounded-full bg-blue-500 hover:bg-blue-600 text-white transition-colors font-medium"
            >
                I understand
            </button>
        </div>
    </div>
</div>
