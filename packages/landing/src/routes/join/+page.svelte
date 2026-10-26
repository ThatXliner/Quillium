<script lang="ts">
import { onMount } from "svelte";
import { Radio } from "lucide-svelte";

let token = $state<string | null>(null);
let ready = $state(false);
onMount(() => {
    const candidate = window.location.hash.slice(1);
    token = /^[A-Za-z0-9_-]{43}$/.test(candidate) ? candidate : null;
    ready = true;
});
</script>

<svelte:head
    ><title>Join a Live Room · Quillium</title><meta
        name="robots"
        content="noindex,nofollow"
    /><meta name="referrer" content="no-referrer" /><meta
        name="description"
        content="Open your Live Room invitation in Quillium."
    /></svelte:head
>

<main
    data-private-invitation
    class="ph-no-capture grid min-h-screen place-items-center bg-[#f3f2ef] px-6 py-16 text-[#353431]"
>
    <section class="w-full max-w-md rounded-2xl border border-black/5 bg-white p-8 shadow-sm">
        <div class="mb-5 grid size-11 place-items-center rounded-xl bg-blue-50 text-blue-700">
            <Radio size={22} />
        </div>
        <p class="mb-2 text-xs font-semibold tracking-wide text-black/45">QUILLIUM LIVE ROOM</p>
        <h1 class="mb-4 text-3xl font-semibold leading-tight">
            {ready && !token ? "This invitation link doesn't work" : "Write together in Quillium"}
        </h1>
        {#if !ready}<p role="status" class="text-sm text-black/55">
                Reading your invitation.
            </p>{:else if token}<p class="mb-6 text-sm leading-relaxed text-black/55">
                Open this invitation in the desktop app. The owner needs to keep the Live Room open
                while you join.
            </p>
            <a
                class="ph-no-capture flex min-h-11 items-center justify-center rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700"
                href={`quillium://join/${token}`}>Open in Quillium</a
            >
            <p class="mt-5 text-xs leading-relaxed text-black/45">
                Don't have Quillium yet? <a
                    href="https://github.com/ThatXliner/quillium-releases/releases/latest"
                    rel="noreferrer"
                    class="font-semibold text-blue-700 hover:underline">Download the desktop app</a
                >, then return to this invitation.
            </p>{:else}<p class="text-sm leading-relaxed text-black/55">
                Check that you copied the whole invitation link, or ask the owner for a new one.
            </p>{/if}
    </section>
</main>
