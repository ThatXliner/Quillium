<script lang="ts">
import { trackDownload as captureDownload } from "$lib/analytics";
import posthog from "posthog-js";
import { onMount } from "svelte";

const REPO = "ThatXliner/quillium-releases";

let { release }: { release: { assets: { name: string; url: string }[] } } = $props();

function findAsset(pattern: string): string {
    const match = release.assets.find((asset: { url: string }) => asset.url.includes(pattern));
    return match?.url ?? `https://github.com/${REPO}/releases/latest`;
}

let detected = $state("unknown");
let downloadUrl = $derived.by(() => {
    if (detected === "mac") return findAsset("_aarch64.dmg");
    if (detected === "windows") return findAsset("_x64-setup.exe");
    if (detected === "linux") return findAsset("_amd64.deb");
    return `https://github.com/${REPO}/releases/latest`;
});
let heroEl = $state<HTMLElement>();

function trackDownload(): void {
    posthog.capture("cta_clicked", { cta: "download", location: "image-parallax-hero" });
    captureDownload(downloadUrl, detected, "image-parallax-hero");
}

onMount(() => {
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes("mac")) detected = "mac";
    else if (ua.includes("win")) detected = "windows";
    else if (ua.includes("linux")) detected = "linux";

    const hero = heroEl;
    if (!hero || matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let frame = 0;
    let pointerX = 0;
    let pointerY = 0;

    const render = (): void => {
        frame = 0;
        const rect = hero.getBoundingClientRect();
        const scrollDistance = Math.max(rect.height - innerHeight, 1);
        const scrollProgress = Math.max(0, Math.min(1, -rect.top / scrollDistance));
        hero.style.setProperty("--pointer-x", pointerX.toFixed(3));
        hero.style.setProperty("--pointer-y", pointerY.toFixed(3));
        hero.style.setProperty("--hero-scroll", scrollProgress.toFixed(3));
    };

    const requestRender = (): void => {
        if (!frame) frame = requestAnimationFrame(render);
    };

    const onPointerMove = (event: PointerEvent): void => {
        pointerX = event.clientX / innerWidth - 0.5;
        pointerY = event.clientY / innerHeight - 0.5;
        requestRender();
    };

    const onPointerLeave = (): void => {
        pointerX = 0;
        pointerY = 0;
        requestRender();
    };

    addEventListener("pointermove", onPointerMove, { passive: true });
    addEventListener("pointerleave", onPointerLeave);
    addEventListener("scroll", requestRender, { passive: true });
    addEventListener("resize", requestRender, { passive: true });
    render();

    return () => {
        if (frame) cancelAnimationFrame(frame);
        removeEventListener("pointermove", onPointerMove);
        removeEventListener("pointerleave", onPointerLeave);
        removeEventListener("scroll", requestRender);
        removeEventListener("resize", requestRender);
    };
});
</script>

<section bind:this={heroEl} class="image-hero">
    <div class="hero-viewport">
    <div class="image-stage" aria-hidden="true">
        <img
            class="layer layer-backplate"
            src="/hero-parallax/backplate.webp"
            alt=""
            fetchpriority="high"
            />
            <img class="layer layer-ribbons" src="/hero-parallax/ribbons.webp" alt="" />
            <div class="hand-enter">
                <div class="hand-breathe">
                    <img class="layer layer-hand" src="/hero-parallax/hand.webp" alt="" />
                </div>
            </div>
            <img class="layer layer-planes" src="/hero-parallax/planes.webp" alt="" />
        <div class="quill-spark"></div>
        <div class="atmosphere"></div>
        <div class="copy-scrim"></div>
    </div>

    <div class="hero-copy">
        <div class="brand-mark">
            <img src="/logo.svg" alt="Quillium mark" width="56" height="56" />
        </div>
        <p class="eyebrow">The writing app for people who rewrite</p>
        <h1>Write in <em>branches</em>.</h1>
        <p class="subhead">
            Follow an idea without sacrificing the sentence you already love. Every version stays
            close, ready when you are.
        </p>
        <div class="actions">
            <a class="primary-action" href={downloadUrl} onclick={trackDownload}>Download Now</a>
            <a class="secondary-action" href="#features">See how it works</a>
        </div>
        <p class="fine-print">
            Free to use. Your writing stays on your device.
        </p>
    </div>

    <div class="scroll-cue" aria-hidden="true">
        <span>Unfold the draft</span>
        <i></i>
    </div>

    <span class="sr-only">
        As the page scrolls, manuscript ribbons emerge from a silver quill held by a porcelain
        hand, then become paper planes drifting through a warm, dark studio.
    </span>
    </div>
</section>

