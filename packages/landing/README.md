# Quillium Landing

Public website, auth-link handler, read-only share pages, and lightweight server
routes for Quillium.

## Development

```sh
bun install
bun run landing:dev
```

## Vercel

Keep the Vercel project root set to `packages/landing`. The app uses
`@sveltejs/adapter-vercel` and imports shared read-only share UI from
`@quillium/share` through Bun workspaces.
