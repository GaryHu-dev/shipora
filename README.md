# StockProof

A Shopify **stock assistant** for warehouses — evidence on both sides of the door. Bring
stock **in** by importing supplier delivery-note PDFs (delivered quantities written back to
Shopify stock, with a downloadable import history), and send stock **out** with warehouse
staff photographing packed orders as **proof of shipment**. English UI; works for any
Shopify store; multi-tenant (one deployment serves many shops, each isolated).

**Goods in — purchase-order import** (merchant, in the Shopify admin)

1. Upload a supplier delivery-note PDF (Fonterra format) on the admin **Import** tab.
2. Each line is parsed — material code, description, expiry date (`SLED`), delivered
   quantity — and matched to a Shopify variant: exact SKU → a remembered material-code
   mapping → fuzzy title match → manual pick.
3. Review and edit on the confirmation screen (product, quantity, expiry, per-line skip),
   choose a location, then confirm.
4. On confirm, per line: the delivered quantity is **added** to Shopify stock
   (`current + delivered`, via `inventoryAdjustQuantities`). Every import is recorded — the
   original PDF plus a line-by-line diff — under the **History** tab, PDF downloadable.

> Expiry dates (`SLED`/BBD) are parsed from the delivery note and shown for review, but
> **never written back** — confirm updates stock only. The merchant reviews Best Before Dates
> by hand each month, so auto-writing would buy a few weeks of freshness while being the one
> place the app edits the public storefront without the merchant confirming that specific
> change. The earlier variant-metafield write-back path has been removed rather than left
> dormant. BBD lives in the product **description**, not a metafield — see `backend/src/bbd.ts`.

**Goods out — proof of shipment** (warehouse staff, on their phone)

1. A merchant installs the app (OAuth). Orders sync automatically and stay in sync via
   webhooks.
2. From the embedded admin page, the merchant shows a **join QR code**.
3. Warehouse staff scan it, enter their name, and get a mobile web app (PWA).
4. Staff open an order, take/pick one or more photos, review & rotate them, then upload.
5. Each upload:
   - adds the order **tag** `Shipping photos uploaded` → a marker in the order **Timeline**;
   - makes the photos viewable on the order page in the **StockProof block** and in the app.

> Shopify has no public API to write custom order-timeline content, so the timeline
> marker is an order **tag** (the reliable, supported approach); the **order-page block**
> is where the photos themselves are viewed.

## Features

**Shopify admin** (embedded page, served by the backend at `/admin`)
- **Photos** tab: join QR + **Reset code** (revoke leaked links per-shop), photo retention
  (configurable days) + one-click cleanup, **Recent photos** with order-number search.
- **Stock** tab: a merchant-curated product list for the weekly count. Stock is read **live**
  from Shopify on every load — nothing is cached, so the number shown can never drift from
  Shopify. Rows are read-only until opened; edit one or bulk-edit the lot, confirm each with
  ✓ (or Enter, which confirms and drops to the next row), then a dialog itemises every change
  before anything is written. Writes carry `compareQuantity`, so a sale landing between page
  load and save is **rejected rather than silently erased**. Per-row "last counted" plus a
  *Not counted this week* filter answer "what's left?" mid-count. Best Before Dates are parsed
  out of each product's description and shown; editing them is a later stage.
- **Import** tab: upload a supplier delivery-note PDF → parsed, matched (with product
  thumbnails, editable per line), previewed (current → resulting stock) → a confirmation
  dialog that **leads with the lines that will be skipped** → confirm to add the delivered
  quantities to Shopify stock. Imported products join the Stock tab automatically.
- **History** tab: every past import with per-line results; download the original PDF.
- Order-details **block extension** (`shopify-app/`): lists an order's photos with
  category badges + View links.

**Warehouse PWA** (`pwa/`)
- Scan-to-join with the shop's QR; name is remembered (long-lived session, auto re-login).
- Orders list: paginated (20 at a time, infinite scroll + "Load more"), tabs
  (Unfulfilled / All / Fulfilled), search, pull-to-refresh, background refresh, cached
  on return so the tab and scroll position are preserved.
- Order detail: items to pack (product image, qty, name, SKU), Ship-to & Billing
  addresses, **Local pickup** badge when there's no shipping address.
- Photos: batch capture (camera or library), preview & **rotate before upload** (baked
  in), category chips, full-screen lightbox with rotate, swipe-left to delete.
- Menu → Settings (change your name), Add to Home Screen, Sign out.

**Backend** (`backend/`)
- Multi-tenant Cloudflare Worker; per-shop data isolation.
- OAuth install (auto-triggered from `/admin` if not yet installed), order sync,
  webhooks (orders create/updated, app/uninstalled).
- Purchase-order PDF parsing (`unpdf`); Shopify product / inventory / location reads and
  additive stock writes (`inventoryAdjustQuantities`; expiry-date metafield write-back is
  built but disabled for now), remembered material-code → variant mappings, and per-import
  history in D1 + the PDF in R2.
- Signed **per-shop** join tokens (revocable), HMAC everything, per-IP rate limiting +
  edge caching on public photo URLs, daily cleanup cron.

## Repo structure

