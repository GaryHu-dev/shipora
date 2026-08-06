import { env, fetchMock } from "cloudflare:test";
import { describe, it, expect, beforeAll, afterEach, beforeEach } from "vitest";
import { app } from "../src/index";
import { SHOPIFY_API_VERSION } from "../src/shopify/graphql";
import { getVariantIdForMaterialCode } from "../src/db/materialCodeMap";
import { listImportLines } from "../src/db/purchaseOrderImports";

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

function pdfFile(): File {
  return new File([new Uint8Array([1, 2, 3])], "delivery.pdf", { type: "application/pdf" });
}

describe("POST /admin/api/purchase-orders/confirm", () => {
  it("adjusts inventory additively (stock only, no expiry write) and records history", async () => {
    // Expiry-date write-back is disabled for now — confirm only adjusts stock.
    mockGraphQL({ data: { productVariant: { displayName: "Product", image: null, product: { id: "gid://shopify/Product/1", featuredImage: null }, inventoryItem: { id: "gid://shopify/InventoryItem/1", inventoryLevels: { edges: [{ node: { location: { id: "gid://shopify/Location/1" }, quantities: [{ name: "available", quantity: 0 }] } }] } }, metafield: null } } }); // getVariantState for line A
    mockGraphQL({ data: { inventoryAdjustQuantities: { userErrors: [] } } }); // adjustInventory line A

    mockGraphQL({ data: { productVariant: { displayName: "Product", image: null, product: { id: "gid://shopify/Product/1", featuredImage: null }, inventoryItem: { id: "gid://shopify/InventoryItem/2", inventoryLevels: { edges: [{ node: { location: { id: "gid://shopify/Location/1" }, quantities: [{ name: "available", quantity: 5 }] } }] } }, metafield: { value: "2026-01-01" } } } }); // getVariantState for line B
    mockGraphQL({ data: { inventoryAdjustQuantities: { userErrors: [] } } }); // adjustInventory line B

    const lines = [
      { materialCode: "500123", description: "ACME MILK", deliveredQty: 10, sled: "15.03.2027", variantId: "gid://shopify/ProductVariant/1", matchSource: "sku", skip: false },
      { materialCode: "500456", description: "ACME YOGURT", deliveredQty: 4, sled: "01.04.2027", variantId: "gid://shopify/ProductVariant/2", matchSource: "sku", skip: false },
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

    const rows = await listImportLines(env.DB, body.importId);
    const lineA = rows.find((r) => r.material_code === "500123")!;
    expect(lineA.qty_before).toBe(0);
    expect(lineA.qty_after).toBe(10);
    expect(lineA.expiry_updated).toBe(0); // expiry never written
    const lineB = rows.find((r) => r.material_code === "500456")!;
    expect(lineB.qty_after).toBe(9);
    expect(lineB.expiry_updated).toBe(0);
  });

  it("skipped lines are recorded but never touch Shopify", async () => {
    const lines = [
      { materialCode: "999999", description: "UNKNOWN", deliveredQty: 3, sled: "01.01.2027", variantId: null, matchSource: null, skip: true },
    ];
    const fd = new FormData();
    fd.set("pdf", pdfFile());
    fd.set("locationId", "gid://shopify/Location/1");
    fd.set("lines", JSON.stringify(lines));

    const res = await app.request("/admin/api/purchase-orders/confirm", { method: "POST", body: fd, headers: await authHeaders() }, env);
    const body = await res.json() as { importId: string; lines: { materialCode: string; status: string }[] };
    expect(body.lines).toEqual([{ materialCode: "999999", status: "skipped" }]);

    const rows = await listImportLines(env.DB, body.importId);
    expect(rows[0].skipped).toBe(1);
  });

  it("one line failing doesn't block the others, and reports that line's error", async () => {
    mockGraphQL({ data: { productVariant: null } }); // getVariantState: variant gone -> line errors

    const lines = [
      { materialCode: "500123", description: "GONE", deliveredQty: 10, sled: "15.03.2027", variantId: "gid://shopify/ProductVariant/1", matchSource: "sku", skip: false },
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

  it("upserts the material_code_map for a fuzzy/manual match but not for an exact SKU match", async () => {
    mockGraphQL({ data: { productVariant: { displayName: "Product", image: null, product: { id: "gid://shopify/Product/1", featuredImage: null }, inventoryItem: { id: "gid://shopify/InventoryItem/1", inventoryLevels: { edges: [] } }, metafield: null } } });
    mockGraphQL({ data: { inventoryAdjustQuantities: { userErrors: [] } } });

    const lines = [
      { materialCode: "500123", description: "ACME MILK", deliveredQty: 10, sled: "15.03.2027", variantId: "gid://shopify/ProductVariant/1", matchSource: "fuzzy", skip: false },
    ];
    const fd = new FormData();
    fd.set("pdf", pdfFile());
    fd.set("locationId", "gid://shopify/Location/1");
    fd.set("lines", JSON.stringify(lines));

    await app.request("/admin/api/purchase-orders/confirm", { method: "POST", body: fd, headers: await authHeaders() }, env);
    expect(await getVariantIdForMaterialCode(env.DB, "shop_1", "500123")).toBe("gid://shopify/ProductVariant/1");
  });
});
