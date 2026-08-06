import { Hono } from "hono";
import type { Env } from "../types";
import { makeJoinToken } from "./join";
import { signToken, timingSafeEqualStr } from "../auth/tokens";
import { buildAuthorizeUrl, isValidShopDomain } from "../shopify/oauth";
import { qrDataUrl } from "../shopify/qr";

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
<title>StockProof — Shipping Photos</title>
<style>
  :root {
    --bg:#f1f2f4; --surface:#fff; --text:#202223; --subdued:#6d7175; --border:#e1e3e5;
    --accent:#2c6ecb; --accent-press:#1f5199;
    --amber-bg:#fff1d6; --amber-fg:#8a6116; --green-bg:#e3f1df; --green-fg:#0f5132;
    --radius:12px; --shadow:0 1px 2px rgba(0,0,0,.05), 0 0 1px rgba(0,0,0,.08);
  }
  * { box-sizing:border-box; }
  body { font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    margin:0; padding:20px 16px 40px; color:var(--text); background:var(--bg); -webkit-font-smoothing:antialiased; }
  .wrap { max-width:720px; margin:0 auto; }
  .page-h { font-size:20px; font-weight:650; margin:0 0 4px; }
  .page-sub { color:var(--subdued); font-size:14px; margin:0 0 20px; }
  .card { background:var(--surface); border:1px solid var(--border); border-radius:var(--radius); box-shadow:var(--shadow); padding:20px; margin-bottom:16px; }
  .card h2 { font-size:15px; font-weight:650; margin:0 0 4px; }
  .card .desc { color:var(--subdued); font-size:13.5px; margin:0 0 16px; line-height:1.45; }

  .qr-wrap { display:flex; gap:20px; align-items:flex-start; flex-wrap:wrap; }
  .qr-box { border:1px solid var(--border); border-radius:12px; padding:12px; background:#fff; flex:none; }
  .qr-box img { display:block; width:180px; height:180px; image-rendering:pixelated; }
  .qr-side { flex:1; min-width:200px; }
  .join-url { word-break:break-all; font-size:12px; color:var(--subdued); background:#f6f6f7; border:1px solid var(--border); border-radius:8px; padding:8px 10px; margin:0 0 10px; }
  .row-btns { display:flex; gap:8px; flex-wrap:wrap; }
  .reset-note { color:var(--subdued); font-size:12px; margin-top:8px; }
  .btn { padding:9px 14px; font-size:13.5px; font-weight:600; border-radius:8px; border:1px solid var(--border); background:#fff; color:var(--text); cursor:pointer; }
  .btn.primary { background:var(--accent); color:#fff; border-color:var(--accent); }
  .btn.primary:active { background:var(--accent-press); }

  .layout { display:grid; grid-template-columns:1fr 300px; gap:16px; align-items:start; }
  @media (max-width:820px){ .layout { grid-template-columns:1fr; } }
  .side .card { position:sticky; top:16px; }
  .settings-row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:12px; }
  .settings-row .num { width:70px; padding:8px 10px; border:1px solid var(--border); border-radius:8px; font-size:14px; }
  .settings-row2 { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  .msg { color:var(--subdued); font-size:13px; }
  .recent-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(72px,1fr)); gap:8px; }
  .recent-item { position:relative; }
  .recent-item img { width:100%; aspect-ratio:1; object-fit:cover; border-radius:8px; background:#eee; cursor:pointer; display:block; }
  .recent-item .tag { position:absolute; left:4px; bottom:4px; background:rgba(0,0,0,.6); color:#fff; font-size:10px; padding:1px 5px; border-radius:5px; }
  .recent-search { width:100%; box-sizing:border-box; padding:8px 11px; border:1px solid var(--border); border-radius:8px; font-size:14px; margin-bottom:10px; }
  .rl { list-style:none; margin:0; padding:0; }
  .rl-item { display:flex; align-items:center; gap:8px; padding:9px 0; border-top:1px solid #f1f2f4; }
  .rl-item:first-child { border-top:none; }
  .sk { position:relative; overflow:hidden; background:#e6e8ec; border-radius:6px; }
  .sk::after { content:""; position:absolute; inset:0; transform:translateX(-100%); background:linear-gradient(90deg,transparent,rgba(255,255,255,.55),transparent); animation:shimmer 1.3s infinite; }
  @keyframes shimmer { 100% { transform:translateX(100%); } }
  .sk-row { display:flex; align-items:center; justify-content:space-between; padding:12px 0; border-top:1px solid #f1f2f4; }
  .sk-row:first-child { border-top:none; }
  .rl-main { flex:1; min-width:0; }
  .rl-ord { font-weight:650; font-size:13.5px; }
  .rl-cat { display:block; color:var(--subdued); font-size:12px; margin-top:1px; }
  .rl-view { color:var(--accent); font-size:12.5px; font-weight:600; text-decoration:none; flex:none; }

  .order { border:1px solid var(--border); border-radius:10px; margin-bottom:8px; overflow:hidden; }
  .order-head { display:flex; align-items:center; gap:10px; padding:13px 14px; cursor:pointer; background:#fff; }
  .order-head:hover { background:#fafbfb; }
  .order-head .num { font-weight:650; font-size:14.5px; flex:1; }
  .order-head .chev { color:#b5bcc4; transition:transform .15s ease; }
  .order.open .order-head .chev { transform:rotate(90deg); }
  .badge { display:inline-block; padding:2px 9px; font-size:11.5px; font-weight:600; border-radius:999px; }
  .badge.unf { background:var(--amber-bg); color:var(--amber-fg); }
  .badge.ful { background:var(--green-bg); color:var(--green-fg); }
  .order-body { display:none; padding:0 14px 14px; }
  .order.open .order-body { display:block; }
  .thumbs { display:grid; grid-template-columns:repeat(auto-fill,minmax(84px,1fr)); gap:8px; }
  .thumbs img { width:100%; aspect-ratio:1; object-fit:cover; border-radius:8px; background:#eee; cursor:pointer; }
  .tl { list-style:none; margin:0; padding:0; }
  .tl-item { display:flex; gap:11px; align-items:center; padding:10px 0; border-top:1px solid #f1f2f4; }
  .tl-item:first-child { border-top:none; }
  .tl-thumb { width:46px; height:46px; border-radius:8px; object-fit:cover; background:#eee; flex:none; cursor:pointer; }
  .tl-meta { flex:1; min-width:0; }
  .tl-cat { font-weight:600; font-size:13.5px; }
  .tl-sub { color:var(--subdued); font-size:12px; margin-top:1px; }
  .tl-view { color:var(--accent); font-size:12.5px; font-weight:600; text-decoration:none; flex:none; }
  .muted { color:var(--subdued); font-size:13px; padding:8px 0; }

  .state { color:var(--subdued); font-size:14px; padding:8px 0; }

  .tabs { display:flex; gap:4px; margin-bottom:16px; border-bottom:1px solid var(--border); }
  .tab-btn { padding:9px 14px; font-size:14px; font-weight:600; border:none; background:none; color:var(--subdued); cursor:pointer; border-bottom:2px solid transparent; }
  .tab-btn.active { color:var(--text); border-bottom-color:var(--accent); }
  .tab-pane { display:none; }
  .tab-pane.active { display:block; }
  /* ---- Purchase-order import ---- */
  .po-drop { position:relative; display:block; border:1.5px dashed var(--border); border-radius:12px;
    background:#fbfcfd; padding:26px 20px; text-align:center; cursor:pointer; transition:border-color .15s, background .15s; }
  .po-drop:hover, .po-drop.drag { border-color:var(--accent); background:#f5f9ff; }
  .po-drop input[type=file] { position:absolute; inset:0; width:100%; height:100%; opacity:0; cursor:pointer; }
  .po-drop .ic { width:34px; height:34px; margin:0 auto 8px; color:var(--accent); display:block; }
  .po-drop .big { font-size:14px; font-weight:600; color:var(--text); }
  .po-drop .small { font-size:12.5px; color:var(--subdued); margin-top:3px; }
  .po-file { display:flex; align-items:center; gap:10px; justify-content:center; }
  .po-file .doc { font-size:22px; line-height:1; }
  .po-file .nm { font-weight:600; font-size:13.5px; }
  .po-file .sz { color:var(--subdued); font-size:12px; }
  .po-actions, .po-confirm-row { display:flex; align-items:center; gap:12px; margin-top:14px; }

  .spin { width:15px; height:15px; border:2px solid rgba(44,110,203,.25); border-top-color:var(--accent);
    border-radius:50%; animation:spin .7s linear infinite; display:inline-block; vertical-align:-2px; }
  @keyframes spin { to { transform:rotate(360deg); } }
  .po-loading { display:flex; align-items:center; gap:11px; padding:20px 2px; color:var(--subdued); font-size:14px; }
  .po-loading .spin { width:20px; height:20px; border-width:3px; }

  .po-table { width:100%; border-collapse:separate; border-spacing:0; font-size:13.5px; margin:2px 0 4px; }
  .po-table thead th { text-align:left; padding:6px 10px; font-size:11px; font-weight:600; text-transform:uppercase;
    letter-spacing:.04em; color:var(--subdued); border-bottom:1px solid var(--border); white-space:nowrap; }
  .po-table td { padding:11px 10px; border-bottom:1px solid #f1f2f4; vertical-align:top; }
  .po-table tbody tr:hover { background:#fafbfc; }
  .po-table tbody tr.skip td > *:not(.po-skip) { opacity:.4; }
  .po-table input[type=number], .po-table input[type=date], .po-table input[type=text], .po-table select {
    width:100%; box-sizing:border-box; padding:6px 8px; border:1px solid var(--border); border-radius:7px; font-size:13px; background:#fff; }
  .po-table input:focus, .po-table select:focus { outline:none; border-color:var(--accent); box-shadow:0 0 0 2px rgba(44,110,203,.15); }
  .po-table td:nth-child(3){ width:74px; } .po-table td:nth-child(4){ width:130px; } .po-table td:nth-child(6){ width:44px; }
  .po-idx { color:var(--subdued); font-size:12px; font-variant-numeric:tabular-nums; }
  .po-prod { display:flex; gap:10px; align-items:flex-start; }
  .po-prod .txt { flex:1; min-width:0; }
  .po-thumb { width:42px; height:42px; border-radius:7px; object-fit:cover; background:#eef0f2; flex:none; border:1px solid var(--border); display:block; }
  .po-thumb.ph { display:flex; align-items:center; justify-content:center; color:#b5bcc4; font-size:15px; }
  a.po-thumb-link { flex:none; display:block; }
  a.po-thumb-link:hover .po-thumb { border-color:var(--accent); }
  .po-prod-title { font-weight:600; }
  .po-prod-title a { color:var(--text); text-decoration:none; }
  .po-prod-title a:hover { color:var(--accent); text-decoration:underline; }
  .po-change { color:var(--accent); font-size:12px; font-weight:600; cursor:pointer; margin-top:6px; display:inline-block; }
  .po-change:hover { text-decoration:underline; }
  .po-code { color:var(--subdued); font-size:12px; margin-top:1px; }
  .pill { display:inline-block; padding:1px 8px; border-radius:999px; font-size:11px; font-weight:600; margin-top:6px; }
  .pill.sku { background:var(--green-bg); color:var(--green-fg); }
  .pill.map, .pill.manual { background:#e8f0fb; color:#1f5199; }
  .pill.fuzzy { background:var(--amber-bg); color:var(--amber-fg); }
  .pill.none { background:#fdeceb; color:#b42318; }
  .po-stock { font-variant-numeric:tabular-nums; white-space:nowrap; }
  .po-stock .to { color:var(--subdued); margin:0 5px; }
  .po-stock .aft { font-weight:700; }
  .po-stock .delta { color:var(--green-fg); font-weight:600; font-size:12px; margin-left:7px; }
  .po-note { font-size:11px; margin-top:5px; }
  .po-note.up { color:var(--green-fg); } .po-note.keep { color:var(--subdued); }
  .po-search { position:relative; margin-top:6px; }
  .po-pick { position:absolute; top:calc(100% + 4px); left:0; right:0; z-index:30; background:#fff;
    border:1px solid var(--border); border-radius:8px; box-shadow:0 8px 22px rgba(16,24,40,.14);
    overflow:auto; max-height:230px; display:none; }
  .po-pick.open { display:block; }
  .po-pick a { display:flex; gap:9px; align-items:center; padding:7px 10px; text-decoration:none; border-top:1px solid #f1f2f4; }
  .po-pick a:first-child { border-top:none; }
  .po-pick a:hover { background:#f5f9ff; }
  .po-pick .pk-thumb { width:30px; height:30px; border-radius:5px; object-fit:cover; background:#eef0f2; flex:none;
    border:1px solid var(--border); display:flex; align-items:center; justify-content:center; color:#b5bcc4; font-size:12px; }
  .po-pick .pk-title { font-size:12.5px; font-weight:500; color:var(--text); line-height:1.25; }
  .po-pick .pk-sku { font-size:11px; color:var(--subdued); }
  .po-skip { text-align:center; }

  .po-res { list-style:none; margin:0; padding:0; }
  .po-res li { display:flex; align-items:center; gap:9px; padding:9px 2px; border-top:1px solid #f1f2f4; font-size:13.5px; }
  .po-res li:first-child { border-top:none; }
  .po-res .dot { width:8px; height:8px; border-radius:50%; flex:none; }
  .po-res .ok .dot { background:#12805c; } .po-res .err .dot { background:#b42318; } .po-res .skip .dot { background:#b5bcc4; }
  .po-res .er { color:#b42318; font-size:12px; }
  .po-res .st { margin-left:auto; font-size:12px; font-weight:600; text-transform:capitalize; }
  .po-res .ok .st { color:#12805c; } .po-res .err .st { color:#b42318; } .po-res .skip .st { color:var(--subdued); }
</style>
</head>
<body>
<div class="wrap">
  <h1 class="page-h">StockProof</h1>
  <p class="page-sub">Import stock from supplier delivery notes, and collect proof-of-shipment photos from your warehouse staff.</p>

  <div class="tabs">
    <button class="tab-btn active" id="tab-photos-btn" data-tab="photos">Photos</button>
    <button class="tab-btn" id="tab-import-btn" data-tab="import">Import</button>
    <button class="tab-btn" id="tab-history-btn" data-tab="history">History</button>
  </div>

  <div id="tab-photos" class="tab-pane active">
  <div class="layout">
  <div class="main">
  <div class="card">
    <h2>Warehouse join QR code</h2>
    <p class="desc">Staff scan this with their phone to open StockProof and start uploading shipping photos. Print it or show it on screen.</p>
    <div class="qr-wrap">
      <div class="qr-box"><div id="qr"><div class="sk" style="width:160px;height:160px;border-radius:10px"></div></div></div>
      <div class="qr-side">
        <div class="join-url" id="joinUrl"></div>
        <div class="row-btns">
          <button class="btn primary" id="copyBtn">Copy link</button>
          <button class="btn" onclick="window.open(document.getElementById('joinUrl').textContent,'_blank')">Open</button>
          <button class="btn" id="resetBtn">Reset code</button>
        </div>
        <div class="reset-note">Reset if a QR/link leaks — the old code stops working and a new one is generated (reprint it for staff).</div>
      </div>
    </div>
  </div>
  <div class="card">
    <h2>Photo storage</h2>
    <p class="desc">Shipping photos are kept for the retention period, then deleted automatically.</p>
    <div class="settings-row">
      <label>Keep photos for</label>
      <input id="retention" class="num" type="number" min="1" max="365" />
      <span>days</span>
      <button class="btn primary" id="saveSettings">Save</button>
    </div>
    <div class="settings-row2">
      <button class="btn" id="cleanupBtn">Clean up expired now</button>
      <span class="msg" id="settingsMsg"></span>
    </div>
  </div>
  </div>
  <aside class="side">
  <div class="card">
    <h2>Recent photos</h2>
    <p class="desc">The latest shipping photos uploaded by your staff.</p>
    <input id="recentSearch" class="recent-search" type="search" placeholder="Search by order number…" />
    <div id="recent">
      <div class="sk-row"><div class="sk" style="width:60%;height:13px"></div></div>
      <div class="sk-row"><div class="sk" style="width:52%;height:13px"></div></div>
      <div class="sk-row"><div class="sk" style="width:66%;height:13px"></div></div>
    </div>
  </div>
  </aside>
  </div>
  </div>

  <div id="tab-import" class="tab-pane">
  <div class="card">
    <h2>Import a purchase order</h2>
    <p class="desc">Upload a Fonterra delivery-docket PDF. Review the recognised lines, then confirm to add the delivered quantities to Shopify stock. (Expiry dates are shown from the delivery note but not written back for now.)</p>
    <label class="po-drop" id="poDrop">
      <input type="file" id="poFile" accept="application/pdf" />
      <div id="poDropIdle">
        <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V4"/><path d="M8 8l4-4 4 4"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg>
        <div class="big">Drop your delivery-note PDF here, or click to browse</div>
        <div class="small">Fonterra delivery docket · PDF up to 10 MB</div>
      </div>
      <div class="po-file" id="poDropChosen" style="display:none">
        <span class="doc">📄</span>
        <span><span class="nm" id="poFileName"></span> <span class="sz" id="poFileSize"></span></span>
      </div>
    </label>
    <div class="po-actions">
      <button class="btn primary" id="poParseBtn">Parse PDF</button>
      <span class="msg" id="poParseMsg"></span>
    </div>
  </div>
  <div class="card" id="poReviewCard" style="display:none">
    <h2>Review before confirming</h2>
    <div class="po-loading" id="poLoading"><span class="spin"></span> Reading the PDF and matching products…</div>
    <div id="poReviewBody" style="display:none">
      <div class="settings-row">
        <label>Location</label>
        <select id="poLocation"></select>
      </div>
      <table class="po-table" id="poTable">
        <thead>
          <tr><th>#</th><th>Product</th><th>Received</th><th>Expiry (BBD)</th><th>Stock</th><th>Skip</th></tr>
        </thead>
        <tbody id="poTableBody"></tbody>
      </table>
      <div class="po-confirm-row">
        <button class="btn primary" id="poConfirmBtn">Confirm sync</button>
        <span class="msg" id="poConfirmMsg"></span>
      </div>
    </div>
  </div>
  <div class="card" id="poResultCard" style="display:none">
    <h2>Result</h2>
    <ul class="po-res" id="poResultList"></ul>
  </div>
  </div>

  <div id="tab-history" class="tab-pane">
  <div class="card">
    <h2>Import history</h2>
    <p class="desc">Every purchase-order PDF you've imported, with the line-level result.</p>
    <ul class="rl" id="poHistoryList"></ul>
  </div>
  <div class="card" id="poHistoryDetailCard" style="display:none">
    <h2>Import detail</h2>
    <a href="#" id="poHistoryPdfLink">Download original PDF</a>
    <table class="po-table" id="poHistoryDetailTable">
      <thead><tr><th>Product</th><th>Qty delivered</th><th>Stock before → after</th><th>Expiry</th><th>Status</th></tr></thead>
      <tbody id="poHistoryDetailBody"></tbody>
    </table>
  </div>
  </div>
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
  const CAT = { shipping_photo:"Shipping photo", packing_slip:"Packing slip", shipping_label:"Shipping label", damage:"Damage / issue", document:"Document", other:"Other" };
  function ago(ts) {
    return new Date(ts * 1000).toLocaleString([], { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  // QR
  async function loadQr() {
    try {
      const { joinUrl, qrDataUrl } = await (await api("/admin/api/join-qr", { method: "POST" })).json();
      document.getElementById("qr").innerHTML = '<img alt="join qr" src="' + qrDataUrl + '">';
      document.getElementById("joinUrl").textContent = joinUrl;
    } catch (e) { document.getElementById("qr").innerHTML = '<div class="state">Failed to generate QR</div>'; }
  }
  await loadQr();
  document.getElementById("copyBtn").addEventListener("click", async function () {
    try { await navigator.clipboard.writeText(document.getElementById("joinUrl").textContent); this.textContent = "Copied ✓"; setTimeout(() => this.textContent = "Copy link", 1500); } catch (e) {}
  });
  document.getElementById("resetBtn").addEventListener("click", async function () {
    if (!confirm("Reset the join code? The current QR and link will stop working — you'll need to reprint the new one for staff.")) return;
    this.disabled = true; this.textContent = "Resetting…";
    try {
      await api("/admin/api/reset-join-code", { method: "POST" });
      await loadQr();
      this.textContent = "Reset ✓"; setTimeout(() => { this.textContent = "Reset code"; this.disabled = false; }, 1500);
    } catch (e) { this.textContent = "Reset code"; this.disabled = false; }
  });

  // Photo storage settings
  try {
    const s = await (await api("/admin/api/settings")).json();
    document.getElementById("retention").value = s.retentionDays;
  } catch (e) {}
  document.getElementById("saveSettings").addEventListener("click", async function () {
    const v = parseInt(document.getElementById("retention").value, 10);
    const msg = document.getElementById("settingsMsg");
    try {
      await api("/admin/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ retentionDays: v }) });
      msg.textContent = "Saved ✓"; setTimeout(() => { msg.textContent = ""; }, 2000);
    } catch (e) { msg.textContent = "Enter a number from 1 to 365"; }
  });
  document.getElementById("cleanupBtn").addEventListener("click", async function () {
    const msg = document.getElementById("settingsMsg");
    this.disabled = true; msg.textContent = "Cleaning up…";
    try {
      const { deleted } = await (await api("/admin/api/cleanup", { method: "POST" })).json();
      msg.textContent = "Deleted " + deleted + " expired photo" + (deleted === 1 ? "" : "s");
    } catch (e) { msg.textContent = "Cleanup failed"; }
    this.disabled = false;
  });

  // Recent photos
  const recentBox = document.getElementById("recent");
  async function loadRecent(q) {
    try {
      const url = "/admin/api/recent-photos" + (q ? "?q=" + encodeURIComponent(q) : "");
      const { photos } = await (await api(url)).json();
      if (!photos.length) {
        recentBox.innerHTML = '<div class="state">' + (q ? "No photos for that order" : "No photos yet") + '</div>';
        return;
      }
      const ul = document.createElement("ul"); ul.className = "rl";
      recentBox.innerHTML = ""; recentBox.appendChild(ul);
      photos.forEach(function (p, i) {
        const li = document.createElement("li"); li.className = "rl-item";
        const main = document.createElement("div"); main.className = "rl-main";
        const ordEl = document.createElement("span"); ordEl.className = "rl-ord"; ordEl.textContent = p.order_number;
        const catEl = document.createElement("span"); catEl.className = "rl-cat"; catEl.textContent = (CAT[p.category] || p.category) + " #" + (i + 1);
        main.appendChild(ordEl); main.appendChild(catEl);
        const view = document.createElement("a"); view.className = "rl-view"; view.href = "#"; view.textContent = "View";
        view.addEventListener("click", async function (e) {
          e.preventDefault();
          const old = view.textContent; view.textContent = "…";
          try { const blob = await (await api("/admin/api/photos/" + p.id + "/raw")).blob(); window.open(URL.createObjectURL(blob), "_blank"); } catch (err) {}
          view.textContent = old;
        });
        li.appendChild(main); li.appendChild(view);
        ul.appendChild(li);
      });
    } catch (e) { recentBox.innerHTML = '<div class="state">Failed to load photos</div>'; }
  }
  await loadRecent("");
  var recentT;
  document.getElementById("recentSearch").addEventListener("input", function () {
    clearTimeout(recentT);
    var q = this.value.trim();
    recentT = setTimeout(function () { loadRecent(q); }, 250);
  });

  // Tabs
  document.querySelectorAll(".tab-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      document.querySelectorAll(".tab-btn").forEach(function (b) { b.classList.remove("active"); });
      document.querySelectorAll(".tab-pane").forEach(function (p) { p.classList.remove("active"); });
      btn.classList.add("active");
      document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
    });
  });

  // Purchase-order import
  var poParsed = null; // last /parse response

  // Dropzone: show the chosen filename and give drag feedback.
  var poDrop = document.getElementById("poDrop");
  document.getElementById("poFile").addEventListener("change", function () {
    var f = this.files[0];
    var idle = document.getElementById("poDropIdle"), chosen = document.getElementById("poDropChosen");
    if (f) {
      document.getElementById("poFileName").textContent = f.name;
      document.getElementById("poFileSize").textContent = "· " + (f.size / 1048576).toFixed(1) + " MB";
      idle.style.display = "none"; chosen.style.display = "";
    } else { idle.style.display = ""; chosen.style.display = "none"; }
    document.getElementById("poParseMsg").textContent = "";
  });
  ["dragenter", "dragover"].forEach(function (ev) { poDrop.addEventListener(ev, function (e) { e.preventDefault(); poDrop.classList.add("drag"); }); });
  ["dragleave", "drop"].forEach(function (ev) { poDrop.addEventListener(ev, function () { poDrop.classList.remove("drag"); }); });

  document.getElementById("poParseBtn").addEventListener("click", async function () {
    var fileInput = document.getElementById("poFile");
    var msg = document.getElementById("poParseMsg");
    var btn = this;
    if (!fileInput.files.length) { msg.textContent = "Choose a PDF first"; return; }
    msg.textContent = "";
    btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Parsing…';
    document.getElementById("poResultCard").style.display = "none";
    document.getElementById("poReviewCard").style.display = "";
    document.getElementById("poLoading").style.display = "";
    document.getElementById("poReviewBody").style.display = "none";
    var fd = new FormData();
    fd.append("pdf", fileInput.files[0]);
    try {
      var res = await api("/admin/api/purchase-orders/parse", { method: "POST", body: fd });
      poParsed = await res.json();
      renderPoReview();
    } catch (e) {
      document.getElementById("poReviewCard").style.display = "none";
      msg.textContent = "Couldn't read that PDF — check it's a Fonterra delivery docket.";
    }
    btn.disabled = false; btn.textContent = "Parse PDF";
  });

  function renderPoReview() {
    document.getElementById("poLoading").style.display = "none";
    document.getElementById("poReviewBody").style.display = "";
    var locSel = document.getElementById("poLocation");
    locSel.innerHTML = "";
    poParsed.locations.forEach(function (loc) {
      var opt = document.createElement("option"); opt.value = loc.id; opt.textContent = loc.name;
      locSel.appendChild(opt);
    });
    locSel.onchange = renderPoRows;
    renderPoRows();
  }

  function currentStock(match) {
    var locId = document.getElementById("poLocation").value;
    var entry = (match && match.stockByLocation || []).find(function (s) { return s.locationId === locId; });
    return entry ? entry.available : 0;
  }

  var PILL = {
    sku: ["sku", "Matched by SKU"], mapping: ["map", "Matched (saved)"],
    manual: ["manual", "Selected"], fuzzy: ["fuzzy", "Best guess — check"],
  };

  function adminProductUrl(productId) {
    var num = String(productId || "").split("/").pop();
    return "https://" + poParsed.shopDomain + "/admin/products/" + num;
  }
  function makeThumb(url) {
    if (url) { var img = document.createElement("img"); img.className = "po-thumb"; img.src = url; img.alt = ""; return img; }
    var ph = document.createElement("div"); ph.className = "po-thumb ph"; ph.textContent = "▦"; return ph;
  }

  function renderPoRows() {
    var body = document.getElementById("poTableBody");
    body.innerHTML = "";
    poParsed.lines.forEach(function (line, i) {
      var tr = document.createElement("tr");
      tr.classList.toggle("skip", !!line._skip);

      // # index
      var idxCell = document.createElement("td"); idxCell.className = "po-idx"; idxCell.textContent = String(i + 1);

      // Product cell: thumbnail + matched product (clickable) or product picker.
      var productCell = document.createElement("td");
      var prod = document.createElement("div"); prod.className = "po-prod";
      var thumb = makeThumb(line.match && line.match.imageUrl);
      // Clickable thumbnail → the product's Shopify admin page (matched rows only).
      var thumbNode = thumb;
      if (line.match) {
        var ta = document.createElement("a"); ta.className = "po-thumb-link";
        ta.href = adminProductUrl(line.match.productId); ta.target = "_blank"; ta.rel = "noopener";
        ta.appendChild(thumb); thumbNode = ta;
      }
      var txt = document.createElement("div"); txt.className = "txt";
      // Search box + floating results, wrapped so the dropdown overlays (doesn't
      // push the row). Revealed for matched rows via "Change"; shown when unmatched.
      var search = document.createElement("div"); search.className = "po-search";
      var picker = document.createElement("input");
      picker.type = "text"; picker.placeholder = "Search products…"; picker.dataset.idx = String(i);
      picker.addEventListener("input", onProductSearch);
      var results = document.createElement("div"); results.className = "po-pick"; results.id = "poPick" + i;
      search.appendChild(picker); search.appendChild(results);

      if (line.match) {
        var title = document.createElement("div"); title.className = "po-prod-title";
        var a = document.createElement("a"); a.textContent = line.match.productTitle;
        a.href = adminProductUrl(line.match.productId); a.target = "_blank"; a.rel = "noopener";
        title.appendChild(a);
        var code = document.createElement("div"); code.className = "po-code";
        code.textContent = (line.match.sku ? "SKU " + line.match.sku + " · " : "") + "code " + line.materialCode;
        var p = PILL[line.match.matchSource] || PILL.fuzzy;
        var pill = document.createElement("span"); pill.className = "pill " + p[0]; pill.textContent = p[1];
        var change = document.createElement("span"); change.className = "po-change"; change.textContent = "Change product";
        change.addEventListener("click", function () {
          var show = search.style.display === "none";
          search.style.display = show ? "" : "none";
          change.textContent = show ? "Cancel" : "Change product";
          if (show) picker.focus();
        });
        search.style.display = "none";
        txt.appendChild(title); txt.appendChild(code); txt.appendChild(pill);
        txt.appendChild(document.createElement("br")); txt.appendChild(change);
        txt.appendChild(search);
      } else {
        var code2 = document.createElement("div"); code2.className = "po-code";
        code2.textContent = line.description + " · code " + line.materialCode;
        var pillN = document.createElement("span"); pillN.className = "pill none"; pillN.textContent = "Choose a product";
        txt.appendChild(code2); txt.appendChild(pillN); txt.appendChild(search);
      }
      prod.appendChild(thumbNode); prod.appendChild(txt); productCell.appendChild(prod);

      // Stock before → after (recomputed live as qty changes)
      var stockCell = document.createElement("td"); stockCell.className = "po-stock";
      var expiryNote = document.createElement("div");
      function paint() {
        var b = currentStock(line.match), a = b + line.deliveredQty;
        stockCell.innerHTML = "";
        var bs = document.createElement("span"); bs.textContent = String(b);
        var to = document.createElement("span"); to.className = "to"; to.textContent = "→";
        var as = document.createElement("span"); as.className = "aft"; as.textContent = String(a);
        stockCell.appendChild(bs); stockCell.appendChild(to); stockCell.appendChild(as);
        if (line.deliveredQty > 0) { var d = document.createElement("span"); d.className = "delta"; d.textContent = "+" + line.deliveredQty; stockCell.appendChild(d); }
      }

      // Received qty
      var qtyCell = document.createElement("td");
      var qtyInput = document.createElement("input"); qtyInput.type = "number"; qtyInput.min = "0"; qtyInput.value = String(line.deliveredQty);
      qtyInput.addEventListener("input", function () { line.deliveredQty = parseInt(qtyInput.value, 10) || 0; paint(); });
      qtyCell.appendChild(qtyInput);

      // Expiry (BBD)
      var expiryCell = document.createElement("td");
      var expiryInput = document.createElement("input"); expiryInput.type = "text"; expiryInput.value = line.sled;
      expiryInput.addEventListener("input", function () { line.sled = expiryInput.value; });
      expiryCell.appendChild(expiryInput); expiryCell.appendChild(expiryNote);

      // Skip
      var skipCell = document.createElement("td"); skipCell.className = "po-skip";
      var skipBox = document.createElement("input"); skipBox.type = "checkbox"; skipBox.checked = !!line._skip;
      skipBox.addEventListener("change", function () { line._skip = skipBox.checked; tr.classList.toggle("skip", skipBox.checked); });
      skipCell.appendChild(skipBox);

      paint();
      tr.appendChild(idxCell); tr.appendChild(productCell); tr.appendChild(qtyCell); tr.appendChild(expiryCell); tr.appendChild(stockCell); tr.appendChild(skipCell);
      body.appendChild(tr);
    });
  }

  var poSearchT;
  async function onProductSearch(e) {
    var idx = Number(e.target.dataset.idx);
    var q = e.target.value.trim();
    var box = document.getElementById("poPick" + idx);
    clearTimeout(poSearchT);
    if (q.length < 2) { box.classList.remove("open"); box.innerHTML = ""; return; }
    poSearchT = setTimeout(async function () {
      try {
        var res = await api("/admin/api/products/search?q=" + encodeURIComponent(q));
        var data = await res.json();
        box.innerHTML = "";
        if (!data.variants.length) { box.classList.remove("open"); return; }
        data.variants.slice(0, 8).forEach(function (v) {
          var a = document.createElement("a"); a.href = "#";
          var th;
          if (v.imageUrl) { th = document.createElement("img"); th.className = "pk-thumb"; th.src = v.imageUrl; th.alt = ""; }
          else { th = document.createElement("div"); th.className = "pk-thumb"; th.textContent = "▦"; }
          var meta = document.createElement("div");
          var t = document.createElement("div"); t.className = "pk-title"; t.textContent = v.title;
          var s = document.createElement("div"); s.className = "pk-sku"; s.textContent = v.sku ? "SKU " + v.sku : "No SKU";
          meta.appendChild(t); meta.appendChild(s);
          a.appendChild(th); a.appendChild(meta);
          a.addEventListener("click", function (ev) {
            ev.preventDefault();
            poParsed.lines[idx].match = { variantId: v.id, inventoryItemId: null, productTitle: v.title, productId: v.productId, imageUrl: v.imageUrl, sku: v.sku, matchSource: "manual", currentExpiryDate: null, stockByLocation: [] };
            renderPoRows();
          });
          box.appendChild(a);
        });
        box.classList.add("open");
      } catch (err) {}
    }, 250);
  }

  document.getElementById("poConfirmBtn").addEventListener("click", async function () {
    var msg = document.getElementById("poConfirmMsg");
    var btn = this;
    btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Syncing…'; msg.textContent = "";
    var fd = new FormData();
    fd.append("pdf", document.getElementById("poFile").files[0]);
    fd.append("locationId", document.getElementById("poLocation").value);
    var payload = poParsed.lines.map(function (l) {
      return {
        materialCode: l.materialCode, description: l.description, deliveredQty: l.deliveredQty, sled: l.sled,
        variantId: l.match ? l.match.variantId : null,
        matchSource: l.match ? l.match.matchSource : null,
        skip: !!l._skip || !l.match,
      };
    });
    fd.append("lines", JSON.stringify(payload));
    try {
      var res = await api("/admin/api/purchase-orders/confirm", { method: "POST", body: fd });
      var result = await res.json();
      var list = document.getElementById("poResultList"); list.innerHTML = "";
      result.lines.forEach(function (l) {
        var cls = l.status === "ok" ? "ok" : l.status === "skipped" ? "skip" : "err";
        var li = document.createElement("li"); li.className = cls;
        var dot = document.createElement("span"); dot.className = "dot";
        var name = document.createElement("span"); name.textContent = "Code " + l.materialCode;
        li.appendChild(dot); li.appendChild(name);
        if (l.error) { var er = document.createElement("span"); er.className = "er"; er.textContent = l.error; li.appendChild(er); }
        var st = document.createElement("span"); st.className = "st"; st.textContent = l.status; li.appendChild(st);
        list.appendChild(li);
      });
      document.getElementById("poResultCard").style.display = "";
      document.getElementById("poResultCard").scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (e) { msg.textContent = "Sync failed — please try again."; }
    btn.disabled = false; btn.textContent = "Confirm sync";
  });

  // Purchase-order import history
  document.getElementById("tab-history-btn").addEventListener("click", loadPoHistory);

  async function loadPoHistory() {
    var list = document.getElementById("poHistoryList");
    list.innerHTML = '<div class="state">Loading…</div>';
    try {
      var res = await api("/admin/api/purchase-orders");
      var data = await res.json();
      if (!data.imports.length) { list.innerHTML = '<div class="state">No imports yet</div>'; return; }
      list.innerHTML = "";
      data.imports.forEach(function (imp) {
        var li = document.createElement("li"); li.className = "rl-item";
        var main = document.createElement("div"); main.className = "rl-main";
        var name = document.createElement("span"); name.className = "rl-ord"; name.textContent = imp.filename;
        var sub = document.createElement("span"); sub.className = "rl-cat";
        sub.textContent = imp.line_count + " lines — " + imp.ok_count + " ok, " + imp.skipped_count + " skipped, " + imp.error_count + " failed";
        main.appendChild(name); main.appendChild(sub);
        var view = document.createElement("a"); view.className = "rl-view"; view.href = "#"; view.textContent = "View";
        view.addEventListener("click", function (e) { e.preventDefault(); loadPoDetail(imp.id); });
        li.appendChild(main); li.appendChild(view);
        list.appendChild(li);
      });
    } catch (e) { list.innerHTML = '<div class="state">Failed to load import history</div>'; }
  }

  async function loadPoDetail(importId) {
    var res = await api("/admin/api/purchase-orders/" + importId);
    var data = await res.json();
    document.getElementById("poHistoryDetailCard").style.display = "";
    var pdfLink = document.getElementById("poHistoryPdfLink");
    pdfLink.onclick = async function (e) {
      e.preventDefault();
      var blob = await (await api("/admin/api/purchase-orders/" + importId + "/pdf")).blob();
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a"); a.href = url; a.download = data.import.filename; a.click();
    };
    var body = document.getElementById("poHistoryDetailBody");
    body.innerHTML = "";
    data.lines.forEach(function (l) {
      var tr = document.createElement("tr");
      var cells = [
        l.description,
        String(l.delivered_qty),
        l.skipped ? "—" : (l.qty_before + " → " + l.qty_after),
        l.expiry_updated ? l.sled + " (updated)" : (l.sled + " (unchanged)"),
        l.skipped ? "skipped" : l.status,
      ];
      cells.forEach(function (text) { var td = document.createElement("td"); td.textContent = text; tr.appendChild(td); });
      body.appendChild(tr);
    });
  }
})();
</script>
</body>
</html>`;
}
