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

export function renderAdminPage(apiKey: string): string {
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

  <!-- Import is not a peer of Stock: both do the same job — change what this
       shop holds — and differ only in where the numbers come from, one counted
       by hand and one read off a delivery note. It now opens from inside Stock.
       History stays top-level because it is a lookup you reach for when
       something does not add up, and burying it would be a poor trade. -->
  <!-- Sits above the tabs because a broken sync makes everything below it
       untrustworthy: the stock list, the order list in the PWA, all of it is
       reading a database that stopped being fed. Hidden entirely while
       healthy — a permanent green tick trains people to stop reading it. -->
  <div id="syncWarn" class="sync-warn" style="display:none">
    <span id="syncWarnText"></span>
    <button class="btn" id="syncFixBtn" type="button">Fetch them now</button>
  </div>

  <div class="tabs">
    <button class="tab-btn active" id="tab-stock-btn" data-tab="stock">Stock</button>
    <button class="tab-btn" id="tab-photos-btn" data-tab="photos">Photos</button>
    <button class="tab-btn" id="tab-history-btn" data-tab="history">History</button>
  </div>
${stockTabMarkup()}
${importTabMarkup()}
${historyTabMarkup()}
${photosTabMarkup()}
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

  // An async click handler that throws leaves NOTHING on screen: the promise
  // rejects, the browser logs one line to a console nobody has open, and the
  // button just sits there. That is indistinguishable from "the button does
  // nothing", and it is how a real save failure was reported. Surface it.
  function showFatal(what, err) {
    var msg = (err && (err.message || err.reason && err.reason.message)) || String(err && err.reason || err || "unknown error");
    var bar = document.getElementById("fatalBar");
    if (!bar) {
      bar = document.createElement("div"); bar.id = "fatalBar"; bar.className = "fatal-bar";
      document.body.appendChild(bar);
    }
    bar.textContent = "Something went wrong in " + what + ": " + msg + " — reload the page and try again.";
    bar.style.display = "";
  }
  window.addEventListener("error", function (e) { showFatal("the page", e.error || e); });
  window.addEventListener("unhandledrejection", function (e) { showFatal("an action", e); });
  window.__showFatal = showFatal;

  // Every product picker searches through one of these.
  //
  // Debouncing alone is not enough, because these requests no longer take a
  // uniform time: a SKU-prefix hit comes back in ~200ms, while a miss falls
  // through to scanning the catalogue and takes ~2s. So a slow early request
  // can land AFTER a fast later one and overwrite correct results with stale
  // ones — the list would show matches for a prefix of what is now in the box.
  // Each keystroke therefore aborts whatever the previous one started, which
  // also stops Shopify being asked once per character.
  function searchRunner() {
    var timer = null, ctrl = null;
    function cancel() { clearTimeout(timer); if (ctrl) { ctrl.abort(); ctrl = null; } }
    var run = function (delay, fn) {
      cancel();
      ctrl = new AbortController();
      var signal = ctrl.signal;
      timer = setTimeout(function () { fn(signal); }, delay);
    };
    run.cancel = cancel;
    return run;
  }
  window.searchRunner = searchRunner;
  // An aborted request is not a failure — it means the merchant kept typing.
  window.isAbort = function (err) { return !!err && err.name === "AbortError"; };
${photosTabScript()}
${stockTabScript()}

  // Tabs
  // Checked on load rather than on a timer: this is a page someone opens to do
  // a job, and the moment they open it is exactly when they need to know the
  // numbers in front of them are current.
  (async function () {
    try {
      var r = await api("/admin/api/sync-health");
      var h = await r.json();
      if (h.unavailable || !h.missing) return;
      document.getElementById("syncWarnText").textContent =
        h.missing + (h.missing === 1 ? " recent order has" : " recent orders have") +
        " not reached StockProof. Shopify's latest is " + h.shopifyNewest +
        "; the newest here is " + (h.ourNewest || "none") + ".";
      document.getElementById("syncWarn").style.display = "";
    } catch (e) { /* never let a health check break the page it is reporting on */ }
  })();

  document.getElementById("syncFixBtn").addEventListener("click", async function () {
    var btn = this; btn.disabled = true; btn.textContent = "Fetching\u2026";
    try {
      var r = await api("/admin/api/sync-health/resync", { method: "POST" });
      var d = await r.json();
      if (d.health && !d.health.missing) {
        document.getElementById("syncWarnText").textContent = "Caught up \u2014 " + d.synced + " orders fetched" +
          (d.repointed && d.repointed.length ? ", and " + d.repointed.length + " webhook(s) repointed here" : "") + ".";
        btn.style.display = "none";
        window.__stockLoaded = false;
      } else {
        document.getElementById("syncWarnText").textContent =
          "Fetched " + d.synced + ", but " + (d.health ? d.health.missing : "some") +
          " are still missing. The webhooks may be pointing somewhere else.";
        btn.disabled = false; btn.textContent = "Try again";
      }
    } catch (e) {
      document.getElementById("syncWarnText").textContent = "Could not fetch the missing orders.";
      btn.disabled = false; btn.textContent = "Try again";
    }
  });

  // Every product picker on this page — the stock add box, the material-code
  // pairing box, and each row's "Change product" — is an input with its results
  // list as a sibling inside a positioned parent. They all used to close only
  // when you picked something or emptied the field, so clicking away left a
  // list of products hanging over the page with nothing to dismiss it.
  document.addEventListener("click", function (e) {
    document.querySelectorAll(".po-pick.open").forEach(function (box) {
      if (!box.parentElement.contains(e.target)) box.classList.remove("open");
    });
  });
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    document.querySelectorAll(".po-pick.open").forEach(function (box) { box.classList.remove("open"); });
  });

  // Stock is the tab the page opens on, so the switch handler below never
  // fires for it and its first load has to be kicked off here.
  loadStock();

  function showStockPane(which) {
    document.getElementById("tab-stock").classList.toggle("active", which === "stock");
    document.getElementById("tab-import").classList.toggle("active", which === "import");
    window.scrollTo({ top: 0 });
  }
  document.getElementById("stockImportBtn").addEventListener("click", function () { showStockPane("import"); });
  document.getElementById("importBackBtn").addEventListener("click", function () { showStockPane("stock"); loadStock(); });

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
      // Leaving the Stock area also leaves the import flow, so it is never
      // left half-finished behind a tab that no longer shows it.
      document.getElementById("tab-import").classList.remove("active");
    });
  });
${importTabScript()}
${historyTabScript()}
})();
</script>
</body>
</html>`;
}
