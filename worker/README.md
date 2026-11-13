# Shared-base Worker

A Cloudflare Worker that receives purchases from the app (`POST /submit`), validates them against the merchant catalog in this repository, and appends them to `library/purchases.json` with a commit.

The only secret is `GITHUB_TOKEN`: a fine-grained GitHub token limited to this repository with **Contents: Read and write**. It is stored in the Worker's settings, never in the code or the app.

## Deploy

1. Once: in the Cloudflare dashboard open the Worker, **Settings → Variables and Secrets → Add**, type **Secret**, name `GITHUB_TOKEN`, paste the token.
2. From this folder: `npx wrangler deploy`. It uploads `worker.js` with the rate limit from `wrangler.toml`. Pasting the code in the dashboard editor leaves the Worker without the rate limit.

## Test

`node --test worker/worker.test.mjs` (from the repository root; no network).

## Limits

- At most 25 purchases per request and 32 KB per body.
- At most 3 requests per IP per minute (Cloudflare Rate Limiting binding `LIMITER`).
- Entries need a known sound and item pair, or a label, and a price within ±28% of a merchant pool that holds the item.
- Item name and quality come from the catalog. A label is kept only if a pool with that label holds the item at that price.
- An unreadable base on GitHub stops the write (502), so the base is never replaced by only the new entries.
