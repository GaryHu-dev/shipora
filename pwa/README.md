# StockProof PWA

Mobile web app (installable PWA) for warehouse staff. Talks to the
[backend](../backend/README.md) over HTTPS with a Bearer session token in `localStorage`.

- **Join** by scanning the shop QR; name remembered, auto re-login on next open.
- **Orders** — paginated list (20 + infinite scroll / "Load more"), tabs
  (Unfulfilled / All / Fulfilled), search, pull-to-refresh; the tab + scroll position are
  cached so returning from an order is instant.
- **Order detail** — items to pack (image, qty, name, SKU), Ship-to + Billing addresses,
  a **Local pickup** badge when there's no shipping address.
- **Photos** — batch capture (camera / library), preview & **rotate before upload**,
  category chips, full-screen lightbox with rotate, swipe-left to delete.
- **Menu → Settings** (rename), Add to Home Screen, Sign out.

## Stack

Vite · React 18 · TypeScript · `react-router-dom` (HashRouter) · `vite-plugin-pwa` ·
Vitest + Testing Library.

## Develop & test

```bash
npm install
npm test          # component + client tests
npm run dev       # http://localhost:5173
npm run build     # production build → dist/
```

`VITE_API_BASE` (in `.env.development` for local) sets the backend origin. For
production, provide it at build time, e.g.:

```bash
VITE_API_BASE=https://<your-worker>.workers.dev npm run build
```

## Deploy (Cloudflare Pages)

1. `VITE_API_BASE=https://<your-worker>.workers.dev npm run build`
2. `npx wrangler pages deploy dist --project-name=stockproof-pwa`
   (creates the Pages project on first run; prints the URL).
3. Point the backend's `PWA_URL` var at the resulting Pages URL (then re-`wrangler deploy`
   the backend) so the admin page's join-QR links resolve.

## Notes

- Photos are compressed, rotated, and thumbnailed client-side (canvas) before upload —
  the chosen rotation is baked into the uploaded image.
- The raw-photo endpoint needs auth, so images are fetched with the Bearer token and
  shown via object URLs (an `<img src>` can't send an `Authorization` header).
- The service worker auto-updates (checks on an interval and on focus); a stale install
  refreshes itself within ~a minute.
- Session persists long-term; staff scan once, then open from the home-screen icon.
