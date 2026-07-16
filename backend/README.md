# Shipora Backend

Cloudflare Worker (Hono) backend for Shipora — a Shopify shipping-photo-proof app.
Stores shops/users/orders/photos in **D1** + **R2**, syncs orders from Shopify, tags
orders on photo upload (a marker in the Shopify order **Timeline**), and surfaces the
photos in the order-details **admin block**.

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
| POST | `/api/me/name` | session | rename the signed-in staffer |
| GET  | `/api/orders?status=&q=&limit=&offset=` | session | list orders, paginated (default `unfulfilled`) |
| GET  | `/api/orders/:id` | session | order info + line items (image/qty/SKU) + shipping/billing address |
| POST | `/api/orders/:id/photos` | session | upload a photo (+ order tag) |
| GET  | `/api/orders/:id/photos` | session | list an order's photos |
| GET  | `/api/photos/:id/raw` | session | stream a photo |
| DELETE | `/api/photos/:id` | session | delete a photo |
| GET  | `/p/:id` | rate-limited, edge-cached | short unguessable public photo URL (used by the block) |
| GET  | `/admin` | Shopify host | embedded admin page; auto-starts OAuth if the shop isn't installed |
| POST | `/admin/api/join-qr` | session token | mint a warehouse join QR + link |
| POST | `/admin/api/reset-join-code` | session token | rotate the shop's join code (revoke old QRs) |
| GET  | `/admin/api/recent-photos?q=` | session token | latest 10 photos, filterable by order number |
| GET  | `/admin/api/order-photos?gid=` | session token | photos for a Shopify order GID (order-page block) |
| GET  | `/admin/api/settings` · POST | session token | photo retention days (get/set) |
| POST | `/admin/api/cleanup` | session token | delete expired photos now |
| GET  | `/admin/api/photos/:id/raw` | session token | stream a photo (admin) |

`session token` = Shopify App Bridge `id_token` (a JWT). `session` = the PWA's own
join-based token (signed with `APP_SECRET` + the shop's per-shop `join_secret`, so a
shop can revoke its own links). Public photo URLs (`/p/:id`) are unguessable UUIDs,
rate-limited per IP, and edge-cached.

## Deploy

> There is no separate "create Worker" step — `wrangler deploy` creates (or updates) the
> Worker named in `wrangler.jsonc` (`"name": "shipora-backend"`) and gives it a
> `https://<name>.<your-subdomain>.workers.dev` URL. Change `name` if you want a
> different Worker name.

0. **Prerequisites** — Node 18+, a Cloudflare account, a Shopify Partner/Dev account.

   ```bash
   cd backend
   npm install
   npx wrangler login          # authorize wrangler with your Cloudflare account
   ```

1. **Create Cloudflare resources** and wire their IDs into `wrangler.jsonc`

   ```bash
   npx wrangler d1 create shipora
   #  → copy the printed database_id into wrangler.jsonc  ("d1_databases"[0].database_id)

   npx wrangler r2 bucket create shipora-photos          # matches the "r2_buckets" binding

   npx wrangler d1 migrations apply shipora --remote     # create the tables
   ```

2. **Create the Shopify app** (Partner/Dev Dashboard → Apps → Create app manually)
   - App URL: `https://<name>.<subdomain>.workers.dev/admin`
   - Allowed redirection URL: `https://<name>.<subdomain>.workers.dev/auth/callback`
   - Scopes: `read_orders,write_orders`
   - Copy the **Client ID** and **Client secret**.

3. **Configure secrets & vars**

   Secrets are **never** committed — they live on Cloudflare (production) or in
   `.dev.vars` (local, gitignored). Set them:

   ```bash
   npx wrangler secret put APP_SECRET           # a long random string you generate
   npx wrangler secret put SHOPIFY_API_SECRET   # Shopify Client secret
   npx wrangler secret put SHOPIFY_API_KEY      # Shopify Client ID
   npx wrangler secret put ADMIN_KEY            # guards the standalone /qr page
   ```

   Non-secret config (`SHOPIFY_SCOPES`, `APP_URL`, `PWA_URL`) lives in `wrangler.jsonc`
   `vars` — set `APP_URL` to your Worker URL and `PWA_URL` to your deployed PWA origin.

   For **local** development, copy `.dev.vars.example` → `.dev.vars` and fill it in;
   `wrangler dev` reads it. Tests use the fixed values in `vitest.config.ts`.

4. **Deploy the Worker**

   ```bash
   npx wrangler deploy          # creates/updates the Worker + prints its URL
   ```

5. **Deploy the PWA and the block extension** (once, then re-deploy on changes)

   ```bash
   # PWA → Cloudflare Pages  (creates the project on first run)
   cd ../pwa
   VITE_API_BASE=https://<name>.<subdomain>.workers.dev npm run build
   npx wrangler pages deploy dist --project-name=shipora-pwa
   #  → set the backend var PWA_URL to the printed Pages URL, then re-`wrangler deploy` the backend

   # Order-page block extension (optional) → Shopify
   cd ../shopify-app
   npx @shopify/cli app deploy
   ```

6. **Install on a store & verify**
   - Open the app in Shopify admin (or the Custom-distribution install link). `/admin`
     auto-starts OAuth if the shop isn't installed yet; approve the scopes.
   - `npx wrangler d1 execute shipora --remote --command "SELECT order_number, fulfillment_status FROM orders"`
   - Upload a photo (via the PWA) → open the order in Shopify admin → confirm the tag
     **`Shipping photos uploaded`** in the order **Timeline** and the **Shipora block**.

## On photo upload

Each upload best-effort adds the order **tag** `Shipping photos uploaded` to Shopify
(failures never fail the upload) → a marker event in the order **Timeline** and a handle
for filtering orders.

Photos are viewed on the order page via the **order-details block extension**
(`shopify-app/`, deployed with the Shopify CLI), which calls `/admin/api/order-photos`
and links to the short `/p/:id` URLs.

## Notes

- Thumbnails and rotation are done client-side (PWA canvas); the backend stores bytes verbatim.
- Uploads are image-only (`jpeg`/`png`/`webp`) and capped at 12 MB; served with `nosniff`.
- A daily cron (`0 3 * * *`) deletes photos older than each shop's retention window.
- GDPR compliance webhooks, Shopify Billing, and full Protected Customer Data approval
  are deferred until App-Store submission (self-use first).
