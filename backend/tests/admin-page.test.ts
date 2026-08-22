import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { app } from "../src/index";
import { createShop } from "../src/db/shops";

describe("GET /admin", () => {
  it("serves an embeddable HTML page with the API key and frame-ancestors CSP", async () => {
    await createShop(env.DB, { id: "adm-page", shopDomain: "demo.myshopify.com", accessToken: "t", joinSecret: "j", installedAt: 1 });
    const res = await app.request("/admin?shop=demo.myshopify.com&host=abc", {}, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors");
    const html = await res.text();
    expect(html).toContain(env.SHOPIFY_API_KEY);
    expect(html).toContain("app-bridge");
  });

  it("redirects to OAuth when the shop is not installed yet", async () => {
    const res = await app.request("/admin?shop=fresh-store.myshopify.com&host=abc", {}, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("/admin/oauth/authorize");
    expect(html).not.toContain("app-bridge");
  });

  it("includes the Import tab and its upload form", async () => {
    await createShop(env.DB, { id: "adm-page-import", shopDomain: "demo.myshopify.com", accessToken: "t", joinSecret: "j", installedAt: 1 });
    const res = await app.request("/admin?shop=demo.myshopify.com", {}, env);
    const html = await res.text();
    expect(html).toContain('id="tab-import"');
    expect(html).toContain('id="poFile"');
    expect(html).toContain("/admin/api/purchase-orders/parse");
    expect(html).toContain("/admin/api/purchase-orders/confirm");
  });

  it("includes the History tab and its list container", async () => {
    await createShop(env.DB, { id: "adm-page-history", shopDomain: "demo.myshopify.com", accessToken: "t", joinSecret: "j", installedAt: 1 });
    const res = await app.request("/admin?shop=demo.myshopify.com", {}, env);
    const html = await res.text();
    expect(html).toContain('id="tab-history"');
    expect(html).toContain('id="poHistoryList"');
    expect(html).toContain("/admin/api/purchase-orders");
  });

  it("includes the Stock tab, its table and its endpoints", async () => {
    await createShop(env.DB, { id: "adm-page-stock", shopDomain: "demo.myshopify.com", accessToken: "t", joinSecret: "j", installedAt: 1 });
    const res = await app.request("/admin?shop=demo.myshopify.com", {}, env);
    const html = await res.text();

    expect(html).toContain('id="tab-stock"');
    expect(html).toContain('id="stockTableBody"');
    expect(html).toContain('id="stockAddSearch"');
    expect(html).toContain("/admin/api/stock/save");
    expect(html).toContain("/admin/api/products/search");
  });

  it("does not ship a BBD editor in Stage 1", async () => {
    // BBD is displayed but never written until Stage 2. A month picker on the
    // page would imply an edit that silently does nothing.
    await createShop(env.DB, { id: "adm-page-nobbd", shopDomain: "demo.myshopify.com", accessToken: "t", joinSecret: "j", installedAt: 1 });
    const res = await app.request("/admin?shop=demo.myshopify.com", {}, env);
    const html = await res.text();

    expect(html).not.toContain('type="month"');
  });

  it("stages a stock row only via an explicit confirm control, never on focus", async () => {
    // A weekly count means Bulk edit auto-focusing row 1, and Enter-to-move-down
    // focusing every row it passes through. If focus (or plain typing) staged a
    // count, both of those would record a physical count that never happened.
    // Only an explicit ✓ may stage a row — this is the one guarantee this test
    // can check straight from the rendered page source.
    await createShop(env.DB, { id: "adm-page-stock-confirm", shopDomain: "demo.myshopify.com", accessToken: "t", joinSecret: "j", installedAt: 1 });
    const res = await app.request("/admin?shop=demo.myshopify.com", {}, env);
    const html = await res.text();

    // Assert the control exists and is labelled, not its exact tooltip: the
    // guarantee is "a count is staged only when the merchant says so", and
    // pinning wording made an ordinary copy change look like a broken promise.
    expect(html).toContain('confirmBtn.textContent = "Confirm"');
    expect(html).toContain('confirmThisRow()');
    expect(html).not.toContain('addEventListener("focus"');
  });

  it("shows a confirmed row's staged value with a Counted badge, not the stale server figure", async () => {
    // Before this fix, a closed row always rendered stockAt(row) (the server
    // figure) regardless of whether it had just been confirmed, so a count
    // of 12 against a stock of 10 snapped back to showing 10 with no
    // indication anything had been entered.
    await createShop(env.DB, { id: "adm-page-stock-counted", shopDomain: "demo.myshopify.com", accessToken: "t", joinSecret: "j", installedAt: 1 });
    const res = await app.request("/admin?shop=demo.myshopify.com", {}, env);
    const html = await res.text();

    expect(html).toContain("String(staged ? staged.value : current)");
    expect(html).toContain('badge.className = "stock-badge counted"');
    expect(html).toContain('badge.textContent = "Counted"');
  });

  it("preserves a typed-but-unconfirmed value across a re-render triggered elsewhere", async () => {
    // Confirming or cancelling one row, sorting, or filtering all call
    // renderStockRows(), which wipes and rebuilds stockTableBody. A pending
    // (not-yet-confirmed) number lives only in the DOM, so the rebuild must
    // read it back from a value store, not from stockEdits (confirmed) or
    // stockAt(row) (the server figure) — otherwise a second row's unsaved
    // typing is destroyed by confirming a first.
    await createShop(env.DB, { id: "adm-page-stock-pending", shopDomain: "demo.myshopify.com", accessToken: "t", joinSecret: "j", installedAt: 1 });
    const res = await app.request("/admin?shop=demo.myshopify.com", {}, env);
    const html = await res.text();

    expect(html).toContain("stockPending[row.variantId] !== undefined ? stockPending[row.variantId]");
    expect(html).toContain('input.addEventListener("input", function () { stockPending[row.variantId] = input.value;');

    // The other half of the contract: a pending value must not outlive the row
    // it belongs to. Confirming promotes it into stockEdits and drops it (or
    // the next render would show the pre-confirmation text over the confirmed
    // count); cancelling drops it via the shared clearRow().
    const confirmBody = html.slice(
      html.indexOf("confirmThisRow = function ()"),
      html.indexOf('input.addEventListener("keydown"', html.indexOf("confirmThisRow = function ()"))
    );
    expect(confirmBody).toContain("stockEdits[row.variantId] = {");
    expect(confirmBody).toContain("delete stockPending[row.variantId];");

    const cancelStart = html.indexOf('cancelBtn.addEventListener("click"');
    const cancelBody = html.slice(cancelStart, html.indexOf("actCell.appendChild(confirmBtn)", cancelStart));
    expect(cancelBody).toContain("clearRow(row.variantId);");

    const clearRowStart = html.indexOf("function clearRow(id)");
    const clearRowBody = html.slice(clearRowStart, html.indexOf("function clearAll()", clearRowStart));
    expect(clearRowBody).toContain("delete stockPending[id];");
    expect(clearRowBody).toContain("delete stockEdits[id];");
    expect(clearRowBody).toContain("delete stockOpen[id];");
  });

  it("gives loadStock() sole ownership of window.__stockLoaded, so Retry benefits too", async () => {
    // The tab-switch handler used to set window.__stockLoaded itself after
    // awaiting loadStock() — a second, independent path (the in-row Retry
    // link) called loadStock() directly and never set the flag, so a
    // first-load failure followed by a successful Retry left the flag false.
    // A later tab switch then re-ran loadStock(), which at the time also
    // unconditionally cleared stockEdits/stockOpen — wiping any staged counts
    // with no prompt. Fixed by having loadStock() set the flag itself (one
    // writer, every caller benefits) and by loadStock() never touching
    // stockEdits/stockOpen/stockPending at all.
    await createShop(env.DB, { id: "adm-page-stock-loaded-flag", shopDomain: "demo.myshopify.com", accessToken: "t", joinSecret: "j", installedAt: 1 });
    const res = await app.request("/admin?shop=demo.myshopify.com", {}, env);
    const html = await res.text();

    const assignments = html.match(/window\.__stockLoaded = true/g) ?? [];
    expect(assignments).toHaveLength(1);
    expect(html).not.toContain("if (ok) window.__stockLoaded = true");
    expect(html).toContain('retry.addEventListener("click", function (ev) { ev.preventDefault(); loadStock(); });');

    // And enforce the second half of that sentence, which the assertions above
    // do not touch: re-adding `stockEdits = {}` to loadStock() would leave all
    // three of them passing. Slice the rendered function body — starting at
    // the `async function` keyword, so the doc comment above it (which names
    // all three stores) is excluded — and bar the names outright. A blanket
    // html.not.toContain("stockEdits = {}") cannot be used: clearAll(), which
    // the location-change handler calls, legitimately contains it.
    const bodyStart = html.indexOf("async function loadStock()");
    const bodyEnd = html.indexOf('document.getElementById("stockBulkBtn")', bodyStart);
    expect(bodyStart).toBeGreaterThan(-1);
    expect(bodyEnd).toBeGreaterThan(bodyStart);
    const loadStockBody = html.slice(bodyStart, bodyEnd);

    expect(loadStockBody).not.toContain("stockEdits");
    expect(loadStockBody).not.toContain("stockOpen");
    expect(loadStockBody).not.toContain("stockPending");
    expect(loadStockBody).not.toContain("clearAll");
    expect(loadStockBody).not.toContain("clearRow");
  });

  it("opens on Stock, and reaches Import from inside it rather than from the tab bar", async () => {
    // Manual counting and importing a delivery note both do the same job —
    // change what the shop holds — so Import is not a peer tab. This pins that
    // structure: the pane still exists and is still reachable, just not as a
    // top-level button.
    await createShop(env.DB, { id: "adm-page-tabs", shopDomain: "demo.myshopify.com", accessToken: "t", joinSecret: "j", installedAt: 1 });
    const res = await app.request("/admin?shop=demo.myshopify.com", {}, env);
    const html = await res.text();

    expect(html).toContain('data-tab="stock"');
    expect(html).toContain('data-tab="history"');
    expect(html).toContain('data-tab="photos"');
    expect(html).not.toContain('data-tab="import"');

    expect(html).toContain('id="tab-stock" class="tab-pane active"');
    expect(html).toContain('id="stockImportBtn"');
    expect(html).toContain('id="importBackBtn"');
    expect(html).toContain('id="tab-import"');
  });
});
