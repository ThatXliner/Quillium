<script lang="ts">
import Footer from "$lib/components/Footer.svelte";
import Nav from "$lib/components/Nav.svelte";
import { initReveal } from "$lib/reveal";
import {
    Building2,
    CircleDollarSign,
    Download,
    ExternalLink,
    GraduationCap,
    History,
    PenLine,
    ShieldCheck,
    Sparkles,
    WifiOff,
} from "@lucide/svelte";
import { onMount } from "svelte";

onMount(() => {
    initReveal();
});
</script>

<svelte:head>
	<title>Pricing – Quillium</title>
	<meta
		name="description"
		content="Quillium stays free for individual writers. Omni adds sync and collaboration, while schools and organizations can pay for managed, accountable writing infrastructure."
	/>
	<link rel="canonical" href="https://quillium.bryanhu.com/pricing" />
	<meta property="og:type" content="website" />
	<meta property="og:url" content="https://quillium.bryanhu.com/pricing" />
	<meta property="og:title" content="Pricing – Quillium" />
	<meta
		property="og:description"
		content="Free for individual writers. Paid sync for people, and accountable writing infrastructure for institutions."
	/>
	<meta property="og:site_name" content="Quillium" />
	<meta name="twitter:card" content="summary" />
	<meta name="twitter:title" content="Pricing – Quillium" />
	<meta
		name="twitter:description"
		content="Free for individual writers. Paid sync for people, and accountable writing infrastructure for institutions."
	/>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Newsreader:ital,wght@0,400;0,500;1,400&display=swap"
		rel="stylesheet"
	/>
	<meta name="twitter:site" content="@quillium" />

	<!-- Structured Data: Product (Omni subscription) + SoftwareApplication (free) -->
	{@html `<script type="application/ld+json">${JSON.stringify({
		'@context': 'https://schema.org',
		'@type': 'Product',
		name: 'Quillium Omni',
		description:
			'Cloud sync across devices and real-time collaboration for Quillium, the non-linear writing app.',
		offers: {
			'@type': 'Offer',
			price: '20',
			priceCurrency: 'USD',
			priceType: 'monthly',
			availability: 'https://schema.org/PreOrder',
			description: 'Expected monthly pricing. Final price depends on number of subscribers.'
		}
	})}<\/script>`}
	{@html `<script type="application/ld+json">${JSON.stringify({
		'@context': 'https://schema.org',
		'@type': 'SoftwareApplication',
		name: 'Quillium',
		description: 'The non-linear writing app. Free forever with no locked features.',
		url: 'https://quillium.bryanhu.com',
		applicationCategory: 'ProductivityApplication',
		operatingSystem: 'macOS, Windows, Linux',
		offers: {
			'@type': 'Offer',
			price: '0',
			priceCurrency: 'USD',
			availability: 'https://schema.org/InStock'
		}
	})}<\/script>`}
</svelte:head>

<Nav />

