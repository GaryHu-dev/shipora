# StockProof Backend

Cloudflare Worker (Hono) backend for StockProof — a Shopify stock assistant covering both
sides of the warehouse. **Goods in:** parse supplier delivery-note PDFs and add the delivered
quantities to Shopify stock, with a downloadable per-import history (expiry-date write-back is
built but disabled for now — see below). **Goods out:** sync orders, tag them on photo upload
(a marker in the Shopify order **Timeline**), and surface the proof-of-shipment photos in the
order-details **admin block**. Stores shops/users/orders/photos/import-history in **D1** and
photo + PDF bytes in **R2**.

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
npm run dev         # esbuild build (build.mjs) → wrangler dev on dist/index.mjs
```

> The Worker is pre-bundled by `build.mjs` (esbuild, `target: esnext`) and run/deployed with
> `--no-bundle`. Wrangler's bundled esbuild lowers PDF.js's `static {}` blocks, which breaks
> `unpdf` at runtime in the Worker; a current esbuild at `esnext` keeps them native. Vitest
> (Vite) is unaffected, so tests run against `src/` directly.

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
| POST | `/admin/api/purchase-orders/parse` | session token | upload a delivery-note PDF → parsed + matched lines (no writes) |
| POST | `/admin/api/purchase-orders/confirm` | session token | add delivered qty to Shopify stock + record the import |
| GET  | `/admin/api/purchase-orders?limit=&offset=` | session token | import history, newest first |
| GET  | `/admin/api/purchase-orders/:id` | session token | one import + its per-line results |
| GET  | `/admin/api/purchase-orders/:id/pdf` | session token | download the original PDF |
| GET  | `/admin/api/products/search?q=` | session token | variant candidates (manual product picker) |

`session token` = Shopify App Bridge `id_token` (a JWT). `session` = the PWA's own
join-based token (signed with `APP_SECRET` + the shop's per-shop `join_secret`, so a
shop can revoke its own links). Public photo URLs (`/p/:id`) are unguessable UUIDs,
rate-limited per IP, and edge-cached.

## Deploy

> There is no separate "create Worker" step — `npm run deploy` (which runs `wrangler deploy`) creates (or updates) the
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
   - Scopes: `read_orders,write_orders,read_products,write_products,read_inventory,write_inventory,read_locations`
     (orders/tagging for photo proof; products/inventory/locations for purchase-order import)
   - Copy the **Client ID** and **Client secret**.

   > Already have a shop installed from before the purchase-order feature? Re-visit
   > `/auth?shop=<domain>.myshopify.com` once so it re-grants the added
   > product/inventory/location scopes — the callback updates the stored token in place.

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
   npm run deploy               # esbuild build (build.mjs) + wrangler deploy --no-bundle
   ```
   > Use `npm run deploy`, not bare `npx wrangler deploy` — the Worker must be pre-bundled at
   > `target: esnext` so `unpdf`/PDF.js loads at runtime (see the note under **Develop & test**).

5. **Deploy the PWA and the block extension** (once, then re-deploy on changes)

   ```bash
   # PWA → Cloudflare Pages  (creates the project on first run)
   cd ../pwa
   VITE_API_BASE=https://<name>.<subdomain>.workers.dev npm run build
   npx wrangler pages deploy dist --project-name=shipora-pwa
   #  → set the backend var PWA_URL to the printed Pages URL, then re-run `npm run deploy` in backend/

   # Order-page block extension (optional) → Shopify
   cd ../shopify-app
   npx @shopify/cli app deploy
   ```

6. **Install on a store & verify**
   - Open the app in Shopify admin (or the Custom-distribution install link). `/admin`
     auto-starts OAuth if the shop isn't installed yet; approve the scopes.
   - `npx wrangler d1 execute shipora --remote --command "SELECT order_number, fulfillment_status FROM orders"`
   - Upload a photo (via the PWA) → open the order in Shopify admin → confirm the tag
     **`Shipping photos uploaded`** in the order **Timeline** and the **StockProof block**.

## On photo upload

Each upload best-effort adds the order **tag** `Shipping photos uploaded` to Shopify
(failures never fail the upload) → a marker event in the order **Timeline** and a handle
for filtering orders.

Photos are viewed on the order page via the **order-details block extension**
(`shopify-app/`, deployed with the Shopify CLI), which calls `/admin/api/order-photos`
and links to the short `/p/:id` URLs.

## Purchase-order import

`parse` reads a supplier delivery-note PDF (`unpdf`, layout-specific to the Fonterra
delivery docket — parsing throws rather than guessing if the columns don't match) into
lines, matches each to a Shopify variant (exact SKU → the `material_code_map` table →
fuzzy title match, with product title + thumbnail), and returns current stock and the
parsed expiry for the merchant to review. Nothing is written.

`confirm` applies the reviewed lines, one at a time and independently (one line failing
never blocks the rest; every line — including skipped — is recorded):

- Stock is **additive** — `inventoryAdjustQuantities` with `delta = deliveredQty`, never an
  absolute set.
- **Expiry-date write-back is disabled for now** — `confirm` updates stock only. The path (a
  `shipora.expiry_date` variant metafield, written only when the variant's stock at the chosen
  location was 0 before the adjustment) is in place and commented in `processConfirmLine`
  (`src/routes/purchaseOrders.ts`), one line to re-enable.
- A line matched by anything other than an exact SKU is remembered in `material_code_map`
  for next time.

The original PDF goes to R2 at `po/{shop_id}/{import_id}.pdf` (the same bucket as photos, a
disjoint keyspace — the retention cron only touches photos, so PDFs are never auto-deleted).
Each import and its per-line diff are stored in `purchase_order_imports` /
`purchase_order_import_lines` (migration `0004`) and surfaced under the admin **History** tab.

## Notes

- Thumbnails and rotation are done client-side (PWA canvas); the backend stores bytes verbatim.
- Uploads are image-only (`jpeg`/`png`/`webp`) and capped at 12 MB; served with `nosniff`.
- A daily cron (`0 3 * * *`) deletes photos older than each shop's retention window.
- GDPR compliance webhooks, Shopify Billing, and full Protected Customer Data approval
  are deferred until App-Store submission (self-use first).
