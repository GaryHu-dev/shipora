import { env, fetchMock } from "cloudflare:test";
import { describe, it, expect, beforeAll, afterEach, beforeEach } from "vitest";
import { app } from "../src/index";
import { SHOPIFY_API_VERSION } from "../src/shopify/graphql";
import { addTrackedProduct, listTrackedProducts } from "../src/db/trackedProducts";

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

// Copied verbatim from purchase-orders-confirm-api.test.ts — keep in sync.
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

const V1 = "gid://shopify/ProductVariant/1";
const P1 = "gid://shopify/Product/5";
const LOC = "gid://shopify/Location/1";

beforeEach(async () => {
  await env.DB.prepare(
    "INSERT INTO shops (id, shop_domain, access_token, join_secret, status, installed_at) VALUES (?,?,?,?,?,?)"
  ).bind("shop_1", "demo.myshopify.com", "tok", "sec", "active", 1).run();
});

const variantNode = (qty: number, descriptionHtml: string) => ({
  id: V1,
  sku: "122352",
  displayName: "Anchor Cream UHT - Default Title",
  image: null,
  inventoryItem: {
    id: "gid://shopify/InventoryItem/9",
    inventoryLevels: { edges: [{ node: { location: { id: LOC }, quantities: [{ name: "available", quantity: qty }] } }] },
  },
  product: { id: P1, title: "Anchor Cream UHT", featuredImage: null, descriptionHtml },
});

describe("GET /admin/api/stock", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await app.request("/admin/api/stock", {}, env);
    expect(res.status).toBe(401);
  });

  it("returns locations and an empty list before anything is tracked", async () => {
    mockGraphQL({ data: { locations: { edges: [{ node: { id: LOC, name: "Auckland" } }] } } });

    const res = await app.request("/admin/api/stock", { headers: await authHeaders() }, env);
    expect(res.status).toBe(200);
    const body = await res.json<{ locations: unknown[]; rows: unknown[] }>();
    expect(body.locations).toEqual([{ id: LOC, name: "Auckland" }]);
    expect(body.rows).toEqual([]);
  });

  it("returns live stock and parsed BBD for tracked products", async () => {
    await addTrackedProduct(env.DB, { id: "tp_1", shopId: "shop_1", shopifyVariantId: V1, shopifyProductId: P1, addedAt: 1 });
    mockGraphQL({ data: { locations: { edges: [{ node: { id: LOC, name: "Auckland" } }] } } });
    mockGraphQL({ data: { nodes: [variantNode(12, "<p><strong>Best Before Date (BBD) From: Dec 2026</strong></p>")] } });

    const res = await app.request("/admin/api/stock", { headers: await authHeaders() }, env);
    const body = await res.json<{ rows: any[] }>();

    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]).toMatchObject({
      variantId: V1, title: "Anchor Cream UHT", sku: "122352", missing: false, lastCountedAt: null,
    });
    expect(body.rows[0].bbd).toMatchObject({ kind: "parsed", year: 2026, month: 12 });
  });

  it("marks a variant deleted in Shopify instead of dropping or failing", async () => {
    await addTrackedProduct(env.DB, { id: "tp_1", shopId: "shop_1", shopifyVariantId: V1, shopifyProductId: P1, addedAt: 1 });
    mockGraphQL({ data: { locations: { edges: [{ node: { id: LOC, name: "Auckland" } }] } } });
    mockGraphQL({ data: { nodes: [null] } });

    const res = await app.request("/admin/api/stock", { headers: await authHeaders() }, env);
    const body = await res.json<{ rows: any[] }>();
    expect(body.rows).toEqual([{ variantId: V1, missing: true }]);
  });
});

describe("POST /admin/api/stock/items", () => {
  async function post(extra = {}) {
    return app.request("/admin/api/stock/items", {
      method: "POST",
      headers: { ...(await authHeaders()), "content-type": "application/json" },
      body: JSON.stringify({ variantId: V1, ...extra }),
    }, env);
  }

  it("adds a product and is idempotent", async () => {
    mockGraphQL({ data: { nodes: [variantNode(12, "")] } });
    expect((await post()).status).toBe(200);
    mockGraphQL({ data: { nodes: [variantNode(12, "")] } });
    expect((await post()).status).toBe(200);
    expect(await listTrackedProducts(env.DB, "shop_1")).toHaveLength(1);
  });

  it("stores the product id Shopify reports, not one the caller supplied", async () => {
    // Stage 2 writes the Best Before Date to the product, so a wrong id here
    // would edit a different product's description — publicly, and silently.
    mockGraphQL({ data: { nodes: [variantNode(12, "")] } });
    await post({ productId: "gid://shopify/Product/999999" });
    const [row] = await listTrackedProducts(env.DB, "shop_1");
    expect(row.shopifyProductId).toBe(P1);
  });

  it("refuses a variant that does not exist in this shop", async () => {
    mockGraphQL({ data: { nodes: [null] } });
    expect((await post()).status).toBe(404);
    expect(await listTrackedProducts(env.DB, "shop_1")).toEqual([]);
  });
});