<main class="min-h-screen px-6 pt-36 pb-24">
	<div class="mx-auto max-w-4xl">
		<!-- Header -->
		<header class="reveal mb-24 text-center">
			<p class="section-eyebrow section-eyebrow--centered">Pricing</p>
			<h1
				class="mb-6 font-[Newsreader,Georgia,serif] text-[clamp(2.8rem,6vw,4.25rem)] leading-[1.05] font-normal tracking-[-0.03em] text-[color:var(--text-strong)]"
			>
				Writers stay <span class="italic">free</span>.
			</h1>
			<p class="mx-auto max-w-xl text-[1.1rem] leading-[1.7] text-[color:var(--text-soft)]">
				The whole local-first editor stays free. People can pay for Omni. Schools and
				organizations can pay for the infrastructure around the writing.
			</p>
		</header>

		<div class="warm-divider section-divider"></div>

		<!-- Promises: 2×2 grid -->
		<section class="py-16 sm:py-20">
			<div class="reveal mb-12">
				<p class="section-eyebrow">What will always be free</p>
				<h2 class="section-heading">Free means the whole thing.</h2>
			</div>
			<div class="grid grid-cols-1 gap-5 sm:grid-cols-2">
				<div class="reveal promise-cell">
					<div class="promise-icon-wrap" style="background:rgba(168,85,247,0.08);">
						<PenLine size={22} strokeWidth={1.5} color="#a855f7" />
					</div>
					<div>
						<p class="promise-title">The full editor</p>
						<p class="promise-body">
							Branches, annotations — everything. We don't gate features.
						</p>
					</div>
				</div>
				<div class="reveal promise-cell">
					<div class="promise-icon-wrap" style="background:rgba(59,130,246,0.08);">
						<WifiOff size={22} strokeWidth={1.5} color="#3b82f6" />
					</div>
					<div>
						<p class="promise-title">Local-first &amp; offline</p>
						<p class="promise-body">
							Your writing lives on your machine. No internet required; <a
								href="/blog/quillium-privacy"
								class="text-[#3b82f6] no-underline hover:underline">fully private</a
							>.
						</p>
					</div>
				</div>
				<div class="reveal promise-cell">
					<div class="promise-icon-wrap" style="background:rgba(34,197,94,0.08);">
						<ExternalLink size={22} strokeWidth={1.5} color="#22c55e" />
					</div>
					<div>
						<p class="promise-title">Your data, your exit</p>
						<p class="promise-body">
							Text export, anytime. Switching costs are how bad software traps you.
						</p>
					</div>
				</div>
				<div class="reveal promise-cell">
					<div class="promise-icon-wrap" style="background:rgba(252,188,5,0.1);">
						<CircleDollarSign size={22} strokeWidth={1.5} color="#d97706" />
					</div>
					<div>
						<p class="promise-title">Everything that matters</p>
						<p class="promise-body">
							Never pay us a cent and the app works the same. <a
								href="/blog/free-isnt-generosity"
								class="text-[#3b82f6] no-underline hover:underline">That's the point</a
							>
						</p>
					</div>
				</div>
			</div>
		</section>

		<div class="warm-divider section-divider"></div>

		<!-- Paid options -->
		<section id="paid" class="scroll-mt-28 py-16 sm:py-20">
			<div class="reveal mb-8">
				<p class="section-eyebrow">
					How Quillium sustains itself
					<span
						class="ml-2 rounded-full border border-[color:var(--border)] px-2 py-0.5 text-[0.6rem] font-medium tracking-normal text-[color:var(--text-faint)] normal-case"
						>Coming later</span
					>
				</p>
				<h2 class="section-heading">Services for people. Infrastructure for institutions.</h2>
			</div>

			<!-- Notice -->
			<div
				class="reveal mb-10 flex items-center gap-3 rounded-lg border border-amber-400/20 bg-amber-400/6 px-4 py-3"
			>
				<span
					class="shrink-0 rounded bg-amber-400/15 px-2 py-0.5 text-[0.6rem] font-bold tracking-[0.08em] text-[color:var(--accent-amber-text)] uppercase"
					>Note</span
				>
				<p class="m-0 text-[0.85rem] text-[color:var(--text-soft)]">
					These are <strong class="text-[color:var(--text)]">planned offerings</strong>. Right
					now, the Quillium editor is simply free, no strings attached.
				</p>
			</div>

			<div class="grid grid-cols-1 gap-6 sm:grid-cols-2 sm:items-stretch">
				<!-- Omni card -->
				<div class="reveal price-card price-card--blue">
					<div class="price-card-header">
						<p class="price-card-eyebrow" style="color:#3b82f6;">Quillium Omni</p>
						<p class="price-card-price">
							~$20<span class="price-card-unit">/month</span>
						</p>
						<p class="price-card-note">The more users we have, the cheaper we can make it.</p>
					</div>
					<div class="price-card-body">
						<ul class="space-y-3">
							<li class="check-item">Sync your documents everywhere, including mobile</li>
							<li class="check-item">
								Real-time collaboration. Invite anyone, even non-paying users
							</li>
							<li class="check-item">Cancel anytime; local data unaffected</li>
						</ul>
						<p class="price-card-fine mt-auto pt-5">
							Mobile is free for everyone: sync just works better with a plan.
						</p>
						<a href="/omni" class="price-card-cta">
							Join the waitlist <span aria-hidden="true">→</span>
						</a>
					</div>
				</div>

				<!-- Institutions card -->
				<div class="reveal price-card price-card--purple">
					<div class="price-card-header">
						<div class="mb-3 flex items-center gap-2 text-[#a855f7]">
							<GraduationCap size={20} strokeWidth={1.5} />
							<Building2 size={19} strokeWidth={1.5} />
						</div>
						<p class="price-card-eyebrow" style="color:#a855f7;">Education &amp; Organizations</p>
						<p class="price-card-price">
							Let's talk<span class="price-card-unit">annual plans</span>
						</p>
						<p class="price-card-note">Based on seats, support, and infrastructure needs.</p>
					</div>
					<div class="price-card-body">
						<ul class="space-y-3">
							<li class="check-item">A reviewable record of how writing developed</li>
							<li class="check-item">AI assistance inside one approved writing environment</li>
							<li class="check-item">Shared workspaces, collaboration, and managed access</li>
							<li class="check-item">Institutional support, controls, and exportable reports</li>
						</ul>
						<p class="price-card-fine mt-auto pt-5">
							For schools, writing programs, publishers, studios, and teams where the process
							matters as much as the final document.
						</p>
						<a
							href="mailto:support@quillium.bryanhu.com?subject=Quillium%20for%20our%20organization"
							class="price-card-cta"
						>
							Talk to us <span aria-hidden="true">→</span>
						</a>
					</div>
				</div>
			</div>
		</section>

		<div class="warm-divider section-divider"></div>

		<!-- Institutional value -->
		<section class="py-16 sm:py-20">
			<div class="reveal mb-12 max-w-2xl">
				<p class="section-eyebrow">Accountable, not invasive</p>
				<h2 class="section-heading">See the process. Don't guess at it.</h2>
				<p class="mt-4 text-[0.95rem] leading-[1.75] text-[color:var(--text-soft)]">
					AI detectors make a prediction about a finished document. Quillium can preserve the
					actual writing process: meaningful revisions, pasted material, feedback, and AI
					assistance used inside the app.
				</p>
			</div>
			<div class="institution-grid">
				<div class="reveal institution-item">
					<div class="institution-icon" style="background:rgba(59,130,246,0.08);">
						<History size={21} strokeWidth={1.5} color="#3b82f6" />
					</div>
					<p class="institution-title">Authorship, with context</p>
					<p class="institution-body">
						Review how a piece evolved instead of reducing authorship to a score.
					</p>
				</div>
				<div class="reveal institution-item">
					<div class="institution-icon" style="background:rgba(168,85,247,0.08);">
						<Sparkles size={21} strokeWidth={1.5} color="#a855f7" />
					</div>
					<p class="institution-title">AI in the open</p>
					<p class="institution-body">
						Offer useful AI tools in one environment where their contribution can be disclosed.
					</p>
				</div>
				<div class="reveal institution-item">
					<div class="institution-icon" style="background:rgba(34,197,94,0.08);">
						<ShieldCheck size={21} strokeWidth={1.5} color="#22c55e" />
					</div>
					<p class="institution-title">Trust goes both ways</p>
					<p class="institution-body">
						Writers should know what is recorded and exactly what gets shared before submission.
					</p>
				</div>
			</div>
		</section>

		<div class="warm-divider section-divider"></div>

		<!-- Why this model -->
		<section class="py-16 sm:py-20">
			<div class="reveal mb-12">
				<p class="section-eyebrow">Why this model</p>
				<h2 class="section-heading">Built to stay honest.</h2>
			</div>
			<div class="space-y-7">
				<div class="reveal why-row">
					<p class="why-label">Writers come first</p>
					<p class="why-text">
						The editor remains useful on its own. Institutions pay for coordination, oversight,
						and service — not access to the act of writing.
					</p>
				</div>
				<div class="reveal why-row">
					<p class="why-label">Survives us shutting down</p>
					<p class="why-text">
						The app works whether or not we exist. Your writing doesn't depend on our servers.
					</p>
				</div>
				<div class="reveal why-row">
					<p class="why-label">Omni is the right trade</p>
					<p class="why-text">
						It's an extra service, not a toll on things you already have. Skip it entirely if you
						want.
					</p>
				</div>
				<div class="reveal why-row">
					<p class="why-label">Organizations fund the cloud</p>
					<p class="why-text">
						Recurring institutional plans help cover the real cost of sync, collaboration, secure
						administration, and long-term support.
					</p>
				</div>
				<div class="reveal why-row">
					<p class="why-label">Have a better idea?</p>
					<p class="why-text">
						Genuinely, <a
							href="mailto:support@quillium.bryanhu.com"
							class="text-[#3b82f6] no-underline hover:underline">email us</a
						>.
					</p>
				</div>
			</div>
		</section>

		<!-- CTA -->
		<div
			class="reveal pt-14 pb-4 text-center"
			style="border-top: 2px solid; border-image: linear-gradient(90deg, transparent, #3b82f6, #a855f7, #22c55e, #fcbc05, transparent) 1;"
		>
			<p
				class="mb-6 font-[Newsreader,Georgia,serif] text-[clamp(1.75rem,4vw,2.25rem)] text-[color:var(--text-strong)] italic"
			>
				For one writer or a whole institution.
			</p>
			<div class="flex flex-wrap justify-center gap-3">
				<a href="/#download" class="btn-primary inline-flex items-center gap-2">
					<Download size={18} strokeWidth={1.5} class="shrink-0" />
					Download Quillium
				</a>
				<a
					href="mailto:support@quillium.bryanhu.com?subject=Quillium%20for%20our%20organization"
					class="organization-cta"
				>
					Bring Quillium to your organization
				</a>
			</div>
		</div>
	</div>
