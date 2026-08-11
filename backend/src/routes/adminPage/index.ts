// backend/src/routes/adminPage/index.ts
import { ADMIN_STYLES } from "./styles";
import { photosTabMarkup, photosTabScript } from "./photosTab";
import { importTabMarkup, importTabScript } from "./importTab";
import { historyTabMarkup, historyTabScript } from "./historyTab";
import { stockTabMarkup, stockTabScript } from "./stockTab";

import { Hono } from "hono";
import type { Env } from "../../types";
import { makeJoinToken } from "../join";
import { signToken, timingSafeEqualStr } from "../../auth/tokens";
import { buildAuthorizeUrl, isValidShopDomain } from "../../shopify/oauth";
import { qrDataUrl } from "../../shopify/qr";

export const adminPageRoutes = new Hono<{ Bindings: Env }>();

adminPageRoutes.get("/admin", async (c) => {
  // If Shopify opens the app for a shop we haven't installed yet, kick off OAuth.
  // Break out of the admin iframe first (the OAuth screen can't be framed).
  const shop = c.req.query("shop") ?? "";
  if (isValidShopDomain(shop)) {
    const existing = await c.env.DB
      .prepare("SELECT id FROM shops WHERE shop_domain = ? AND status = 'active'")
      .bind(shop).first<{ id: string }>();
    if (!existing) {
      const now = Math.floor(Date.now() / 1000);
      const state = await signToken({ kind: "oauth", shop }, c.env.APP_SECRET, 600, now);
      const authorizeUrl = buildAuthorizeUrl(c.env, shop, state);
      const js = JSON.stringify(authorizeUrl);
      return c.body(
        `<!doctype html><meta charset="utf-8"><script>var u=${js};(window.top===window.self?window:window.top).location.href=u;</script>` +
        `<p style="font:15px -apple-system,sans-serif;padding:24px">Redirecting to install… <a href=${js} target="_top">continue</a></p>`,
        200,
        { "content-type": "text/html; charset=utf-8" }
      );
    }
  }
  const html = renderAdminPage(c.env.SHOPIFY_API_KEY);
  return c.body(html, 200, {
    "content-type": "text/html; charset=utf-8",
    "content-security-policy": "frame-ancestors https://*.myshopify.com https://admin.shopify.com",
    "cache-control": "no-store",
  });
});

// Standalone, key-protected QR page. Open it in any browser to show the
// warehouse scan-to-join QR code — no Shopify embedding required.
adminPageRoutes.get("/qr", async (c) => {
  const key = c.req.query("key") ?? "";
  if (!c.env.ADMIN_KEY || !timingSafeEqualStr(key, c.env.ADMIN_KEY)) return c.text("Unauthorized", 401);

  const shopDomain = c.req.query("shop") ?? "";
  const shop = await c.env.DB
    .prepare("SELECT id, join_secret FROM shops WHERE shop_domain = ? AND status = 'active'")
    .bind(shopDomain)
    .first<{ id: string; join_secret: string }>();
  if (!shop) return c.text("Shop not found", 404);

  const now = Math.floor(Date.now() / 1000);
  const joinToken = await makeJoinToken(c.env.APP_SECRET, shop.join_secret, shop.id, now);
  const joinUrl = `${c.env.PWA_URL}/#/join?token=${joinToken}`;
  return c.body(renderQrPage(qrDataUrl(joinUrl), joinUrl), 200, {
    "content-type": "text/html; charset=utf-8",
  });
});

function renderQrPage(qr: string, joinUrl: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>StockProof — Warehouse Join QR</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; margin: 0; padding: 24px; background: #f4f5f7; color: #111827; text-align: center; }
  .card { max-width: 380px; margin: 24px auto; background: #fff; border-radius: 16px; padding: 28px 24px; box-shadow: 0 1px 3px rgba(16,24,40,.08); }
  h1 { font-size: 20px; margin: 0 0 6px; }
  p { color: #6b7280; margin: 0 0 20px; font-size: 14px; line-height: 1.5; }
  img { width: 260px; height: 260px; image-rendering: pixelated; }
  .link { word-break: break-all; font-size: 12px; color: #9aa1ac; margin-top: 18px; }
  .btn { display: inline-block; margin-top: 18px; padding: 12px 20px; background: #2563eb; color: #fff; border: none; border-radius: 10px; font-size: 15px; font-weight: 600; }
  @media print { .btn, .link { display: none; } body { background: #fff; } }
</style>
</head>
<body>
<div class="card">
  <h1>Scan to join</h1>
  <p>Warehouse staff: scan this with your phone camera to open StockProof and start uploading shipping photos.</p>
  <img src="${qr}" alt="Join QR code" />
  <br />
  <button class="btn" onclick="window.print()">Print</button>
  <div class="link">${joinUrl}</div>
</div>
</body>
</html>`;
}

function renderAdminPage(apiKey: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="shopify-api-key" content="${apiKey}" />
<script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
<title>StockProof — Shipping Photos</title>${ADMIN_STYLES}
</head>
<body>
<div class="wrap">
  <h1 class="page-h">StockProof</h1>
  <p class="page-sub">Import stock from supplier delivery notes, and collect proof-of-shipment photos from your warehouse staff.</p>

  <div class="tabs">
    <button class="tab-btn active" id="tab-photos-btn" data-tab="photos">Photos</button>
    <button class="tab-btn" id="tab-import-btn" data-tab="import">Import</button>
    <button class="tab-btn" id="tab-history-btn" data-tab="history">History</button>
    <button class="tab-btn" id="tab-stock-btn" data-tab="stock">Stock</button>
  </div>
${photosTabMarkup()}
${importTabMarkup()}
${historyTabMarkup()}
${stockTabMarkup()}
</div>

<script>
(async function () {
  async function token() { return await shopify.idToken(); }
  async function api(path, opts) {
    const t = await token();
    opts = opts || {};
    const headers = Object.assign({ Authorization: "Bearer " + t }, opts.headers || {});
    const res = await fetch(path, Object.assign({}, opts, { headers: headers }));
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res;
  }
${photosTabScript()}
${stockTabScript()}

  // Tabs
  document.querySelectorAll(".tab-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      document.querySelectorAll(".tab-btn").forEach(function (b) { b.classList.remove("active"); });
      document.querySelectorAll(".tab-pane").forEach(function (p) { p.classList.remove("active"); });
      btn.classList.add("active");
      document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
      // loadStock() sets window.__stockLoaded itself on success (see
      // stockTab.ts) — including when called from the in-row Retry link, not
      // just from here — so a failed first load is retried on the next open
      // instead of leaving the tab blank for the rest of the session.
      if (btn.dataset.tab === "stock" && !window.__stockLoaded) { loadStock(); }
    });
  });
${importTabScript()}
${historyTabScript()}
})();
</script>
</body>
</html>`;
}
