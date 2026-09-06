<script lang="ts">
import Footer from "$lib/components/Footer.svelte";
import Nav from "$lib/components/Nav.svelte";
import CollaborationDemo from "$lib/components/omni/CollaborationDemo.svelte";
import PaperSculpture from "$lib/components/omni/PaperSculpture.svelte";
import { ArrowDown, ArrowRight, Check, Cloud, Laptop, Plus, WifiOff } from "@lucide/svelte";
import posthog from "posthog-js";
import { onMount } from "svelte";

let email = $state("");
let submitting = $state(false);
let submitted = $state(false);
let error = $state("");

async function handleSubmit(e: Event): Promise<void> {
    e.preventDefault();
    if (!email || submitting) return;

    submitting = true;
    error = "";

    posthog.capture("omni_waitlist_submitted", { email });

    try {
        const res = await fetch("/api/omni-waitlist", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email }),
        });

        if (!res.ok) {
            const data = await res.json();
            if (data.error === "already_subscribed") {
                error = "You're already on the waitlist.";
            } else {
                error = "Something went wrong. Please try again.";
            }
            posthog.capture("omni_waitlist_failed", { email, error: data.error });
        } else {
            posthog.capture("omni_waitlist_succeeded");
            submitted = true;
        }
    } catch (err) {
        error = "Something went wrong. Please try again.";
        posthog.captureException(err);
    }

    submitting = false;
}

let page: HTMLElement;
const questions = [
    {
        question: "When can I use Omni?",
        answer: "Join the waitlist for early access. Active Quillium users get priority.",
    },
    {
        question: "Do my collaborators need a subscription?",
        answer: "No. Only the document owner needs a subscription.",
    },
    {
        question: "What happens if I cancel?",
        answer: "Your local documents stay yours. The free writing app keeps working.",
    },
    {
        question: "Can I write on my phone?",
        answer: "Not yet. Quillium is available on macOS, Windows, and Linux.",
    },
];

onMount(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (media.matches) return;
    const animations: Animation[] = [];
    const observer = new IntersectionObserver(
        (entries) => {
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                animations.push(
                    entry.target.animate(
                        [
                            { opacity: 0, transform: "translateY(24px)" },
                            { opacity: 1, transform: "translateY(0)" },
                        ],
                        { duration: 800, easing: "cubic-bezier(.2,.7,.2,1)" },
                    ),
                );
                observer.unobserve(entry.target);
            }
        },
        { threshold: 0.12 },
    );
    for (const element of page.querySelectorAll("[data-enter]")) observer.observe(element);
    const stopMotion = (): void => {
        if (media.matches) {
            observer.disconnect();
            for (const animation of animations) animation.finish();
        }
    };
    media.addEventListener("change", stopMotion);
    return () => {
        observer.disconnect();
        for (const animation of animations) animation.cancel();
        media.removeEventListener("change", stopMotion);
    };
});
</script>

<svelte:head>
  <title>Quillium Omni — Collaboration for writers, on your terms</title>
  <meta
    name="description"
    content="Quillium Omni brings your documents to every device and lets collaborators work alongside you without getting in your way. Join the waitlist."
  />
  <link rel="canonical" href="https://quillium.bryanhu.com/omni" />

  <!-- Open Graph -->
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://quillium.bryanhu.com/omni" />
  <meta
    property="og:title"
    content="Quillium Omni — Collaboration for writers, on your terms"
  />
  <meta
    property="og:description"
    content="Shared text, independent views. Cloud sync and real-time collaboration for Quillium — join the waitlist."
  />
  <meta property="og:site_name" content="Quillium" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta
    name="twitter:title"
    content="Quillium Omni — Collaboration for writers, on your terms"
  />
  <meta
    name="twitter:description"
    content="Shared text, independent views. Cloud sync and real-time collaboration for Quillium — join the waitlist."
  />

  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link
    rel="preconnect"
    href="https://fonts.gstatic.com"
    crossorigin="anonymous"
  />
  <link
    href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Newsreader:ital,wght@0,400;0,500;1,400&display=swap"
    rel="stylesheet"
  />
  <meta name="twitter:site" content="@quillium" />

  <!-- Structured Data: FAQPage -->
  {@html `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: questions.map(({ question, answer }) => ({
      "@type": "Question",
      name: question,
      acceptedAnswer: { "@type": "Answer", text: answer },
    })),
  })}<\/script>`}