</main>

<Footer />

<style>
	/* Promise grid — mirrors the homepage feature-icon-wrap pattern */
	.promise-cell {
		display: flex;
		align-items: flex-start;
		gap: 16px;
		padding: 24px;
		border-radius: 14px;
		border: 1px solid var(--border);
		background: var(--surface);
		transition:
			transform 300ms ease,
			box-shadow 300ms ease;
	}
	.promise-cell:hover {
		transform: translateY(-2px);
		box-shadow:
			0 8px 32px rgba(var(--shadow-color), 0.1),
			0 2px 8px rgba(var(--shadow-color), 0.06);
	}
	.promise-icon-wrap {
		width: 44px;
		height: 44px;
		border-radius: 12px;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}
	.promise-title {
		font-size: 0.95rem;
		font-weight: 600;
		color: var(--text);
		margin: 0 0 5px 0;
	}
	.promise-body {
		font-size: 0.875rem;
		color: var(--text-soft);
		line-height: 1.65;
		margin: 0;
	}

	/* Price cards */
	.price-card {
		display: flex;
		height: 100%;
		flex-direction: column;
		overflow: hidden;
		border-radius: 16px;
		border: 1px solid var(--border);
		background: var(--surface);
		transition:
			transform 300ms ease,
			box-shadow 300ms ease;
	}
	.price-card:hover {
		transform: translateY(-2px);
		box-shadow:
			0 12px 40px rgba(var(--shadow-color), 0.12),
			0 3px 10px rgba(var(--shadow-color), 0.06);
	}
	.price-card--blue {
		border-top: 3px solid var(--accent-blue);
	}
	.price-card--purple {
		border-top: 3px solid var(--accent-purple);
	}
	.price-card-header {
		border-bottom: 1px solid var(--border);
		padding: 24px 28px 20px;
	}
	.price-card-eyebrow {
		margin: 0 0 8px;
		font-size: 0.65rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}
	.price-card-price {
		margin: 0;
		font-family: "Newsreader", Georgia, serif;
		font-size: 2.1rem;
		line-height: 1;
		font-style: italic;
		color: var(--text-strong);
	}
	.price-card-unit {
		font-size: 0.95rem;
		color: var(--text-faint);
		margin-left: 0.3em;
	}
	.price-card-note {
		margin: 8px 0 0;
		font-size: 0.75rem;
		color: var(--text-faint);
	}
	.price-card-body {
		display: flex;
		flex: 1;
		flex-direction: column;
		padding: 24px 28px;
	}
	.price-card-fine {
		margin: 0;
		font-size: 0.75rem;
		line-height: 1.6;
		color: var(--text-faint);
	}
	.price-card-cta {
		margin-top: 16px;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		align-self: flex-start;
		padding: 8px 18px;
		border-radius: 10px;
		border: 1px solid var(--border);
		background: color-mix(in srgb, var(--surface) 50%, transparent);
		font-size: 0.85rem;
		font-weight: 500;
		color: var(--text-strong);
		text-decoration: none;
		box-shadow: 0 2px 8px rgba(var(--shadow-color), 0.08);
		transition:
			transform 300ms ease,
			background 300ms ease;
	}
	.price-card-cta:hover {
		transform: translateY(-1px);
		background: var(--surface-2);
	}

	/* Institutional value */
	.institution-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 20px;
	}
	.institution-item {
		padding: 24px;
		border: 1px solid var(--border);
		border-radius: 14px;
		background: var(--surface);
	}
	.institution-icon {
		display: flex;
		width: 42px;
		height: 42px;
		align-items: center;
		justify-content: center;
		margin-bottom: 18px;
		border-radius: 11px;
	}
	.institution-title {
		margin: 0 0 7px;
		font-size: 0.925rem;
		font-weight: 600;
		color: var(--text);
	}
	.institution-body {
		margin: 0;
		font-size: 0.825rem;
		line-height: 1.65;
		color: var(--text-soft);
	}
	.organization-cta {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 10px 20px;
		border: 1px solid var(--border);
		border-radius: 10px;
		background: var(--surface);
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--text-strong);
		text-decoration: none;
		transition:
			transform 300ms ease,
			background 300ms ease;
	}
	.organization-cta:hover {
		transform: translateY(-1px);
		background: var(--surface-2);
	}
	@media (max-width: 700px) {
		.institution-grid {
			grid-template-columns: 1fr;
		}
	}

	/* Check items */
	.check-item {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		font-size: 0.875rem;
		line-height: 1.6;
		color: var(--text-soft);
	}
	.check-item::before {
		content: "";
		display: block;
		width: 13px;
		height: 13px;
		margin-top: 4px;
		flex-shrink: 0;
		background: url("data:image/svg+xml,%3Csvg width='14' height='14' viewBox='0 0 14 14' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M2.5 7l3 3 6-6' stroke='%2316a34a' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")
			no-repeat center;
		background-size: contain;
	}

	/* Why rows */
	.why-row {
		display: grid;
		grid-template-columns: 200px 1fr;
		gap: 24px;
		align-items: baseline;
	}
	@media (max-width: 480px) {
		.why-row {
			grid-template-columns: 1fr;
			gap: 3px;
		}
	}
	.why-label {
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--text);
		margin: 0;
	}
	.why-text {
		font-size: 0.925rem;
		color: var(--text-soft);
		line-height: 1.7;
		margin: 0;
	}
	.why-text a {
		color: var(--accent-blue);
	}
</style>
