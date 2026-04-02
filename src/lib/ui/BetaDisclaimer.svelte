<!--
    BetaDisclaimer.svelte — First-launch beta terms acknowledgement modal.

    Shown once after the tutorial completes (or on first visit if the tutorial
    was already seen). Presents a brief summary of beta terms and links to the
    full terms on the website. Persists acceptance to localStorage.
-->
<script lang="ts">
import { FlaskConical, ShieldOff, MessageCircle, Ban } from "lucide-svelte";
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
        class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[420px] backdrop-blur-md bg-gray-300/85 border border-white/40 shadow-xl rounded-2xl p-6 flex flex-col gap-4"
        role="document"
    >
        <div>
            <h3 class="text-sm font-semibold text-black/80 mb-1">Welcome to the Quillium Beta</h3>
            <p class="text-xs text-black/60 leading-relaxed">
                By continuing, you agree to the following terms.
            </p>
        </div>

        <div class="grid grid-cols-2 gap-2">
            <div class="rounded-lg bg-white/45 border border-white/40 p-2.5 flex gap-2.5 items-start">
                <FlaskConical size={14} class="text-black/40 shrink-0 mt-0.5" />
                <div>
                    <h4 class="text-[11px] font-semibold text-black/75">Beta Status</h4>
                    <p class="text-[10px] text-black/50 leading-snug">Unstable. Features may change. Anonymous analytics; opt out anytime.</p>
                </div>
            </div>
            <div class="rounded-lg bg-white/45 border border-white/40 p-2.5 flex gap-2.5 items-start">
                <ShieldOff size={14} class="text-black/40 shrink-0 mt-0.5" />
                <div>
                    <h4 class="text-[11px] font-semibold text-black/75">No Liability</h4>
                    <p class="text-[10px] text-black/50 leading-snug">The software is provided as-is, no warranties. Data loss is possible, so back up your work.</p>
                </div>
            </div>
            <div class="rounded-lg bg-white/45 border border-white/40 p-2.5 flex gap-2.5 items-start">
                <MessageCircle size={14} class="text-black/40 shrink-0 mt-0.5" />
                <div>
                    <h4 class="text-[11px] font-semibold text-black/75">Feedback</h4>
                    <p class="text-[10px] text-black/50 leading-snug">Your feedback will be used to improve the app. No ownership rights granted.</p>
                </div>
            </div>
            <div class="rounded-lg bg-white/45 border border-white/40 p-2.5 flex gap-2.5 items-start">
                <Ban size={14} class="text-black/40 shrink-0 mt-0.5" />
                <div>
                    <h4 class="text-[11px] font-semibold text-black/75">No Replication</h4>
                    <p class="text-[10px] text-black/50 leading-snug">You may not use insights from this beta to build competing products.</p>
                </div>
            </div>
        </div>

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
