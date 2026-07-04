# Shipora Backend

Cloudflare Worker (Hono) backend for Shipora — a Shopify shipping-photo-proof app.
Stores shops/users/orders/photos in **D1** + **R2**, syncs orders from Shopify, and
tags orders on photo upload so a marker appears in the Shopify order **Timeline**.

## Stack

- Cloudflare Workers + TypeScript + Hono
- D1 (SQLite) — metadata; R2 — photo bytes
- Shopify Admin GraphQL API `2025-10`
- Vitest + `@cloudflare/vitest-pool-workers` (Miniflare)

## Develop & test

```bash
npm install
npm test            # full suite (Miniflare, no live Shopify needed)
npx tsc --noEmit    # typecheck
npm run dev         # local wrangler dev
```

## API surface

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET  | `/health` | — | liveness |
| GET  | `/auth?shop=<domain>` | — | start OAuth install |
| GET  | `/auth/callback` | HMAC+state | finish install, sync orders, register webhooks |
| POST | `/webhooks/:topic` | webhook HMAC | orders/create·updated, app/uninstalled |
| POST | `/api/join` | join token | scan-to-join → create user + session |
| GET  | `/api/orders?status=&q=` | session | list orders (default `unfulfilled`) |
| POST | `/api/orders/:id/photos` | session | upload a photo (+ best-effort order tag) |
| GET  | `/api/orders/:id/photos` | session | list an order's photos |
| GET  | `/api/photos/:id/raw` | session | stream a photo |

## Deploy (Task 7 — manual)

1. **Create Cloudflare resources**

   ```bash
   npx wrangler d1 create shipora            # paste database_id into wrangler.jsonc
   npx wrangler r2 bucket create shipora-photos
   npx wrangler d1 migrations apply shipora --remote
   ```

2. **Create the Shopify app** (Partner Dashboard)
   - App URL: `https://<your-worker>.workers.dev/auth`
   - Allowed redirection URL: `https://<your-worker>.workers.dev/auth/callback`
   - Scopes: `read_orders,write_orders`
   - Copy the API key + secret.

3. **Configure secrets & vars**

   ```bash
   npx wrangler secret put SHOPIFY_API_SECRET
   npx wrangler secret put APP_SECRET
   ```

   In `wrangler.jsonc` `vars`, set real `SHOPIFY_API_KEY`, `SHOPIFY_SCOPES`, `APP_URL`,
   and **remove** the test `SHOPIFY_API_SECRET` / `APP_SECRET` from `vars` so the
   secrets take effect.

4. **Deploy & install**

   ```bash
   npx wrangler deploy
   ```

   Visit `https://<your-worker>.workers.dev/auth?shop=<dev-store>.myshopify.com`, approve.

5. **Verify end to end**
   - `npx wrangler d1 execute shipora --remote --command "SELECT order_number, fulfillment_status FROM orders"`
   - Upload a photo (via curl or Plan 3's PWA) → open the order in Shopify admin →
     confirm the tag `发货照片已上传` shows as an event in the order **Timeline**.

## Notes

- Thumbnails are generated client-side (PWA); the backend stores bytes verbatim.
- GDPR compliance webhooks, Shopify Billing, and Protected Customer Data approval
  are deferred until App-Store submission (self-use first).
