<script lang="ts">
import { ReadonlyShareView } from "@quillium/share";
import posthog from "posthog-js";

let { data } = $props();

const downloadUrl =
    "/?utm_source=shared-doc&utm_medium=share-page&utm_campaign=public-readonly-share#download";

function shareTokenSuffix(token: string): string {
    return token.slice(-8);
}

function trackInstallClick(location: "toolbar") {
    posthog.capture("shared_page_cta_clicked", {
        share_token_suffix: shareTokenSuffix(data.share.token),
        location,
    });
}

function trackView() {
    posthog.capture("shared_page_viewed", {
        share_token_suffix: shareTokenSuffix(data.share.token),
        has_author: !!data.share.authorName,
    });
}
</script>

<svelte:head>
	<title>{data.share.title} · Shared via Quillium</title>
	<meta
		name="description"
		content={data.share.excerpt || 'A read-only document shared from Quillium.'}
	/>
	<link rel="canonical" href={data.share.canonicalUrl} />
	<meta property="og:title" content={`${data.share.title} · Shared via Quillium`} />
	<meta
		property="og:description"
		content={data.share.excerpt || 'A read-only document shared from Quillium.'}
	/>
	<meta property="og:url" content={data.share.canonicalUrl} />
	<meta property="og:type" content="article" />
</svelte:head>

<ReadonlyShareView
	share={data.share}
	{downloadUrl}
	onInstallClick={trackInstallClick}
	onView={trackView}
/>