</svelte:head>

{#snippet waitlistForm(id: string, showNote: boolean)}
  {#if !submitted}
    <form onsubmit={handleSubmit} class="waitlist-form">
      <label for={`${id}-email`}>Your email address</label>
      <div class="form-row">
        <input
          id={`${id}-email`}
          type="email"
          name="email"
          autocomplete="email"
          placeholder="you@example.com"
          bind:value={email}
          required
          aria-describedby={error
            ? `${id}-error`
            : showNote
              ? `${id}-note`
              : undefined}
          aria-invalid={!!error}
        /><button
          class="btn-primary"
          type="submit"
          disabled={!email || submitting}
          >{submitting ? "Joining…" : "Join the waitlist"}<ArrowRight
            size={16}
          /></button
        >
      </div>
      {#if error}<p id={`${id}-error`} class="form-error" role="alert">
          {error}
        </p>{/if}
      {#if showNote}
        <p id={`${id}-note`} class="small-copy">
          Active users get priority. <a href="/#download">Download Quillium</a> and
          start writing.
        </p>
      {/if}
    </form>
  {:else}
    <div class="success" role="status">
      <Check size={21} />
      <div>
        <strong>You're on the list.</strong>
        <p>We'll email you when your place is ready.</p>
      </div>
    </div>
  {/if}
{/snippet}

<Nav />
<main bind:this={page} class="omni-page">
  <section class="hero" aria-labelledby="omni-title">
    <div class="hero-copy">
      <p class="eyebrow">
        <span class="omni-mark" aria-hidden="true">∞</span> QUILLIUM OMNI
      </p>
      <h1 id="omni-title">A world beyond<br />your <em>desk.</em></h1>
      <p class="hero-description">
        Sync your drafts across devices. Collaborate with your editor, each in
        your own view.
      </p>
      {@render waitlistForm("hero", false)}
      <div class="hero-actions">
        <a class="text-link" href="#together"
          >Explore Omni <ArrowDown size={14} /></a
        >
      </div>
    </div>
    <div class="hero-art"><PaperSculpture /></div>
  </section>

  <section
    class="collaboration section-shell"
    id="together"
    aria-labelledby="collab-title"
  >
    <div class="chapter-heading" data-enter>
      <div>
        <h2 id="collab-title">Same story.<br /><em>Room for two minds.</em></h2>
      </div>
      <p>Share a draft without losing your own way of working.</p>
    </div>
    <CollaborationDemo />
  </section>

  <section class="everywhere section-shell" aria-labelledby="sync-title">
    <div class="sync-copy" data-enter>
      <h2 id="sync-title">
        Different place.<br /><em>Same train of thought.</em>
      </h2>
      <p>Your drafts and revision history follow you from laptop to desktop.</p>
      <div class="platforms">
        <Laptop size={15} /><span>macOS</span><span>Windows</span><span
          >Linux</span
        >
      </div>
      <p class="offline-note">
        <WifiOff size={16} /> Write offline. Sync when you reconnect.
      </p>
    </div>
    <div class="sync-visual" data-enter>
      <div class="sync-orbit orbit-one"></div>
      <div class="sync-orbit orbit-two"></div>
      <div class="device-mini mini-back">
        <div class="device-toolbar">
          <span></span><span></span><span></span>
        </div>
        <div class="device-document">
          <small>THE LIGHTHOUSE</small>
          <p>On the other shore,<br />someone was still awake.</p>
          <div class="device-lines"></div>
        </div>
        <span class="device-base"></span>
      </div>
      <div class="device-mini mini-front">
        <div class="device-toolbar">
          <span></span><span></span><span></span>
        </div>
        <div class="device-document">
          <small>THE LIGHTHOUSE</small>
          <p>On the other shore,<br />someone was still awake.</p>
          <div class="device-lines"></div>
        </div>
        <span class="device-base"></span>
      </div>
      <div class="sync-seal">
        <Cloud size={20} strokeWidth={1.3} />
      </div>
    </div>
  </section>

  <section
    class="invitation section-shell"
    id="waitlist"
    aria-labelledby="waitlist-title"
    data-enter
  >
    <div class="invitation-copy">
      <h2 id="waitlist-title">Get early access.</h2>
      <p>We'll email you when your place is ready.</p>
      {@render waitlistForm("omni", true)}
    </div>
    <aside class="pricing-note">
      <div class="pricing-top">
        <span class="omni-mark" aria-hidden="true">∞</span><span
          >QUILLIUM<br />OMNI</span
        >
      </div>
      <p class="price">~$20<span> / month</span></p>
      <p class="price-detail">Estimated pricing. The writing app stays free.</p>
      <div class="pricing-rule"></div>
      <p><Check size={14} /> Only owners pay. Collaborators join free.</p>
      <p><Check size={14} /> Cancel anytime. Keep your local work.</p>
      <a href="/pricing#paid">The full pricing story <ArrowRight size={14} /></a
      >
    </aside>
  </section>

  <section class="faq section-shell" data-enter>
    <div>
      <h2>Before you <em>begin.</em></h2>
    </div>
    <div class="questions">
      {#each questions as item}<details>
          <summary>{item.question}<Plus size={17} /></summary>
          <p>{item.answer}</p>
        </details>{/each}
    </div>
  </section>
  <div class="omni-signoff section-shell" aria-hidden="true">
    <span>omni.</span>
  </div>
</main>
<Footer />

<style>
  .omni-page {
    overflow: clip;
  }
  .collaboration {
    padding-top: 40px;
  }
  .offline-note {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 24px;
    font-size: 14px;
    color: var(--text-soft);
  }
  .hero-description {
    max-width: 400px;
  }
  .section-shell {
    max-width: 1120px;
    margin: 0 auto;
    padding-left: 32px;
    padding-right: 32px;
  }
  .eyebrow {
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.12em;
    color: var(--text-soft);
  }
  .omni-mark {
    font:
      38px/1 Georgia,
      serif;
    letter-spacing: -0.07em;
    color: var(--accent-blue);
  }
  h1,
  h2 {
    font-family: "Newsreader", Georgia, serif;
    font-weight: 400;
  }
  h2 {
    font-size: clamp(1.75rem, 4vw, 2.75rem);
    line-height: 1.15;
    letter-spacing: -0.02em;
  }
  h2 em,
  h1 em {
    color: inherit;
    font-weight: 400;
  }
  .hero {
    max-width: 1320px;
    margin: auto;
    position: relative;
    min-height: 780px;
    height: min(900px, 100svh);
    padding: 170px 72px 90px;
    display: flex;
    align-items: center;
  }
  .hero-copy {
    width: 54%;
    position: relative;
    z-index: 2;
    pointer-events: none;
  }
  .hero-copy a,
  .hero-copy form {
    pointer-events: auto;
  }

  h1 {
    font-size: clamp(2.8rem, 6vw, 4.6rem);
    line-height: 1.08;
    letter-spacing: -0.03em;
    margin: 30px 0 27px;
  }
  .hero-description {
    font-size: 18px;
    line-height: 1.6;
    color: var(--text);
    letter-spacing: -0.025em;
  }

  .hero-copy .waitlist-form {
    max-width: 510px;
  }
  .hero-actions {
    display: flex;
    align-items: center;
    gap: 28px;
    margin-top: 32px;
  }
  .text-link {
    display: inline-flex;
    align-items: center;
    gap: 9px;
    font-size: 14px;
    color: var(--text);
    text-decoration: none;
  }
  .text-link:hover {
    text-decoration: underline;
    text-underline-offset: 5px;
  }

  .hero-art {
    position: absolute;
    width: 61%;
    height: 700px;
    top: 100px;
    right: -40px;
  }

  .chapter-heading {
    display: flex;
    justify-content: space-between;
    gap: 70px;
    align-items: flex-end;
    margin-bottom: 40px;
  }
  .chapter-heading h2 {
    margin-top: 24px;
  }
  .chapter-heading > p {
    width: 305px;
    font-size: 15px;
    line-height: 1.9;
    color: var(--text-soft);
    padding-bottom: 4px;
  }

  .everywhere {
    display: grid;
    grid-template-columns: 1fr 1fr;
    align-items: center;
    gap: 30px;
    padding-top: 145px;
    padding-bottom: 120px;
  }
  .sync-copy h2 {
    margin: 24px 0;
  }
  .sync-copy > p:not(.eyebrow, .small-copy) {
    max-width: 325px;
    font-size: 15px;
    line-height: 1.9;
    color: var(--text-soft);
  }
  .platforms {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-top: 28px;
    font-size: 12px;
    color: var(--text);
  }
  .small-copy {
    font-size: 12px;
    line-height: 1.8;
    color: var(--text-soft);
    margin-top: 13px;
  }
  .sync-visual {
    position: relative;
    height: 410px;
  }
  .sync-orbit {
    border: 1px solid var(--border-strong);
    border-radius: 50%;
    position: absolute;
    inset: 50px 0;
    transform: rotate(-25deg);
  }
  .orbit-two {
    inset: 20px 60px;
    transform: rotate(25deg);
    border-style: dashed;
    opacity: 0.6;
  }
  .device-mini {
    position: absolute;
    width: 238px;
    height: 162px;
    border: 4px solid #555957;
    border-bottom-width: 9px;
    background: #e2e1da;
    border-radius: 8px;
    box-shadow: 10px 20px 35px rgba(var(--shadow-color), 0.14);
  }
  .mini-back {
    top: 25px;
    right: 10px;
    transform: perspective(900px) rotateY(-18deg) rotateX(6deg) rotateZ(7deg);
  }
  .mini-front {
    bottom: 42px;
    left: 10px;
    transform: perspective(900px) rotateY(16deg) rotateX(6deg) rotateZ(-8deg);
  }
  .device-toolbar {
    height: 14px;
    display: flex;
    gap: 3px;
    padding: 5px;
  }
  .device-toolbar span {
    width: 3px;
    height: 3px;
    background: #aaa99f;
    border-radius: 50%;
  }
  .device-document {
    width: 72%;
    margin: auto;
    padding: 13px 18px;
    height: 126px;
    background: #fffefb;
    color: #484a43;
  }
  .device-document small {
    font-size: 5px;
    letter-spacing: 0.1em;
  }
  .device-document p {
    font:
      11px/1.5 Georgia,
      serif;
    margin: 9px 0;
  }
  .device-lines {
    background: repeating-linear-gradient(transparent 0 7px, #d0d1c8 7px 8px);
    height: 29px;
  }
  .device-base {
    position: absolute;
    height: 7px;
    background: #898d89;
    left: -15px;
    right: -15px;
    bottom: -13px;
    border-radius: 1px 1px 10px 10px;
  }

  .sync-seal {
    position: absolute;
    top: 45%;
    left: 52%;
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 11px 16px;
    border: 1px solid var(--border-strong);
    background: var(--surface);
    color: var(--accent-blue);
    border-radius: 40px;
    box-shadow: 0 5px 15px rgba(var(--shadow-color), 0.05);
  }

  .invitation {
    display: grid;
    grid-template-columns: 1.35fr 1fr;
    gap: 90px;
    padding-top: 60px;
    padding-bottom: 125px;
    scroll-margin-top: 100px;
  }
  .invitation h2 {
    font-size: 49px;
    margin: 25px 0 22px;
  }
  .invitation-copy > p:not(.eyebrow) {
    max-width: 340px;
    font-size: 15px;
    line-height: 1.8;
    color: var(--text-soft);
  }
  .waitlist-form {
    margin-top: 28px;
  }
  .waitlist-form label {
    display: block;
    font-size: 12px;
    margin-bottom: 9px;
    color: var(--text);
  }
  .form-row {
    display: flex;
    gap: 8px;
  }
  .form-row input {
    min-width: 0;
    flex: 1;
    padding: 12px 16px;
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: 10px;
    font-size: 16px;
    color: var(--text);
  }
  .form-row input::placeholder {
    color: var(--text-soft);
  }
  .form-row button:disabled {
    opacity: 0.6;
    cursor: default;
    transform: none;
    box-shadow: none;
  }
  .waitlist-form a {
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .form-error {
    color: #b33c36;
    font-size: 12px;
    margin-top: 10px;
  }
  .success {
    display: flex;
    align-items: flex-start;
    gap: 14px;
    padding: 20px;
    margin-top: 25px;
    border: 1px solid var(--tint-green-border);
    background: var(--tint-green);
    border-radius: 6px;
  }
  .success strong {
    font-size: 14px;
    font-weight: 500;
  }
  .success p {
    font-size: 12px;
    line-height: 1.7;
    margin-top: 7px;
    color: var(--text-soft);
  }
  .pricing-note {
    padding: 30px;
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: 14px;
    box-shadow: 0 8px 24px rgba(var(--shadow-color), 0.05);
  }
  .pricing-top {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .pricing-top > span:last-child {
    font-size: 8px;
    line-height: 1.5;
    letter-spacing: 0.13em;
  }
  .price {
    font:
      48px "Newsreader",
      Georgia,
      serif;
    margin-top: 20px;
    letter-spacing: -0.03em;
  }
  .price span {
    font:
      11px Inter,
      sans-serif;
    color: var(--text-soft);
    letter-spacing: 0;
  }
  .price-detail {
    font-size: 12px;
    line-height: 1.8;
    color: var(--text-soft);
    margin-top: 5px;
  }
  .pricing-rule {
    height: 1px;
    background: var(--border);
    margin: 23px 0;
  }
  .pricing-note > p:not(.price, .price-detail) {
    display: flex;
    gap: 9px;
    font-size: 13px;
    color: var(--text);
    margin: 12px 0;
  }
  .pricing-note > p :global(svg) {
    color: var(--accent-blue);
    flex-shrink: 0;
  }
  .pricing-note > a {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 13px;
    color: var(--accent-blue);
    margin-top: 28px;
    text-decoration: none;
  }
  .pricing-note > a:hover {
    text-decoration: underline;
  }
  .faq {
    display: grid;
    grid-template-columns: 1fr 1.3fr;
    gap: 90px;
    padding-bottom: 110px;
  }
  .faq h2 {
    font-size: 39px;
    margin-top: 20px;
  }
  details {
    border-bottom: 1px solid var(--border-strong);
  }
  details:first-child {
    border-top: 1px solid var(--border-strong);
  }
  summary {
    display: flex;
    justify-content: space-between;
    gap: 20px;
    align-items: center;
    list-style: none;
    padding: 23px 0;
    font-size: 14px;
    cursor: pointer;
  }
  summary::-webkit-details-marker {
    display: none;
  }
  summary :global(svg) {
    transition: transform 200ms;
    flex-shrink: 0;
  }
  details[open] summary :global(svg) {
    transform: rotate(45deg);
  }
  details > p {
    font-size: 14px;
    line-height: 1.9;
    color: var(--text-soft);
    padding: 0 25px 22px 0;
  }

  #together {
    scroll-margin-top: 100px;
  }
  a:focus-visible,
  button:focus-visible,
  summary:focus-visible,
  input:focus-visible {
    outline: 2px solid var(--accent-blue);
    outline-offset: 4px;
  }
  @media (prefers-color-scheme: dark) {
    .form-error {
      color: #f69a91;
    }
  }
  @media (min-width: 1450px) {
    .hero-art {
      right: -60px;
      width: 64%;
    }
  }
  @media (max-width: 1050px) {
    .hero {
      padding-left: 42px;
      padding-right: 42px;
      min-height: 790px;
    }
    h1 {
      font-size: clamp(2.8rem, 6vw, 4.6rem);
    }
    .hero-art {
      width: 58%;
      right: -10px;
      top: 110px;
      height: 620px;
    }
    .hero-copy {
      width: 58%;
    }

    .invitation {
      gap: 45px;
    }
    .invitation h2 {
      font-size: 43px;
    }
  }
  @media (max-width: 700px) {
    .section-shell {
      padding-left: 24px;
      padding-right: 24px;
    }
    .hero {
      display: block;
      height: auto;
      min-height: auto;
      padding: 120px 24px 65px;
    }
    .hero-copy {
      width: 100%;
    }
    h1 {
      font-size: clamp(2.8rem, 9vw, 4rem);
      margin: 27px 0 23px;
    }
    .hero-description {
      font-size: 16px;
    }

    .hero-actions {
      flex-wrap: wrap;
      margin-top: 25px;
      gap: 25px;
    }

    .hero-art {
      position: relative;
      width: calc(100% + 48px);
      height: 450px;
      top: auto;
      right: auto;
      margin: 0 -24px -5px;
    }

    h2 {
      font-size: 37px;
    }
    .chapter-heading {
      display: block;
      margin-bottom: 28px;
    }
    .chapter-heading > p {
      width: auto;
      max-width: 370px;
      margin-top: 22px;
      font-size: 12px;
    }

    .everywhere {
      grid-template-columns: 1fr;
      padding-top: 85px;
      padding-bottom: 50px;
      gap: 20px;
    }
    .sync-copy h2 {
      font-size: 39px;
    }
    .sync-visual {
      height: 360px;
      max-width: 440px;
      width: 100%;
      margin: auto;
    }
    .device-mini {
      width: 205px;
      height: 150px;
    }
    .device-document {
      height: 113px;
      padding: 9px 12px;
    }
    .device-document p {
      font-size: 10px;
    }
    .mini-front {
      bottom: 40px;
      left: 5px;
    }
    .mini-back {
      top: 25px;
      right: 5px;
    }
    .sync-seal {
      left: 47%;
    }

    .invitation {
      grid-template-columns: 1fr;
      gap: 45px;
      padding-top: 85px;
      padding-bottom: 85px;
    }
    .invitation h2 {
      font-size: 40px;
    }
    .form-row {
      flex-wrap: wrap;
      gap: 4px;
    }
    .form-row input {
      width: 100%;
      flex-basis: 150px;
    }
    .pricing-note {
      max-width: 420px;
    }
    .faq {
      grid-template-columns: 1fr;
      gap: 28px;
      padding-bottom: 70px;
    }
    .faq h2 {
      font-size: 35px;
    }
  }
  @media (max-width: 1050px) {
    .form-row {
      flex-direction: column;
    }
    .form-row input {
      flex-basis: auto;
      width: 100%;
    }
    .form-row button {
      justify-content: center;
    }
  }
  .omni-signoff {
    position: relative;
    height: 260px;
    overflow: hidden;
    border-top: 1px solid var(--border-strong);
  }
  .omni-signoff span {
    position: absolute;
    right: 10px;
    bottom: -74px;
    font: italic 270px/1 "Newsreader", Georgia, serif;
    letter-spacing: -0.07em;
    color: var(--text-strong);
    opacity: 0.5;
    pointer-events: none;
  }
  @media (max-width: 700px) {
    .omni-signoff { height: 200px; margin: 0 24px; }
    .omni-signoff span { font-size: 200px; bottom: -55px; }
  }
  @media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
      transition: none !important;
    }
    :global(html:has(.omni-page)) {
      scroll-behavior: auto;
    }
  }
</style>
