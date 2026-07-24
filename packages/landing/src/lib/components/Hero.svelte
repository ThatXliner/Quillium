<script lang="ts">
import { Lock, Pen, ShieldCheck } from "@lucide/svelte";
import { onMount } from "svelte";

import posthog from "posthog-js";
import BranchDemo from "./BranchDemo.svelte";

const REPO = "ThatXliner/quillium-releases";

let { release }: { release: { assets: { name: string; url: string }[] } } = $props();

function findAsset(pattern: string): string {
    const match = release.assets.find((a: { url: string }) => a.url.includes(pattern));
    if (match) return match.url;
    return `https://github.com/${REPO}/releases/latest`;
}

let detected = $state("unknown");
let downloadUrl = $derived.by(() => {
    if (detected === "mac") return findAsset("_aarch64.dmg");
    if (detected === "windows") return findAsset("_x64-setup.exe");
    if (detected === "linux") return findAsset("_amd64.deb");
    return "#download";
});

let downloadCount = $state(0);

onMount(() => {
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes("mac")) detected = "mac";
    else if (ua.includes("win")) detected = "windows";
    else if (ua.includes("linux")) detected = "linux";

    fetch("/api/download-count")
        .then((res) => res.json())
        .then((data) => {
            downloadCount = data.count ?? 0;
        })
        .catch(() => {});
});
</script>

	<!-- ==================== HERO ==================== -->
	<section
		class="flex min-h-screen flex-col items-center justify-center px-8 pt-32 pb-24 text-center"
	>
		<div
			class="mb-4 flex h-[120px] w-[120px] items-center justify-center rounded-[32px] border-[1.5px] border-white/35 bg-radial-[at_40%_35%] from-[#eceef2] to-[#cdd1d9] transition-transform duration-400 hover:scale-105 hover:-rotate-2"
		>
			<img src="/logo.svg" alt="Quillium mark" width="96" height="96" />
		</div>

		<h1
			class="reveal reveal-delay-1 mb-6 max-w-[700px] font-[Newsreader,Georgia,serif] text-[clamp(2.8rem,6vw,4.5rem)] leading-[1.15] font-normal tracking-[-0.03em] text-[color:var(--text-strong)]"
		>
			Write in <span class="italic">branches</span>.
		</h1>

		<p
			class="reveal reveal-delay-2 mb-10 max-w-[520px] text-[1.1rem] leading-[1.7] text-[color:var(--text-soft)] contrast-more:text-[color:var(--text-soft)]"
		>
			Draft a sentence three different ways and decide later. Every version stays in your
			document — not in a folder full of <span class="whitespace-nowrap italic"
				>final_v2_FINAL.docx</span
			> copies.
		</p>

		{#if downloadCount > 100}
			<p class="mb-4 text-[0.85rem] font-medium text-[color:var(--text-faint)] contrast-more:text-[color:var(--text-soft)]">
				Join {downloadCount.toLocaleString()}+ writers
			</p>
		{/if}

		<div class="reveal reveal-delay-3 flex flex-col items-center gap-3">
			<div class="flex flex-wrap items-center justify-center gap-4">
				<a
					href={downloadUrl}
					class="btn-primary inline-flex items-center gap-2"
					onclick={() => posthog.capture("cta_clicked", { cta: "download", location: "hero" })}
				>
					Download Now
				</a>
				<a
					href="#features"
					class="inline-flex items-center gap-2 rounded-[10px] border border-[color:var(--border)] bg-[color:var(--surface)]/50 px-6 py-3 text-[0.95rem] font-medium text-[color:var(--text-strong)] no-underline shadow-md backdrop-blur-md transition-all duration-300 hover:-translate-y-0.5 hover:bg-[color:var(--surface)]/80"
				>
					See how it works
				</a>
			</div>
			<p class="text-[0.7rem] text-[color:var(--text-faint)] contrast-more:text-[color:var(--text-soft)]">
				By downloading, you agree to the <a
					href="/terms"
					class="text-[color:var(--text-faint)] underline underline-offset-2 hover:text-[color:var(--text-soft)] contrast-more:text-[color:var(--text-soft)] contrast-more:hover:text-[color:var(--text)]"
					>Terms of Service</a
				>
			</p>
		</div>

		<div class="reveal reveal-delay-4 mt-16">
			<BranchDemo />
		</div>

		<div
			class="reveal reveal-delay-4 mt-24 flex flex-col items-center gap-4 pt-4 max-md:gap-3"
			style="border-top: 2px solid; border-image: linear-gradient(90deg, transparent, #3b82f6, #a855f7, #22c55e, #fcbc05, transparent) 1;"
		>
			<p
				class="m-0 flex flex-wrap items-center justify-center gap-x-5 text-[0.9rem] tracking-wide text-[color:var(--text-soft)]"
			>
				<a
					href="/blog/quillium-is-not-an-ai-app"
					class="inline-flex items-center gap-1 text-[color:var(--text-soft)] underline transition-colors duration-300 hover:text-[color:var(--text)]"
					><Pen size={15} strokeWidth={2} class="opacity-50" />Not an AI app — you write every word.</a
				>
				<a
					href="/blog/quillium-privacy"
					class="inline-flex items-center gap-1 text-[color:var(--text-soft)] underline transition-colors duration-300 hover:text-[color:var(--text)]"
					><Lock size={15} strokeWidth={2} class="opacity-50" />Your work stays on your device.</a
				>
				<a
					href="/blog/how-quillium-keeps-your-writing-safe"
					class="inline-flex items-center gap-1 text-[color:var(--text-soft)] underline transition-colors duration-300 hover:text-[color:var(--text)]"
					><ShieldCheck size={15} strokeWidth={2} class="opacity-50" />Crash-safe autosave.</a
				>
			</p>
		</div>
	</section>