describe("DELETE /admin/api/stock/items/:variantId", () => {
  it("removes a tracked product", async () => {
    await addTrackedProduct(env.DB, { id: "tp_1", shopId: "shop_1", shopifyVariantId: V1, shopifyProductId: P1, addedAt: 1 });

    const res = await app.request(`/admin/api/stock/items/${encodeURIComponent(V1)}`, {
      method: "DELETE", headers: await authHeaders(),
    }, env);

    expect(res.status).toBe(200);
    expect(await listTrackedProducts(env.DB, "shop_1")).toEqual([]);
  });
});

describe("POST /admin/api/stock/save", () => {
  async function save(rows: unknown[]) {
    return app.request("/admin/api/stock/save", {
      method: "POST",
      headers: { ...(await authHeaders()), "content-type": "application/json" },
      body: JSON.stringify({ locationId: LOC, rows }),
    }, env);
  }

  it("writes the counted value and stamps the row as counted", async () => {
    await addTrackedProduct(env.DB, { id: "tp_1", shopId: "shop_1", shopifyVariantId: V1, shopifyProductId: P1, addedAt: 1 });
    mockGraphQL({ data: { nodes: [variantNode(12, "")] } });               // re-read for inventoryItemId
    mockGraphQL({ data: { inventorySetQuantities: { userErrors: [] } } }); // the write

    const res = await save([{ variantId: V1, stock: { value: 9, compareQuantity: 12 }, counted: true }]);
    expect(await res.json()).toEqual({ results: [{ variantId: V1, ok: true }] });

    expect((await listTrackedProducts(env.DB, "shop_1"))[0].lastCountedAt).not.toBeNull();
  });

  it("still calls Shopify when the counted value is unchanged", async () => {
    // The merchant counted the shelf and it matched what was on screen. That
    // is NOT "nothing to do": stock may have moved underneath, and only
    // compareQuantity can tell us. Optimising this call away would let the row
    // report "counted" while Shopify held a different number.
    await addTrackedProduct(env.DB, { id: "tp_1", shopId: "shop_1", shopifyVariantId: V1, shopifyProductId: P1, addedAt: 1 });
    mockGraphQL({ data: { nodes: [variantNode(12, "")] } });
    mockGraphQL({ data: { inventorySetQuantities: { userErrors: [] } } });

    const res = await save([{ variantId: V1, stock: { value: 12, compareQuantity: 12 }, counted: true }]);
    expect(await res.json()).toEqual({ results: [{ variantId: V1, ok: true }] });
    // afterEach's assertNoPendingInterceptors proves the mutation really fired.
  });

  it("reports a compareQuantity rejection and does NOT stamp the row", async () => {
    await addTrackedProduct(env.DB, { id: "tp_1", shopId: "shop_1", shopifyVariantId: V1, shopifyProductId: P1, addedAt: 1 });
    mockGraphQL({ data: { nodes: [variantNode(11, "")] } });
    mockGraphQL({
      data: { inventorySetQuantities: { userErrors: [{ field: ["quantities"], message: "compareQuantity does not match persisted quantity" }] } },
    });

    const res = await save([{ variantId: V1, stock: { value: 9, compareQuantity: 12 }, counted: true }]);
    const body = await res.json<{ results: { ok: boolean; error?: string }[] }>();

    expect(body.results[0].ok).toBe(false);
    expect(body.results[0].error).toMatch(/changed since/i);
    // The count did not take effect, so it must stay on "not counted this week".
    expect((await listTrackedProducts(env.DB, "shop_1"))[0].lastCountedAt).toBeNull();
  });

  it("keeps rows independent — one failure does not block the others", async () => {
    const V2 = "gid://shopify/ProductVariant/2";
    await addTrackedProduct(env.DB, { id: "tp_1", shopId: "shop_1", shopifyVariantId: V1, shopifyProductId: P1, addedAt: 1 });
    await addTrackedProduct(env.DB, { id: "tp_2", shopId: "shop_1", shopifyVariantId: V2, shopifyProductId: P1, addedAt: 2 });

    // One batched read for BOTH rows (not one read per row), then one write
    // each. assertNoPendingInterceptors + disableNetConnect make this exact:
    // a second read would find no interceptor and fail its row.
    mockGraphQL({ data: { nodes: [variantNode(12, ""), { ...variantNode(4, ""), id: V2 }] } });
    mockGraphQL({ data: { inventorySetQuantities: { userErrors: [{ field: null, message: "boom" }] } } });
    mockGraphQL({ data: { inventorySetQuantities: { userErrors: [] } } });

    const res = await save([
      { variantId: V1, stock: { value: 9, compareQuantity: 12 }, counted: true },
      { variantId: V2, stock: { value: 6, compareQuantity: 4 }, counted: true },
    ]);
    const body = await res.json<{ results: { variantId: string; ok: boolean }[] }>();

    expect(body.results.map((r) => r.ok)).toEqual([false, true]);
  });

  it("sends the client's compareQuantity, never one re-read from Shopify", async () => {
    // The save reads Shopify once per request to resolve inventoryItemId. That
    // read must not become a source of comparison values: compareQuantity has
    // to be the figure the merchant saw on screen, or the staleness check it
    // exists to perform silently stops working. Here the read says 7 and the
    // client says 12 — the write interceptor only matches on 12.
    await addTrackedProduct(env.DB, { id: "tp_1", shopId: "shop_1", shopifyVariantId: V1, shopifyProductId: P1, addedAt: 1 });
    mockGraphQL({ data: { nodes: [variantNode(7, "")] } });
    fetchMock
      .get("https://demo.myshopify.com")
      .intercept({
        path: `/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
        method: "POST",
        body: (raw: string) => {
          const q = JSON.parse(raw).variables?.input?.quantities?.[0];
          return !!q && q.compareQuantity === 12 && q.quantity === 9;
        },
      })
      .reply(200, JSON.stringify({ data: { inventorySetQuantities: { userErrors: [] } } }));

    const res = await save([{ variantId: V1, stock: { value: 9, compareQuantity: 12 }, counted: true }]);
    expect(await res.json()).toEqual({ results: [{ variantId: V1, ok: true }] });
  });

  it("refuses to touch a variant this shop does not track", async () => {
    // Guards against a crafted request writing to arbitrary products.
    const res = await save([{ variantId: V1, stock: { value: 9, compareQuantity: 12 }, counted: true }]);
    const body = await res.json<{ results: { ok: boolean; error?: string }[] }>();
    expect(body.results[0].ok).toBe(false);
    expect(body.results[0].error).toMatch(/not tracked/i);
  });

  it("does not stamp counted when the client says it did not count", async () => {
    // Stage 2's monthly BBD pass submits rows without having counted the shelf;
    // stamping them would silently empty the weekly count's to-do list.
    await addTrackedProduct(env.DB, { id: "tp_1", shopId: "shop_1", shopifyVariantId: V1, shopifyProductId: P1, addedAt: 1 });
    mockGraphQL({ data: { nodes: [variantNode(12, "")] } });
    mockGraphQL({ data: { inventorySetQuantities: { userErrors: [] } } });

    await save([{ variantId: V1, stock: { value: 12, compareQuantity: 12 }, counted: false }]);
    expect((await listTrackedProducts(env.DB, "shop_1"))[0].lastCountedAt).toBeNull();
  });

  it("isolates a malformed row instead of throwing away the whole request", async () => {
    // A `rows` entry that is `null` (valid JSON) must not throw synchronously
    // out of the loop — earlier rows in the same request may have already
    // written to Shopify, and losing `results` to an uncaught exception would
    // tell the merchant nothing landed when some of it did.
    await addTrackedProduct(env.DB, { id: "tp_1", shopId: "shop_1", shopifyVariantId: V1, shopifyProductId: P1, addedAt: 1 });
    mockGraphQL({ data: { nodes: [variantNode(12, "")] } });
    mockGraphQL({ data: { inventorySetQuantities: { userErrors: [] } } });

    const res = await save([{ variantId: V1, stock: { value: 9, compareQuantity: 12 }, counted: true }, null]);
    const body = await res.json<{ results: { variantId: string; ok: boolean; error?: string }[] }>();

    expect(body.results).toHaveLength(2);
    expect(body.results[0]).toEqual({ variantId: V1, ok: true });
    expect(body.results[1].ok).toBe(false);
    expect(body.results[1].error).toBeTruthy();
    // The valid row before the malformed one really did land.
    expect((await listTrackedProducts(env.DB, "shop_1"))[0].lastCountedAt).not.toBeNull();
  });
});
