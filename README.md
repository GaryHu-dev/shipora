# Shipora

A Shopify **shipping assistant** — warehouse staff photograph packed orders from their
phone as **proof of shipment**. English UI; works for any Shopify store; multi-tenant
(one deployment serves many shops, each isolated).

**The flow**

1. A merchant installs the app on their Shopify store (OAuth). Orders sync automatically
   and stay in sync via webhooks.
2. From the embedded admin page, the merchant shows a **join QR code**.
3. Warehouse staff scan it, enter their name, and get a mobile web app (PWA).
4. Staff open an order, take/pick one or more photos, review & rotate them, then upload.
5. Each upload:
   - adds the order **tag** `Shipping photos uploaded` → a marker in the order **Timeline**;
   - makes the photos viewable on the order page in the **Shipora block** and in the app.

> Shopify has no public API to write custom order-timeline content, so the timeline
> marker is an order **tag** (the reliable, supported approach); the **order-page block**
> is where the photos themselves are viewed.

## Features

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

**Shopify side** (served by the backend)
- Embedded admin page: join QR + **Reset code** (revoke leaked links per-shop), photo
  retention (configurable days) + one-click cleanup, **Recent photos** with order-number
  search.
- Order-details **block extension** (`shopify-app/`): lists an order's photos with
  category badges + View links.

**Backend** (`backend/`)
- Multi-tenant Cloudflare Worker; per-shop data isolation.
- OAuth install (auto-triggered from `/admin` if not yet installed), order sync,
  webhooks (orders create/updated, app/uninstalled).
- Signed **per-shop** join tokens (revocable), HMAC everything, per-IP rate limiting +
  edge caching on public photo URLs, daily cleanup cron.

## Repo structure

```
shipora/
├── backend/      Cloudflare Worker (Hono): OAuth, sync, webhooks, photo store, admin,
│                 order-photos API → D1 (metadata) + R2 (photo bytes). See backend/README.md
├── pwa/          Mobile PWA (Vite + React): join, orders, capture/rotate/upload, settings
│                 → deploy to Cloudflare Pages. See pwa/README.md
├── shopify-app/  Shopify CLI app: the order-details block extension (deployed via CLI)
└── docs/         Design specs & implementation plans (working notes, untracked)
```

The Shopify-embedded admin page (join QR + storage + recent photos) is served by the
backend Worker at `/admin`.

## Quick start (local)

```bash
# Backend — http://localhost:8787
cd backend
npm install
cp .dev.vars.example .dev.vars     # fill in local secrets
npm test                           # 77 tests, no live Shopify needed
npm run dev

# PWA — http://localhost:5173  (VITE_API_BASE points at the backend)
cd ../pwa
npm install
npm test                           # 21 tests
npm run dev
```

## Deploy (self-host)

Anyone can run their own Shipora — you bring your **own** Shopify app + Cloudflare
account, so the code is public but each deployment is isolated with its own data and
credentials.

**Prerequisites:** Node 18+, a Cloudflare account, a Shopify Partner/Dev account.

```bash
# 1) Backend — Cloudflare Worker (created by `wrangler deploy`, named per wrangler.jsonc)
cd backend && npm install
npx wrangler login
npx wrangler d1 create shipora                       # copy database_id → wrangler.jsonc
npx wrangler r2 bucket create shipora-photos
npx wrangler d1 migrations apply shipora --remote
npx wrangler secret put APP_SECRET                   # + SHOPIFY_API_SECRET, SHOPIFY_API_KEY, ADMIN_KEY
npx wrangler deploy                                  # prints your Worker URL

# 2) PWA — Cloudflare Pages
cd ../pwa && npm install
VITE_API_BASE=https://<worker-url> npm run build
npx wrangler pages deploy dist --project-name=shipora-pwa
#   then set the backend var PWA_URL to the Pages URL and re-run `wrangler deploy` in backend/

# 3) Order-page block (optional) — Shopify
cd ../shopify-app && npx @shopify/cli app deploy
```

Create the Shopify app first (App URL `<worker>/admin`, redirect `<worker>/auth/callback`,
scopes `read_orders,write_orders`) and set its Client ID/secret as the secrets above.
Full step-by-step: [`backend/README.md`](backend/README.md) · [`pwa/README.md`](pwa/README.md).

**Install on a store** — Custom distribution generates an install link; opening the app
auto-runs OAuth (`/admin` bounces to authorize if the shop isn't installed). You're live.

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
Admin UI Extensions · React · Vite · TypeScript · Vitest.

## Status

Functionally complete and running on a real store via Custom distribution. Deferred
until public App-Store submission: GDPR compliance webhooks, Shopify Billing, and full
Protected Customer Data approval (street/zip already work where the store grants it).
