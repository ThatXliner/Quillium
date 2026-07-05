import { loadPublicShare } from "$lib/server/publicShare";
import { error } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

export const prerender = false;

export const load: PageServerLoad = async ({ fetch, params }) => {
    const share = await loadPublicShare(fetch, params.token);

    if (!share) {
        error(404, "Document not found or isn't public anymore.");
    }

    return { share };
};
