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
<title>Shipora — Warehouse Join QR</title>
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
  <p>Warehouse staff: scan this with your phone camera to open Shipora and start uploading shipping photos.</p>
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
<title>Shipora — Shipping Photos</title>
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
</style>
</head>
<body>
<div class="wrap">
  <h1 class="page-h">Shipping photos</h1>
  <p class="page-sub">Collect proof-of-shipment photos from your warehouse staff.</p>

  <div class="layout">
  <div class="main">
  <div class="card">
    <h2>Warehouse join QR code</h2>
    <p class="desc">Staff scan this with their phone to open Shipora and start uploading shipping photos. Print it or show it on screen.</p>
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
})();
</script>
</body>
</html>`;
}
