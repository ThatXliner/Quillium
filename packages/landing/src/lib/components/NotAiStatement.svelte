<script lang="ts">
// NotAiStatement.svelte — the explicit "not an AI app" declaration, placed
// right after the hero. Visitors default to assuming any new writing tool is
// AI-powered (see /blog/quillium-is-not-an-ai-app), so the denial has to be
// said out loud — but as a confident identity statement with room to breathe,
// not a defensive footnote. Copy is lifted from that post.
import posthog from "posthog-js";
</script>

<section class="reveal statement">
    <p class="section-eyebrow section-eyebrow--centered">Let's clear this up</p>
    <h2 class="statement-heading">Not an AI writing app.</h2>
    <p class="statement-body">
        Quillium never generates text, never autocompletes your sentence, never "fixes" a word
        behind your back. It's <strong>version control for prose</strong>. Branch and fork your writing,
        the way programmers have kept every version for decades.
    </p>
    <p class="statement-kicker">The words are yours. All of them.</p>
    <a
        href="/blog/quillium-is-not-an-ai-app"
        class="statement-link"
        onclick={() => posthog.capture("cta_clicked", { cta: "not-ai-post", location: "statement" })}
    >
        Read the full stance →
    </a>
</section>

<style>
    .statement {
        max-width: 42rem;
        margin: 0 auto;
        padding: 72px 24px;
        text-align: center;
    }
    .statement-heading {
        font-family: "Newsreader", Georgia, serif;
        font-size: clamp(2rem, 4.5vw, 3rem);
        font-weight: 400;
        letter-spacing: -0.02em;
        line-height: 1.15;
        color: var(--text-strong);
        margin: 0 0 20px;
    }
    .statement-body {
        font-size: 1.05rem;
        line-height: 1.8;
        color: var(--text-soft);
        margin: 0 0 14px;
    }
    .statement-body strong {
        color: var(--text-strong);
        font-weight: 600;
    }
    .statement-kicker {
        font-family: "Newsreader", Georgia, serif;
        font-style: italic;
        font-size: 1.15rem;
        color: var(--text);
        margin: 0 0 24px;
    }
    .statement-link {
        font-size: 0.9rem;
        font-weight: 500;
        color: var(--text-soft);
        text-decoration: underline;
        text-underline-offset: 3px;
        transition: color 200ms ease;
    }
    .statement-link:hover {
        color: var(--text);
    }
</style>
