import adapter from "@sveltejs/adapter-vercel";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { mdsvex } from "mdsvex";
import relativeImages from "mdsvex-relative-images";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypeSlug from "rehype-slug";

/** @type {import('@sveltejs/kit').Config} */
const config = {
    // Consult https://svelte.dev/docs/kit/integrations
    // for more information about preprocessors
    preprocess: [
        vitePreprocess(),
        mdsvex({
            extensions: [".svx", ".md"],
            remarkPlugins: [relativeImages],
            rehypePlugins: [rehypeSlug, [rehypeAutolinkHeadings, { behavior: "wrap" }]],
        }),
    ],
    kit: {
        adapter: adapter(),
        paths: { relative: false },
        alias: { $assets: "src/lib/assets" },
    },
    extensions: [".svelte", ".svx", ".md"],
};

export default config;
