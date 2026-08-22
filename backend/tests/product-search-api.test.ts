import { env, fetchMock } from "cloudflare:test";
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { app } from "../src/index";
import { SHOPIFY_API_VERSION } from "../src/shopify/graphql";

function b64url(bytes: Uint8Array): string {
  let bin = ""; for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function authHeaders(): Promise<{ Authorization: string }> {
  const shop = "demo.myshopify.com";
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const claims = { iss: `https://${shop}/admin`, dest: `https://${shop}`, aud: env.SHOPIFY_API_KEY, sub: "1", exp: now + 60, nbf: now - 60, iat: now };
  const payload = b64url(new TextEncoder().encode(JSON.stringify(claims)));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.SHOPIFY_API_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${header}.${payload}`)));
  return { Authorization: `Bearer ${header}.${payload}.${b64url(sig)}` };
}

beforeAll(() => { fetchMock.activate(); fetchMock.disableNetConnect(); });
afterEach(() => fetchMock.assertNoPendingInterceptors());
beforeEach(async () => {
  await env.DB.prepare(
    "INSERT INTO shops (id, shop_domain, access_token, join_secret, status, installed_at) VALUES (?,?,?,?,?,?)"
  ).bind("shop_1", "demo.myshopify.com", "tok", "sec", "active", 1).run();
});

const SEARCH_REPLY = JSON.stringify({
  data: {
    products: {
      edges: [{
        node: {
          id: "gid://shopify/Product/1",
          featuredImage: { url: "https://cdn.example/p1.jpg" },
          variants: { edges: [{ node: { id: "gid://shopify/ProductVariant/1", sku: "500123", displayName: "ACME Milk - Default Title", image: null } }] },
        },
      }],
    },
  },
});

// One node, stocked at two locations, with a BBD in its description.
const STOCK_REPLY = JSON.stringify({
  data: {
    nodes: [{
      id: "gid://shopify/ProductVariant/1",
      sku: "500123",
      displayName: "ACME Milk - Default Title",
      image: null,
      inventoryItem: {
        id: "gid://shopify/InventoryItem/1",
        inventoryLevels: {
          edges: [
            { node: { location: { id: "gid://shopify/Location/1" }, quantities: [{ name: "available", quantity: 7 }] } },
            { node: { location: { id: "gid://shopify/Location/2" }, quantities: [{ name: "available", quantity: 99 }] } },
          ],
        },
      },
      product: { id: "gid://shopify/Product/1", title: "ACME Milk", featuredImage: null, descriptionHtml: "<p>Best Before Date (BBD) From: June 2027</p>" },
    }],
  },
});

describe("GET /admin/api/products/search", () => {
  it("does not fetch stock unless ?stock=1 is asked for", async () => {
    // The annotation costs an extra Shopify request. The import pickers show
    // current → resulting stock on their own review screen and must not pay it.
    fetchMock.get("https://demo.myshopify.com")
      .intercept({ path: `/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, method: "POST" })
      .reply(200, SEARCH_REPLY);

    const res = await app.request("/admin/api/products/search?q=500123", { headers: await authHeaders() }, env);
    const body = await res.json() as { variants: { available?: number }[] };
    expect(body.variants[0].available).toBeUndefined();
  });

  it("annotates with the stock at the requested location, not another one's", async () => {
    // Location 2 holds 99. Answering with it while the merchant is counting at
    // location 1 would be a plausible, wrong number — the same class of bug
    // that made a save write one location's count against another's.
    fetchMock.get("https://demo.myshopify.com")
      .intercept({ path: `/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, method: "POST" })
      .reply(200, (opts: { body?: string | null }) =>
        String(JSON.parse(String(opts.body)).query).includes("StockRows") ? STOCK_REPLY : SEARCH_REPLY)
      .times(2);

    const res = await app.request(
      "/admin/api/products/search?stock=1&q=500123&locationId=" + encodeURIComponent("gid://shopify/Location/1"),
      { headers: await authHeaders() }, env
    );
    const body = await res.json() as { variants: { available: number; bbd: { kind: string; month: number; year: number; text: string } }[] };
    expect(body.variants[0].available).toBe(7);
    expect(body.variants[0].bbd).toMatchObject({ kind: "parsed", month: 6, year: 2027 });
  });

  it("still returns the matches when the stock lookup fails", async () => {
    // Names and SKUs are the point; stock is the annotation. A 500 on the
    // second call must not turn a working search into "no product matches".
    fetchMock.get("https://demo.myshopify.com")
      .intercept({ path: `/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, method: "POST" })
      .reply(200, SEARCH_REPLY);
    fetchMock.get("https://demo.myshopify.com")
      .intercept({ path: `/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, method: "POST" })
      .reply(500, "boom");

    const res = await app.request("/admin/api/products/search?stock=1&q=500123", { headers: await authHeaders() }, env);
    expect(res.status).toBe(200);
    const body = await res.json() as { variants: { id: string; available?: number }[] };
    expect(body.variants).toHaveLength(1);
    expect(body.variants[0].id).toBe("gid://shopify/ProductVariant/1");
    expect(body.variants[0].available).toBeUndefined();
  });
});
