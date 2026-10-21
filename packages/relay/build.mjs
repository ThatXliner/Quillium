import { build } from "esbuild";

await build({
    entryPoints: ["src/index.ts"],
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    outdir: "dist",
    sourcemap: "external",
    external: ["bufferutil", "utf-8-validate"],
    banner: {
        js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
    },
});