<style>
    .image-hero {
        --pointer-x: 0;
        --pointer-y: 0;
        --hero-scroll: 0;
        position: relative;
        height: 260vh;
        min-height: 760px;
        isolation: isolate;
        background: #090705;
        color: #f7f1e3;
    }

    .hero-viewport {
        position: sticky;
        top: 0;
        height: 100vh;
        min-height: 760px;
        overflow: hidden;
    }

    .hero-viewport::after {
        position: absolute;
        z-index: 4;
        right: 0;
        bottom: 0;
        left: 0;
        height: clamp(7rem, 16vh, 11rem);
        background: linear-gradient(
            to bottom,
            transparent 0%,
            color-mix(in srgb, var(--bg) 24%, transparent) 35%,
            color-mix(in srgb, var(--bg) 76%, transparent) 76%,
            var(--bg) 100%
        );
        -webkit-backdrop-filter: blur(14px);
        backdrop-filter: blur(14px);
        -webkit-mask-image: linear-gradient(to bottom, transparent 0%, #000 48%, #000 100%);
        mask-image: linear-gradient(to bottom, transparent 0%, #000 48%, #000 100%);
        content: "";
        pointer-events: none;
    }

    .image-stage {
        position: absolute;
        inset: 0;
        overflow: hidden;
    }

    .layer {
        position: absolute;
        inset: -3%;
        width: 106%;
        height: 106%;
        object-fit: cover;
        object-position: 50% 50%;
        pointer-events: none;
        user-select: none;
        will-change: transform;
        transition: transform 600ms cubic-bezier(0.22, 1, 0.36, 1);
    }

    .layer-backplate {
        transform: scale(1.025)
            translate3d(
                calc(var(--pointer-x) * -8px),
                calc(var(--pointer-y) * -6px + var(--hero-scroll) * 10px),
                0
            );
    }

    .layer-ribbons {
        -webkit-mask-image: radial-gradient(
            circle at 52% 60%,
            #000 0,
            #000 calc(var(--hero-scroll) * 135% - 10%),
            transparent calc(var(--hero-scroll) * 135% + 10%)
        );
        mask-image: radial-gradient(
            circle at 52% 60%,
            #000 0,
            #000 calc(var(--hero-scroll) * 135% - 10%),
            transparent calc(var(--hero-scroll) * 135% + 10%)
        );
        opacity: clamp(0, calc(var(--hero-scroll) * 7), 1);
        transform: scale(1.035)
            translate3d(
                calc(var(--pointer-x) * 20px),
                calc(var(--pointer-y) * 12px + (1 - var(--hero-scroll)) * 12px),
                0
            );
    }

    .hand-enter,
    .hand-breathe {
        position: absolute;
        inset: 0;
        pointer-events: none;
        transform-origin: 78% 46%;
        will-change: opacity, transform;
    }

    .hand-enter {
        animation: hand-arrive 1.45s cubic-bezier(0.16, 1, 0.3, 1) both;
    }

    .hand-breathe {
        animation: hand-breathe 7s 1.45s ease-in-out infinite alternate;
    }

    .layer-hand {
        transform-origin: 76% 45%;
        transform: scale(1.025)
            translate3d(
                calc(var(--pointer-x) * 11px),
                calc(var(--pointer-y) * 8px - var(--hero-scroll) * 12px),
                0
            );
    }

    .layer-planes {
        opacity: clamp(0, calc((var(--hero-scroll) - 0.38) * 5), 1);
        transform: scale(1.04)
            translate3d(
                calc(var(--pointer-x) * 34px + (1 - var(--hero-scroll)) * -70px),
                calc(var(--pointer-y) * 24px + (1 - var(--hero-scroll)) * 48px),
                0
            );
        animation: planes-breathe 7s ease-in-out infinite alternate;
    }

    .quill-spark {
        position: absolute;
        top: 60%;
        left: 52%;
        width: 9rem;
        height: 9rem;
        border-radius: 50%;
        opacity: clamp(0, calc(var(--hero-scroll) * 8), calc(1 - var(--hero-scroll)));
        background: radial-gradient(
            circle,
            rgba(255, 231, 179, 0.3),
            rgba(204, 154, 78, 0.08) 34%,
            transparent 70%
        );
        filter: blur(8px);
        pointer-events: none;
        transform: translate(-50%, -50%) scale(calc(0.35 + var(--hero-scroll) * 0.8));
    }

    .atmosphere {
        position: absolute;
        inset: 0;
        background:
            radial-gradient(circle at 70% 45%, transparent 12%, rgba(0, 0, 0, 0.16) 54%),
            linear-gradient(90deg, rgba(5, 3, 2, 0.24) 0%, transparent 44%);
        pointer-events: none;
    }

    .copy-scrim {
        position: absolute;
        inset: 0 auto 0 0;
        width: min(64vw, 980px);
        background: radial-gradient(
            ellipse 82% 68% at 28% 50%,
            rgba(9, 6, 4, 0.62) 0%,
            rgba(9, 6, 4, 0.2) 54%,
            transparent 76%
        );
        pointer-events: none;
    }

    .hero-copy {
        position: relative;
        z-index: 2;
        display: flex;
        min-height: 100vh;
        width: min(46rem, 52vw);
        margin-left: clamp(2rem, 8vw, 9rem);
        padding: 9rem 2rem 7rem 0;
        flex-direction: column;
        align-items: flex-start;
        justify-content: center;
        text-align: left;
    }

    .brand-mark {
        display: grid;
        width: 72px;
        height: 72px;
        margin-bottom: 2rem;
        place-items: center;
        border: 1px solid rgba(247, 241, 227, 0.18);
        border-radius: 20px;
        background: rgba(247, 241, 227, 0.08);
        box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.16),
            0 18px 60px rgba(0, 0, 0, 0.22);
        backdrop-filter: blur(14px);
    }

    .brand-mark img {
        filter: drop-shadow(0 6px 12px rgba(0, 0, 0, 0.24));
    }

    .eyebrow {
        margin: 0 0 1rem;
        font-size: 0.72rem;
        font-weight: 600;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: rgba(247, 241, 227, 0.65);
    }

    h1 {
        max-width: 760px;
        margin: 0;
        font-family: "Newsreader", Georgia, serif;
        font-size: clamp(3.8rem, 7vw, 6.9rem);
        font-weight: 400;
        line-height: 0.96;
        letter-spacing: -0.045em;
        color: #fffaf0;
        text-wrap: balance;
        text-shadow: 0 4px 30px rgba(0, 0, 0, 0.3);
    }

    h1 em {
        font-weight: 400;
    }

    .subhead {
        max-width: 32rem;
        margin: 1.8rem 0 0;
        font-size: clamp(1rem, 1.35vw, 1.15rem);
        line-height: 1.75;
        color: rgba(247, 241, 227, 0.76);
        text-wrap: pretty;
    }

    .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.85rem;
        margin-top: 2.2rem;
    }

    .primary-action,
    .secondary-action {
        display: inline-flex;
        min-height: 48px;
        align-items: center;
        justify-content: center;
        border-radius: 10px;
        padding: 0.75rem 1.55rem;
        font-size: 0.92rem;
        font-weight: 600;
        text-decoration: none;
        transition:
            transform 250ms ease,
            background 250ms ease,
            border-color 250ms ease;
    }

    .primary-action {
        background: #f7f1e3;
        color: #171310;
        box-shadow: 0 12px 36px rgba(0, 0, 0, 0.25);
    }

    .secondary-action {
        border: 1px solid rgba(247, 241, 227, 0.24);
        background: rgba(247, 241, 227, 0.08);
        color: #f7f1e3;
        backdrop-filter: blur(12px);
    }

    .primary-action:hover,
    .secondary-action:hover {
        transform: translateY(-2px);
    }

    .secondary-action:hover {
        border-color: rgba(247, 241, 227, 0.4);
        background: rgba(247, 241, 227, 0.14);
    }

    .fine-print {
        margin: 1rem 0 0;
        font-size: 0.72rem;
        color: rgba(247, 241, 227, 0.48);
    }

    .scroll-cue {
        position: absolute;
        z-index: 2;
        bottom: max(2rem, 5vh);
        left: 50%;
        display: flex;
        align-items: center;
        gap: 0.75rem;
        transform: translateX(-50%);
        font-size: 0.65rem;
        font-weight: 600;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: rgba(247, 241, 227, 0.44);
        opacity: clamp(0, calc(1 - var(--hero-scroll) * 5), 1);
    }

    .scroll-cue i {
        display: block;
        width: 42px;
        height: 1px;
        overflow: hidden;
        background: rgba(247, 241, 227, 0.18);
    }

    .scroll-cue i::after {
        display: block;
        width: 42px;
        height: 1px;
        animation: cue 2.2s ease-in-out infinite;
        background: rgba(247, 241, 227, 0.8);
        content: "";
        transform: translateX(-100%);
    }

    @keyframes planes-breathe {
        to {
            margin-top: -5px;
        }
    }

    @keyframes hand-arrive {
        from {
            opacity: 0;
            transform: translate3d(15vw, -6vh, 0) rotate(4deg) scale(0.96);
        }

        58% {
            opacity: 1;
        }

        to {
            opacity: 1;
            transform: translate3d(0, 0, 0) rotate(0) scale(1);
        }
    }

    @keyframes hand-breathe {
        from {
            transform: translate3d(0, 1px, 0) rotate(0.12deg) scale(1);
        }

        to {
            transform: translate3d(0, -6px, 0) rotate(-0.18deg) scale(1.003);
        }
    }

    @keyframes cue {
        50%,
        100% {
            transform: translateX(100%);
        }
    }

    @media (max-width: 1100px) {
        .hero-copy {
            width: min(38rem, 56vw);
            margin-left: clamp(2rem, 5vw, 5rem);
        }

        h1 {
            font-size: clamp(3.5rem, 7.5vw, 5.6rem);
        }
    }

    @media (prefers-reduced-motion: reduce) {
        .image-hero {
            height: 100vh;
        }

        .hero-viewport {
            position: relative;
        }

        .layer {
            transition: none;
            transform: scale(1.025);
        }

        .layer-ribbons {
            -webkit-mask-image: none;
            mask-image: none;
            opacity: 1;
        }

        .layer-planes,
        .hand-enter,
        .hand-breathe,
        .scroll-cue i::after {
            animation: none;
        }

        .layer-planes {
            opacity: 1;
        }

        .quill-spark {
            display: none;
        }
    }
</style>
