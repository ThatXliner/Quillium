# Quillium landing site

The public SvelteKit site hosts Web Preview, auth-link handling, product pages,
and server routes. Read [collaboration](../../docs/collaboration.md) for the
public-share data boundary.

Run from the repository root:

```sh
bun install
bun run landing:dev
```

For connected features, create `packages/landing/.env.local` from
[`.env.example`](.env.example) and fill in the relevant public values. That
example also records Supabase auth redirect URLs. Never place a service-role
key in frontend configuration.

Verify changes with `bun run landing:check` and `bun run landing:build`. Public
share changes also need the [cross-package E2E checks](../e2e/README.md).

The Vercel project root is `packages/landing`. The app uses
`@sveltejs/adapter-vercel` and consumes `@quillium/share` through the root Bun
workspace. See [the monorepo guide](../../docs/monorepo.md#deployments) for runtime
pins and deployment constraints.