```
stockproof/
├── backend/      Cloudflare Worker (Hono): OAuth, order sync, webhooks, photo store,
│                 purchase-order import (parse → match → add stock), stock list, admin page
│                 → D1 (metadata) + R2 (photo & PDF bytes). See backend/README.md
├── pwa/          Mobile PWA (Vite + React): join, orders, capture/rotate/upload, settings
│                 → deploy to Cloudflare Pages. See pwa/README.md
├── shopify-app/  Shopify CLI app: the order-details block extension (deployed via CLI)
└── docs/         Design specs, implementation plans, runbooks (working notes, untracked)
```

The Shopify-embedded admin page (Photos / Stock / Import / History) is served by the backend
Worker at `/admin`. The local repo directory may still be named `shipora`; every other name —
Worker, D1 database, R2 bucket, Pages project, GitHub repo — is `stockproof*`.

## Quick start (local)

```bash
# Backend — http://localhost:8787
cd backend
npm install
cp .dev.vars.example .dev.vars     # fill in local secrets
npm test                           # 185 tests, no live Shopify needed
npm run dev                        # esbuild build → wrangler dev (see backend/build.mjs)

# PWA — http://localhost:5173  (VITE_API_BASE points at the backend)
cd ../pwa
npm install
npm test                           # 21 tests
npm run dev
```

## Deploy (self-host)

Anyone can run their own StockProof — you bring your **own** Shopify app + Cloudflare
account, so the code is public but each deployment is isolated with its own data and
credentials.

**Prerequisites:** Node 18+, a Cloudflare account, a Shopify Partner/Dev account.

```bash
# 1) Backend — Cloudflare Worker (created on first deploy, named per wrangler.jsonc)
cd backend && npm install
npx wrangler login
npx wrangler d1 create stockproof                       # copy database_id → wrangler.jsonc
npx wrangler r2 bucket create stockproof-photos
npx wrangler d1 migrations apply stockproof --remote
npx wrangler secret put APP_SECRET                   # + SHOPIFY_API_SECRET, SHOPIFY_API_KEY, ADMIN_KEY
npm run deploy                                        # esbuild build + wrangler deploy; prints your Worker URL

# 2) PWA — Cloudflare Pages
cd ../pwa && npm install
VITE_API_BASE=https://<worker-url> npm run build
npx wrangler pages deploy dist --project-name=stockproof-pwa
#   then set the backend var PWA_URL to the Pages URL and re-run `npm run deploy` in backend/

# 3) Order-page block (optional) — Shopify
cd ../shopify-app && npx @shopify/cli app deploy
```

Create the Shopify app first (App URL `<worker>/admin`, redirect `<worker>/auth/callback`,
scopes `read_orders,write_orders,read_products,write_products,read_inventory,write_inventory,read_locations`)
and set its Client ID/secret as the secrets above. Full step-by-step:
[`backend/README.md`](backend/README.md) · [`pwa/README.md`](pwa/README.md).

**Install on a store** — Custom distribution generates an install link; opening the app
auto-runs OAuth (`/admin` bounces to authorize if the shop isn't installed). You're live.

> **Why `npm run deploy` (not bare `wrangler deploy`):** the Worker is pre-bundled with a
> current esbuild at `target: esnext`, then deployed with `--no-bundle`. Wrangler's own
> (older) esbuild lowers PDF.js's `static {}` blocks and breaks `unpdf` at runtime in the
> Worker. See `backend/build.mjs`.

> **Upgrading an existing install:** the purchase-order import feature added Shopify scopes
> (`read_products,write_products,read_inventory,write_inventory,read_locations`). A shop that
> installed before this change must re-visit `/auth?shop=<domain>.myshopify.com` once to
> grant them — the callback updates the stored token in place, no data loss.

## Security & secrets

No real credentials live in this repo. Secrets are stored on Cloudflare (production) or
in `.dev.vars` (local, gitignored):

| Secret | What | Where |
|---|---|---|
| `APP_SECRET` | signs the PWA's join/session tokens | `wrangler secret put` |
| `SHOPIFY_API_SECRET` | Shopify app client secret | `wrangler secret put` |
| `SHOPIFY_API_KEY` | Shopify app client ID | `wrangler secret put` |
| `ADMIN_KEY` | guards the standalone `/qr` page | `wrangler secret put` |

Cloning this code does **not** grant access to any store — a deployer must supply their
own Shopify app and Cloudflare account. Highlights: strict multi-tenant scoping (every
query is `WHERE shop_id = ?`), timing-safe token/HMAC checks, per-shop revocable join
codes, image-only upload allowlist + `nosniff`, and per-IP rate limiting on public photo
URLs. See `.dev.vars.example` for the full list.

## Tech stack

Cloudflare Workers · Hono · D1 · R2 · Shopify Admin GraphQL API (`2025-10`) · Shopify
Admin UI Extensions · `unpdf` (PDF parsing) · esbuild (Worker bundle) · React · Vite ·
TypeScript · Vitest.

## Status

Functionally complete and running on a real store via Custom distribution: proof-of-shipment
photos plus purchase-order import (adds delivered quantities to Shopify stock, with import
history). Expiry-date write-back is built but disabled for now (dates are parsed and shown,
not written). Deferred until public App-Store submission: GDPR compliance webhooks, Shopify
Billing, and full Protected Customer Data approval (street/zip already work where the store
grants it). Purchase-order parsing currently targets the Fonterra delivery-docket layout;
other supplier formats are added as needed.
