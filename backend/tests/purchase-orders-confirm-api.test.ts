import { env, fetchMock } from "cloudflare:test";
import { describe, it, expect, beforeAll, afterEach, beforeEach } from "vitest";
import { app } from "../src/index";
import { SHOPIFY_API_VERSION } from "../src/shopify/graphql";
import { getVariantIdForMaterialCode } from "../src/db/materialCodeMap";
import { listStockEventLines } from "../src/db/stockEvents";
import { listTrackedProducts } from "../src/db/trackedProducts";

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

function mockGraphQL(response: unknown) {
  fetchMock
    .get("https://demo.myshopify.com")
    .intercept({ path: `/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, method: "POST" })
    .reply(200, JSON.stringify(response));
}

// requireAdminSession() verifies a signed Shopify session token (App Bridge's
// shopify.idToken()). Tests mint one locally the same way admin-api.test.ts
// does — this is copied from that file's mintIdToken/b64url helpers verbatim,
// not reinvented; keep it in sync if that file's helper ever changes.
function b64url(bytes: Uint8Array): string {
  let bin = ""; for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function mintIdToken(shop: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const claims = { iss: `https://${shop}/admin`, dest: `https://${shop}`, aud: env.SHOPIFY_API_KEY, sub: "1", exp: now + 60, nbf: now - 60, iat: now };
  const payload = b64url(new TextEncoder().encode(JSON.stringify(claims)));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.SHOPIFY_API_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${header}.${payload}`)));
  return `${header}.${payload}.${b64url(sig)}`;
}
async function authHeaders(): Promise<{ Authorization: string }> {
  return { Authorization: `Bearer ${await mintIdToken("demo.myshopify.com")}` };
}

beforeEach(async () => {
  await env.DB.prepare(
    "INSERT INTO shops (id, shop_domain, access_token, join_secret, status, installed_at) VALUES (?,?,?,?,?,?)"
  ).bind("shop_1", "demo.myshopify.com", "tok", "sec", "active", 1).run();
});

// One batched read for the whole delivery, then one write per line. Reading
// per line was 2 subrequests per line, which hit Cloudflare's 50-subrequest
// cap at 25 lines and failed MID-BATCH, after earlier lines had already added
// stock. These helpers build that first batched response.
function node(variantId: string, invItemId: string, available: number, bbdHtml = "") {
  return {
    id: variantId,
    sku: null,
    displayName: "Product",
    image: null,
    inventoryItem: {
      id: invItemId,
      inventoryLevels: { edges: [{ node: { location: { id: "gid://shopify/Location/1" }, quantities: [{ name: "available", quantity: available }] } }] },
    },
    product: { id: "gid://shopify/Product/1", title: "Product", featuredImage: null, descriptionHtml: bbdHtml, onlineStoreUrl: null, onlineStorePreviewUrl: null },
  };
}
function mockBatchRead(nodes: unknown[]) { mockGraphQL({ data: { nodes } }); }

function pdfFile(): File {
  return new File([new Uint8Array([1, 2, 3])], "delivery.pdf", { type: "application/pdf" });
}

describe("POST /admin/api/purchase-orders/confirm", () => {
  it("adjusts inventory additively (stock only, no expiry write) and records history", async () => {
    // Expiry-date write-back is disabled for now — confirm only adjusts stock.
    mockBatchRead([
      node("gid://shopify/ProductVariant/1", "gid://shopify/InventoryItem/1", 0),
      node("gid://shopify/ProductVariant/2", "gid://shopify/InventoryItem/2", 5, "<p><strong>Best Before Date (BBD) From: Jan 2026</strong></p>"),
    ]);
    mockGraphQL({ data: { inventoryAdjustQuantities: { userErrors: [] } } }); // line A
    mockGraphQL({ data: { inventoryAdjustQuantities: { userErrors: [] } } }); // line B

    const lines = [
      { materialCode: "500123", description: "ACME MILK", productTitle: "ACME MILK", deliveredQty: 10, sled: "15.03.2027", variantId: "gid://shopify/ProductVariant/1", matchSource: "sku", skip: false },
      { materialCode: "500456", description: "ACME YOGURT", productTitle: "ACME YOGURT", deliveredQty: 4, sled: "01.04.2027", variantId: "gid://shopify/ProductVariant/2", matchSource: "sku", skip: false },
    ];

    const fd = new FormData();
    fd.set("pdf", pdfFile());
    fd.set("locationId", "gid://shopify/Location/1");
    fd.set("lines", JSON.stringify(lines));

    const res = await app.request("/admin/api/purchase-orders/confirm", { method: "POST", body: fd, headers: await authHeaders() }, env);
    expect(res.status).toBe(200);
    const body = await res.json() as { importId: string; lines: { materialCode: string; status: string }[] };
    expect(body.lines).toEqual([
      { materialCode: "500123", status: "ok" },
      { materialCode: "500456", status: "ok" },
    ]);

    const rows = await listStockEventLines(env.DB, body.importId);
    const lineA = rows.find((r) => r.material_code === "500123")!;
    expect(lineA.qty_before).toBe(0);
    expect(lineA.qty_after).toBe(10);
    const lineB = rows.find((r) => r.material_code === "500456")!;
    expect(lineB.qty_after).toBe(9);
  });

  it("skipped lines are recorded but never touch Shopify", async () => {
    const lines = [
      { materialCode: "999999", description: "UNKNOWN", productTitle: "UNKNOWN", deliveredQty: 3, sled: "01.01.2027", variantId: null, matchSource: null, skip: true },
    ];
    const fd = new FormData();
    fd.set("pdf", pdfFile());
    fd.set("locationId", "gid://shopify/Location/1");
    fd.set("lines", JSON.stringify(lines));

    const res = await app.request("/admin/api/purchase-orders/confirm", { method: "POST", body: fd, headers: await authHeaders() }, env);
    const body = await res.json() as { importId: string; lines: { materialCode: string; status: string }[] };
    expect(body.lines).toEqual([{ materialCode: "999999", status: "skipped" }]);

    const rows = await listStockEventLines(env.DB, body.importId);
    expect(rows[0].skipped).toBe(1);
  });

  it("one line failing doesn't block the others, and reports that line's error", async () => {
    // Deleted in Shopify since the note was parsed: the batch read simply
    // omits it, which is how fetchStockRows reports a variant it cannot find.
    mockBatchRead([]);

    const lines = [
      { materialCode: "500123", description: "GONE", productTitle: "GONE", deliveredQty: 10, sled: "15.03.2027", variantId: "gid://shopify/ProductVariant/1", matchSource: "sku", skip: false },
    ];
    const fd = new FormData();
    fd.set("pdf", pdfFile());
    fd.set("locationId", "gid://shopify/Location/1");
    fd.set("lines", JSON.stringify(lines));

    const res = await app.request("/admin/api/purchase-orders/confirm", { method: "POST", body: fd, headers: await authHeaders() }, env);
    const body = await res.json() as { importId: string; lines: { materialCode: string; status: string; error?: string }[] };
    expect(body.lines[0].status).toBe("error");
    expect(body.lines[0].error).toBeTruthy();
  });

  it("reads all lines in ONE request, so a long delivery note cannot blow the subrequest cap", async () => {
    // Reading per line cost 2 Shopify subrequests per line. Cloudflare caps a
    // Worker at 50, so a 25-line note failed halfway — after earlier lines had
    // already added stock to Shopify, with no way to tell which. Fonterra
    // notes routinely run past 25 lines. Counting the requests is the only way
    // to hold this: the behaviour is identical right up until it breaks.
    const seen: string[] = [];
    fetchMock
      .get("https://demo.myshopify.com")
      .intercept({ path: `/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, method: "POST" })
      .reply(200, (opts: { body?: string | null }) => {
        const q = String(JSON.parse(String(opts.body)).query);
        seen.push(q.includes("nodes(") ? "read" : "write");
        if (q.includes("nodes(")) {
          return JSON.stringify({ data: { nodes: Array.from({ length: 8 }, (_, i) =>
            node(`gid://shopify/ProductVariant/${i + 1}`, `gid://shopify/InventoryItem/${i + 1}`, 0)) } });
        }
        return JSON.stringify({ data: { inventoryAdjustQuantities: { userErrors: [] } } });
      })
      .times(9); // 1 read + 8 writes, NOT 16

    const lines = Array.from({ length: 8 }, (_, i) => ({
      materialCode: `50000${i}`, description: "ACME", productTitle: "ACME", deliveredQty: 1,
      sled: "15.03.2027", variantId: `gid://shopify/ProductVariant/${i + 1}`, matchSource: "sku", skip: false,
    }));
    const fd = new FormData();
    fd.set("pdf", pdfFile());
    fd.set("locationId", "gid://shopify/Location/1");
    fd.set("lines", JSON.stringify(lines));

    const res = await app.request("/admin/api/purchase-orders/confirm", { method: "POST", body: fd, headers: await authHeaders() }, env);
    expect(res.status).toBe(200);
    expect(seen.filter((x) => x === "read")).toHaveLength(1);
    expect(seen.filter((x) => x === "write")).toHaveLength(8);
    // And the read comes first: no line may be written before every current
    // quantity has been read.
    expect(seen[0]).toBe("read");
  });

  it("upserts the material_code_map for a fuzzy/manual match but not for an exact SKU match", async () => {
    mockBatchRead([node("gid://shopify/ProductVariant/1", "gid://shopify/InventoryItem/1", 0)]);
    mockGraphQL({ data: { inventoryAdjustQuantities: { userErrors: [] } } });

    const lines = [
      { materialCode: "500123", description: "ACME MILK", productTitle: "ACME MILK", deliveredQty: 10, sled: "15.03.2027", variantId: "gid://shopify/ProductVariant/1", matchSource: "fuzzy", skip: false },
    ];
    const fd = new FormData();
    fd.set("pdf", pdfFile());
    fd.set("locationId", "gid://shopify/Location/1");
    fd.set("lines", JSON.stringify(lines));

    await app.request("/admin/api/purchase-orders/confirm", { method: "POST", body: fd, headers: await authHeaders() }, env);
    expect(await getVariantIdForMaterialCode(env.DB, "shop_1", "500123")).toBe("gid://shopify/ProductVariant/1");
  });

  it("adds every product it stocked to the Stock tab", async () => {
    // Deliveries should grow the tracked list by themselves — the merchant
    // should never have to remember to add what they just received.
    mockBatchRead([node("gid://shopify/ProductVariant/1", "gid://shopify/InventoryItem/1", 0)]);
    mockGraphQL({ data: { inventoryAdjustQuantities: { userErrors: [] } } });

    const lines = [
      { materialCode: "122352", description: "ANC BTR", productTitle: "ANC BTR", deliveredQty: 5, sled: "22.11.2027", variantId: "gid://shopify/ProductVariant/1", matchSource: "sku", skip: false },
    ];
    const fd = new FormData();
    fd.set("pdf", pdfFile());
    fd.set("locationId", "gid://shopify/Location/1");
    fd.set("lines", JSON.stringify(lines));

    const res = await app.request("/admin/api/purchase-orders/confirm", { method: "POST", body: fd, headers: await authHeaders() }, env);
    expect(res.status).toBe(200);

    const tracked = await listTrackedProducts(env.DB, "shop_1");
    expect(tracked.map((t) => t.shopifyVariantId)).toEqual(["gid://shopify/ProductVariant/1"]);
  });

  it("does not track a skipped line", async () => {
    const lines = [
      { materialCode: "999", description: "UNMATCHED", productTitle: "UNMATCHED", deliveredQty: 3, sled: "01.01.2028", variantId: null, matchSource: null, skip: true },
    ];
    const fd = new FormData();
    fd.set("pdf", pdfFile());
    fd.set("locationId", "gid://shopify/Location/1");
    fd.set("lines", JSON.stringify(lines));

    await app.request("/admin/api/purchase-orders/confirm", { method: "POST", body: fd, headers: await authHeaders() }, env);
    expect(await listTrackedProducts(env.DB, "shop_1")).toEqual([]);
  });
});
